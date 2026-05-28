// ── DIALOG: NL BAR ───────────────────────────────────────────

function handleNlKey(e) {
  if (e.key === 'Enter') nlSubmit();
  if (e.key === 'Escape') { cancelDialog(); closeCalendarModal(); }
}

async function sendDialogTurn(text, {showInThread=true, bypassGuardrails=false}={}) {
  /* Core dialog turn — send text to backend, update state, handle response.
     Used by nlSubmit() and by guardrail action buttons. */
  if (!currentTrip) return;
  setNlLoading(true);
  try {
    const body = {
      trip_id:           currentTrip.id,
      message:           text,
      history:           dlg.history,
      draft:             dlg.draft,
      all_trips:         buildTripContext(),
      bypass_guardrails: bypassGuardrails,
    };
    const r   = await fetch(`${API}/api/parse/dialog`, {method:'POST', credentials:'include', headers:H, body:JSON.stringify(body)});
    if (!r.ok) throw new Error(await r.text());
    const res = await r.json();

    dlg.active  = true;
    dlg.history = res.history;
    dlg.draft   = res.draft;
    dlg.avNote       = res.aviationstack_note || null;
    dlg.ttNote       = res.timetable_note || null;
    dlg.returnDraft  = res.return_draft || null;
    dlg.returnAvNote = res.return_aviationstack_note || null;

    if (showInThread) appendThread('user', text);

    if (res.status === 'connection_search' && res.draft) {
      activateDialog();
      const fromSt = res.draft.origin || '';
      const toSt   = res.draft.destination || '';
      appendThread('bot', res.question || `Searching connections ${fromSt} → ${toSt}…`);
      if (fromSt && toSt) {
        const depDt = (res.draft.departs_at || '').slice(0,16).replace('T',' ');
        const arrDt = (res.draft.arrives_at || '').slice(0,16).replace('T',' ');
        await searchConnections(fromSt, toSt, {datetime: depDt||null, arrive_before: arrDt||null});
      }
    } else if (res.status === 'guardrail') {
      activateDialog();
      const gh = res.guardrail_hit || {};
      appendGuardrailInline(gh.message || 'This segment is outside the trip boundaries.', gh.options || [], gh.meta || {});
    } else if (res.status === 'stuck') {
      activateDialog();
      appendStuckCard(res.question);
    } else if (res.status === 'question') {
      activateDialog();
      appendThread('bot', res.question);
    } else {
      activateDialog();
      appendThread('bot', 'Got everything I need. Does this look right?');
      renderSummary(res.draft, res.aviationstack_note, res.timetable_note);
    }
  } catch(e) {
    appendThread('bot', 'Something went wrong [ERR02] — please try again.');
    console.error('[ERR02]', e);
  } finally {
    setNlLoading(false);
  }
}

async function nlSubmit() {
  const input = document.getElementById('nlInput');
  const text  = input.value.trim();
  if (!text) return;
  if (!currentTrip) {
    // No trip selected — redirect to the planner instead of doing nothing
    if (!document.getElementById('plannerInput')) openPlanner();
    const pi = document.getElementById('plannerInput');
    if (pi) { pi.value = text; plannerSend(); document.getElementById('nlInput').value = ''; }
    else toast('Create a trip first');
    return;
  }

  // If no active dialog, reset state so a fresh conversation never inherits a stale draft
  if (!dlg.active) {
    dlg = {active:false, history:[], draft:null, avNote:null, ttNote:null, returnDraft:null, returnAvNote:null, awaitingReturn:false};
  }

  dlg._lastUserMessage = text;  // remember for guardrail "move to trip" replay
  input.value = '';
  await sendDialogTurn(text);
}



function activateDialog() {
  document.getElementById('nlBar').classList.add('dialog-active');
  document.getElementById('dialogThread').style.display = 'flex';
  document.getElementById('nlCancelBtn').style.display  = '';
  document.getElementById('nlBtn').textContent = 'Send';
  document.getElementById('nlInput').placeholder = 'Reply…';
}

