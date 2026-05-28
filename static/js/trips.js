// ── Multi-trip helpers ───────────────────────────────────────────────────────

function segDateWarning(seg) {
  if (!currentTrip || !seg.departs_at) return '';
  const sd = seg.departs_at.slice(0,10);
  const ts = currentTrip.start_date, te = currentTrip.end_date;
  if (ts && te && (sd < ts || sd > te)) {
    // Find which trip this date actually belongs to
    const match = trips.find(t => t.id !== currentTrip.id && t.start_date && t.end_date
                              && sd >= t.start_date && sd <= t.end_date);
    const hint = match ? ` Belongs to <b>${match.name}</b>?` : '';
    return `<div style="grid-column:1/-1;padding:5px 9px;background:#fff8e6;border-radius:6px;
      font-size:11px;color:#8a6200;border:1px solid #f0d080;margin-bottom:4px">
      ⚠ Date ${fmtShort(sd)} is outside this trip's range (${fmtShort(ts)}–${fmtShort(te)}).${hint}
    </div>`;
  }
  return '';
}

let _movingSegId = null;
function openMoveSegModal(segId) {
  _movingSegId = segId;
  const list = document.getElementById('moveTripList');
  list.innerHTML = '';
  const seg = currentTrip.segments.find(s => s.id === segId);
  const segDate = seg ? seg.departs_at.slice(0,10) : null;
  trips.filter(t => t.id !== currentTrip.id).forEach(t => {
    const inRange = segDate && t.start_date && t.end_date
                    && segDate >= t.start_date && segDate <= t.end_date;
    const el = document.createElement('button');
    el.className = 'btn btn-ghost';
    el.style.cssText = 'text-align:left;justify-content:flex-start;padding:10px 14px;' +
      (inRange ? 'border-color:var(--green);color:var(--green)' : '');
    el.innerHTML = `<div style="font-weight:500">${t.name}${inRange ? ' ✓' : ''}</div>` +
      `<div style="font-size:11px;color:var(--ink3)">${fmt(t.start_date)} – ${fmt(t.end_date)}</div>`;
    el.onclick = () => moveSeg(segId, t.id);
    list.appendChild(el);
  });
  document.getElementById('moveSegOverlay').classList.add('open');
}

async function moveSeg(segId, targetTripId) {
  document.getElementById('moveSegOverlay').classList.remove('open');
  try {
    const r = await fetch(`${API}/api/segments/${segId}`, {
      method: 'PATCH',
      headers: {...H, 'Content-Type':'application/json'},
      body: JSON.stringify({trip_id: targetTripId})
    });
    if (!r.ok) throw new Error(await r.text());
    await selectTrip(currentTrip);
    toast('Segment moved ✓');
  } catch(e) {
    toast('Move failed [ERR08]'); console.error('[ERR08]', e);
  }
}

// ── Pass all trips as context to chatbot ─────────────────────────────────────
function buildTripContext() {
  return trips.map(t => ({
    id: t.id,
    name: t.name,
    start_date: t.start_date,
    end_date: t.end_date,
    isCurrent: t.id === currentTrip?.id
  }));
}

// ── Calendar picker ──────────────────────────────────────────────────────────
const _calState = {};

function showCal(inputId, calId) {
  hideCal(); // close any open
  const el   = document.getElementById(calId);
  const inp  = document.getElementById(inputId);
  const val  = parseDate(inp.value);
  const now  = val ? new Date(val + 'T12:00:00') : new Date();
  _calState[calId] = { inputId, year: now.getFullYear(), month: now.getMonth(), sel: val };
  renderCal(calId);
  el.classList.add('open');
  // Close on outside click
  setTimeout(() => document.addEventListener('click', function _h(e) {
    if (!el.contains(e.target) && e.target !== inp) { hideCal(calId); document.removeEventListener('click', _h); }
  }), 10);
}

function hideCal(calId) {
  if (calId) { document.getElementById(calId)?.classList.remove('open'); return; }
  document.querySelectorAll('.cal-popup.open').forEach(el => el.classList.remove('open'));
}