function cancelDialog() {
  dlg = {active:false, history:[], draft:null, avNote:null, ttNote:null, returnDraft:null, returnAvNote:null, awaitingReturn:false};
  document.getElementById('nlBar').classList.remove('dialog-active');
  document.getElementById('dialogThread').style.display = 'none';
  document.getElementById('dialogThread').innerHTML = '';
  document.getElementById('summaryArea').innerHTML  = '';
  document.getElementById('nlCancelBtn').style.display = 'none';
  document.getElementById('nlBtn').textContent = 'Add';
  document.getElementById('nlInput').placeholder = 'e.g. flight ZRH to HRG Oct 10 07:15 Swiss LX392…';
  document.getElementById('nlInput').value = '';
  if (window.innerWidth > 700) document.getElementById('nlInput').focus();
}

function appendGuardrailInline(message, options, meta) {
  const thread = document.getElementById('dialogThread');

  // Warning message bubble
  const msgEl = document.createElement('div');
  msgEl.className = 'dialog-msg bot';
  msgEl.style.cssText = 'border-left:3px solid var(--accent);background:var(--paper2)';
  msgEl.textContent = '⚠ ' + message;
  thread.appendChild(msgEl);

  // Action buttons
  const actionsEl = document.createElement('div');
  actionsEl.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin:4px 0 8px 0';

  const fmt = d => d ? d.split('-').reverse().join('.') : '?';

  options.forEach(label => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.style.cssText = 'text-align:left;font-size:12px;padding:6px 10px';
    btn.textContent = label;

    btn.onclick = async () => {
      // Disable all buttons to prevent double-clicks
      actionsEl.querySelectorAll('button').forEach(b => b.disabled = true);

      if (label === 'Cancel') {
        cancelDialog();
        return;
      }

      if (label === 'Add anyway') {
        // Re-send the original message with a bypass flag via a user follow-up
        appendThread('user', 'Add it anyway to this trip.');
        await sendDialogTurn(dlg._lastUserMessage || text, {bypassGuardrails: true, showInThread: false});
        return;
      }

      if (label.startsWith('Extend')) {
        // Auto-extend current trip to cover the segment date
        const segDate = meta.segment_date;
        if (segDate && currentTrip) {
          const newStart = (currentTrip.start_date && segDate < currentTrip.start_date) ? segDate : currentTrip.start_date;
          const newEnd   = (currentTrip.end_date   && segDate > currentTrip.end_date)   ? segDate : currentTrip.end_date;
          await fetch(`${API}/api/trips/${currentTrip.id}`, {
            method: 'PATCH', headers: H,
            body: JSON.stringify({start_date: newStart, end_date: newEnd}),
          });
          const tr = await fetch(`${API}/api/trips/${currentTrip.id}`, {headers: H});
          const updated = await tr.json();
          currentTrip = {...currentTrip, start_date: updated.start_date, end_date: updated.end_date};
          const idx = trips.findIndex(t => t.id === currentTrip.id);
          if (idx >= 0) trips[idx] = {...trips[idx], ...currentTrip};
          renderSidebar();
          appendThread('bot', `Trip dates extended to cover ${fmt(segDate)}. Continuing…`);
          await sendDialogTurn('Continue adding the segment (trip dates have been updated).');
        }
        return;
      }

      if (label.startsWith('Move to') && meta.suggested_trip_id) {
        // Switch to the suggested trip and re-send
        const target = trips.find(t => t.id === meta.suggested_trip_id);
        if (target) {
          cancelDialog();
          await selectTrip(target.id);
          appendThread('bot', `Switched to "${target.name}". Re-sending your request…`);
          // Re-open dialog and send the original message
          setTimeout(() => sendDialogTurn(dlg._lastUserMessage || ''), 300);
        }
        return;
      }

      if (label === 'Create new trip') {
        cancelDialog();
        openNewTrip();
        return;
      }
    };

    actionsEl.appendChild(btn);
  });

  thread.appendChild(actionsEl);
  thread.scrollTop = thread.scrollHeight;
}

function appendThread(role, text) {
  const thread = document.getElementById('dialogThread');
  const el = document.createElement('div');
  el.className = `dialog-msg ${role}`;
  el.textContent = text;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}

function setNlLoading(on) {
  const btn   = document.getElementById('nlBtn');
  const input = document.getElementById('nlInput');
  if (on) {
    btn.disabled = true;
    btn.textContent = '…';
    // show thinking bubble
    const el = document.createElement('div');
    el.className = 'dialog-msg thinking';
    el.id = 'thinkingBubble';
    el.textContent = 'Thinking…';
    const thread = document.getElementById('dialogThread');
    thread.style.display = 'flex';
    thread.appendChild(el);
    thread.scrollTop = thread.scrollHeight;
  } else {
    btn.disabled = false;
    btn.textContent = dlg.active ? 'Send' : 'Add';
    const t = document.getElementById('thinkingBubble');
    if (t) t.remove();
  }
  input.disabled = on;
}

// ── SUMMARY CARD ─────────────────────────────────────────────

const TYPE_ICON_MAP = {flight:'✈',hotel:'🏨',train:'🚂',taxi:'🚕',car:'🚗',activity:'🎯',other:'📌'};

function renderSummary(draft, avNote, ttNote) {
  const area = document.getElementById('summaryArea');
  const icon = TYPE_ICON_MAP[draft.type] || '📌';

  const fields = [
    ['Type',        draft.type],
    ['From',        draft.origin],
    ['To',          draft.destination],
    ['Carrier',     draft.carrier],
    ['Flight',      draft.flight_iata],
    ['Departs',     fmtDraftTime(draft.departs_at, draft.departs_tz)],
    ['Arrives',     fmtDraftTime(draft.arrives_at, draft.arrives_tz)],
    ['Ref',         draft.confirmation_ref],
    ['Notes',       draft.meta && draft.meta.notes ? draft.meta.notes : null],
    ['Check-in nights', draft.meta && draft.meta.nights ? draft.meta.nights : null],
  ].filter(([, v]) => v);

  const fieldsHtml = fields.map(([lbl, val]) =>
    `<div class="sum-field">
      <div class="sum-lbl">${lbl}</div>
      <div class="sum-val">${val}</div>
    </div>`
  ).join('');

  const avHtml = avNote ? `
    <div class="av-note">
      <span class="av-note-icon">ℹ</span>
      <span>${avNote}</span>
    </div>` : '';

  const ttHtml = ttNote ? `
    <div class="av-note timetable-note ${ttNote.startsWith('⚠') ? 'tt-warn' : 'tt-ok'}">
      <span>${ttNote}</span>
    </div>` : '';

  area.innerHTML = `
    <div class="summary-card">
      <div class="summary-header">${icon} ${(draft.type||'').toUpperCase()} SUMMARY</div>
      <div class="summary-body">${fieldsHtml}</div>
    </div>
    ${avHtml}
    ${ttHtml}
    <div class="summary-footer">
      <button class="btn btn-ghost btn-sm" onclick="cancelDialog()">Cancel</button>
      <button class="btn btn-ghost btn-sm" onclick="editSummary()">Edit</button>
      <button class="btn btn-accent btn-sm" onclick="confirmSave()">Save segment ✓</button>
    </div>`;
}

function editSummary() {
  // Clear summary, let user keep chatting
  document.getElementById('summaryArea').innerHTML = '';
  appendThread('bot', 'What would you like to change?');
  document.getElementById('nlInput').focus();
}

async function confirmSave() {
  const segDate = (dlg.draft && dlg.draft.departs_at) ? dlg.draft.departs_at.slice(0,10) : null;
  checkDateGuardrail(segDate, async (targetTripId) => {
    const saveBtn = document.querySelector('.summary-footer .btn-accent');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    try {
      const draft = {...dlg.draft};
      if (dlg.avNote) draft.aviationstack_note = dlg.avNote;
      if (dlg.ttNote)  draft.timetable_note       = dlg.ttNote;
      const r = await fetch(`${API}/api/parse/dialog/confirm`, {
        method: 'POST', headers: H,
        body: JSON.stringify({trip_id: targetTripId || currentTrip.id, draft}),
      });
      if (!r.ok) throw new Error(await r.text());
      cancelDialog();
      await selectTrip(currentTrip);
      toast('Segment saved ✓');
    } catch(e) {
      toast('Error saving [ERR03] — check console');
      console.error('[ERR03]', e);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save segment ✓'; }
    }
  });
}

function fmtDraftTime(dt, tz) {
  if (!dt) return null;
  const date = dt.slice(0,10);
  const time = dt.slice(11,16);
  return tz ? `${date} ${time} (${tz})` : `${date} ${time}`;
}