function renderCal(calId) {
  const s   = _calState[calId];
  const el  = document.getElementById(calId);
  const y   = s.year, m = s.month;
  const today = new Date().toISOString().slice(0,10);
  const monthName = new Date(y, m, 1).toLocaleString('en-GB', {month:'long', year:'numeric'});
  const first = new Date(y, m, 1).getDay(); // 0=Sun
  const startDow = (first + 6) % 7; // Mon=0
  const daysInMonth = new Date(y, m+1, 0).getDate();

  let html = `<div class="cal-header">
    <button class="cal-nav" onclick="calNav('${calId}',-1)">‹</button>
    <span class="cal-month">${monthName}</span>
    <button class="cal-nav" onclick="calNav('${calId}',1)">›</button>
  </div><div class="cal-grid">`;
  ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(d => html += `<div class="cal-dow">${d}</div>`);
  for (let i=0; i<startDow; i++) html += `<div class="cal-day empty"></div>`;
  for (let d=1; d<=daysInMonth; d++) {
    const iso = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cls = [
      'cal-day',
      iso === today ? 'today' : '',
      iso === s.sel ? 'sel' : '',
    ].filter(Boolean).join(' ');
    html += `<div class="${cls}" onclick="calPick('${calId}','${iso}')">${d}</div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

function calNav(calId, delta) {
  const s = _calState[calId];
  s.month += delta;
  if (s.month < 0)  { s.month = 11; s.year--; }
  if (s.month > 11) { s.month = 0;  s.year++; }
  renderCal(calId);
}

function calPick(calId, iso) {
  const s = _calState[calId];
  s.sel = iso;
  document.getElementById(s.inputId).value = isoToDisplay(iso);
  renderCal(calId);
  setTimeout(() => hideCal(calId), 120);
}

// ── Trip assistant ────────────────────────────────────────────────────────────
function _tripAssistMsg(role, text) {
  const thread = document.getElementById('tripAssistThread');
  const el = document.createElement('div');
  el.className = `edit-assist-msg ${role}`;
  el.textContent = text;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}

async function tripAssistSend() {
  const input = document.getElementById('tripAssistInput');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  _tripAssistMsg('user', text);

  try {
    const r = await fetch(`${API}/api/parse/assist/trip`, {
      method: 'POST',
      headers: {...H, 'Content-Type': 'application/json'},
      body: JSON.stringify({ message: text })
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    if (d.status === 'stuck') {
      const tc = document.getElementById('tripAssistThread');
      if (tc) {
        const sc = document.createElement('div'); sc.className='stuck-card';
        sc.innerHTML=`<p>${d.message||'I got stuck on this one.'}</p><div class="stuck-actions"><a class="stuck-btn primary" href="mailto:waypoint@emdm.ch?subject=Bug+report" target="_blank">🐛 Report a bug</a><a class="stuck-btn" href="mailto:waypoint@emdm.ch?subject=Feature+request" target="_blank">✦ Request a feature</a></div>`; tc.appendChild(sc); tc.scrollTop=tc.scrollHeight;
      }
    } else {
      _tripAssistMsg('bot', d.message);
    }
    if (d.name)       document.getElementById('tName').value  = d.name;
    if (d.start_date) document.getElementById('tStart').value = isoToDisplay(d.start_date);
    if (d.end_date)   document.getElementById('tEnd').value   = isoToDisplay(d.end_date);
  } catch(e) {
    _tripAssistMsg('bot', 'Something went wrong [ERR09].');
    console.error('[ERR09]', e);
  }
}

// Clear trip assistant on modal open
const _origOpenNewTrip = openNewTrip;
openNewTrip = function() {
  _origOpenNewTrip();
  document.getElementById('tripAssistThread').innerHTML = '';
  document.getElementById('tripAssistInput').value = '';
};

// ── TRIP PLANNER ─────────────────────────────────────────────────────────────
let _plannerState = {history: [], trip_id: null, active: false};

function initPlanner() {
  _plannerState = {history: [], trip_id: null, active: true};
}

function openPlanner() {
  // Show planner in main area even when trips exist
  document.getElementById('tripName').textContent = 'Plan a trip';
  document.getElementById('tripMeta').textContent = '';
  document.getElementById('statusBar').style.display = 'none';
  document.getElementById('timeline').innerHTML = `
    <div class="planner" id="plannerPanel">
      <div class="planner-header">
        <div>
          <div class="planner-title">✦ Plan a trip</div>
          <div class="planner-sub">Tell me where you want to go</div>
        </div>
      </div>
      <div class="planner-thread" id="plannerThread">
        <div class="planner-msg bot">Hi! Where would you like to go? Tell me destination, dates, and I'll help build the whole itinerary.</div>
      </div>
      <div class="planner-input-row">
        <input class="form-input" id="plannerInput" placeholder="e.g. Berlin 3–7 June, flying Swiss from Zurich…"
          onkeydown="if(event.key==='Enter')plannerSend()" style="font-size:13px">
        <button class="btn btn-primary" onclick="plannerSend()">Send</button>
      </div>
    </div>`;
  initPlanner();
  setTimeout(() => document.getElementById('plannerInput')?.focus(), 50);
}

function _plannerMsg(role, text) {
  const thread = document.getElementById('plannerThread');
  if (!thread) return;
  const el = document.createElement('div');
  el.className = `planner-msg ${role}`;
  el.textContent = text;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
  return el;
}

async function plannerSend() {
  const input = document.getElementById('plannerInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.disabled = true;

  _plannerMsg('user', text);
  const thinking = _plannerMsg('thinking', 'Thinking…');

  try {
    const r = await fetch(`${API}/api/parse/plan`, {
      method: 'POST',
      headers: {...H, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        message: text,
        history: _plannerState.history,
        trip_id: _plannerState.trip_id,
      })
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();

    thinking?.remove();

    // Update state
    _plannerState.history  = d.history || [];
    _plannerState.trip_id  = d.trip_id || _plannerState.trip_id;

    // Show saved segments confirmation
    if (d.summary) _plannerMsg('saved', '✓ ' + d.summary);
    if (d.saved_segments?.length) {
      d.saved_segments.forEach(s => {
        const label = s.carrier
          ? `${s.type}: ${s.origin}→${s.destination} (${s.carrier})`
          : `${s.type}: ${s.origin}→${s.destination}`;
        _plannerMsg('saved', '✓ Saved: ' + label);
      });
    }

    // Show bot question
    if (d.question) _plannerMsg('bot', d.question);

    // If trip was created, refresh sidebar
    if (d.trip_id) {
      await loadTrips();
      renderSidebar();
    }

    // If complete, show finish options
    if (d.status === 'complete' && d.trip_id) {
      _plannerMsg('bot', 'Your trip is ready! 🎉');
      const thread = document.getElementById('plannerThread');
      const doneDiv = document.createElement('div');
      doneDiv.className = 'planner-done';
      doneDiv.innerHTML = `
        <span style="font-size:12px;color:var(--ink2);flex:1">Trip created with ${_plannerState.history.filter(h=>h.role==='user').length} turns</span>
        <button class="btn btn-primary btn-sm" onclick="plannerFinish('${d.trip_id}')">View trip →</button>`;
      thread.appendChild(doneDiv);
      thread.scrollTop = thread.scrollHeight;
      document.querySelector('.planner-input-row').style.display = 'none';
    }

  } catch(e) {
    thinking?.remove();
    _plannerMsg('bot', 'Something went wrong [ERR10] — please try again.');
    console.error('[ERR10]', e);
  } finally {
    if (input) input.disabled = false;
    input?.focus();
  }
}

async function plannerFinish(tripId) {
  await loadTrips();
  const trip = trips.find(t => t.id === tripId);
  if (trip) selectTrip(trip);
}

