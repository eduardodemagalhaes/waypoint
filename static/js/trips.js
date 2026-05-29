// ── TRIP MODAL ────────────────────────────────────────────────
function openNewTrip() {
  document.getElementById('tripOverlay').classList.add('open');
  setTimeout(() => document.getElementById('tName').focus(), 50);
}
function closeTripModal() { document.getElementById('tripOverlay').classList.remove('open'); }

async function saveTrip() {
  const name = document.getElementById('tName').value.trim();
  if (!name) { toast('Trip name required'); return; }
  const body = {
    name,
    start_date: parseDate(document.getElementById('tStart').value) || null,
    end_date:   parseDate(document.getElementById('tEnd').value) || null,
  };
  const r    = await fetch(`${API}/api/trips/`, {method:'POST', credentials:'include', headers:H, body:JSON.stringify(body)});
  const trip = await r.json();
  closeTripModal();
  await loadTrips();
  selectTrip(trip);
  toast('Trip created');
}

// ── MODAL CLOSE ON OVERLAY CLICK ─────────────────────────────
document.getElementById('segOverlay').addEventListener('click', e => { if(e.target===e.currentTarget) closeSegModal(); });
document.getElementById('tripOverlay').addEventListener('click', e => { if(e.target===e.currentTarget) closeTripModal(); });
document.getElementById('editTripOverlay').addEventListener('click', e => { if(e.target===e.currentTarget) closeEditTripModal(); });
document.getElementById('segDetailsOverlay').addEventListener('click', e => { if(e.target===e.currentTarget) closeSegDetails(); });

// ── TIME INPUT AUTO-COLON ─────────────────────────────────────
// Smart time parser: accepts 800, 8:00, 08.00, 8, 830 etc → HH:MM
function parseTime(raw) {
  if (!raw) return '';
  const s = raw.trim().replace(/[.\s]/g, ':');
  // Already has colon
  if (s.includes(':')) {
    const [h, m] = s.split(':').map(p => p.padStart(2,'0'));
    const hh = parseInt(h), mm = parseInt(m)||0;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return raw;
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  }
  // Pure digits
  const d = s.replace(/\D/g,'');
  if (d.length === 1 || d.length === 2) {
    const hh = parseInt(d);
    return `${String(hh).padStart(2,'0')}:00`;
  }
  if (d.length === 3) {
    const hh = parseInt(d[0]), mm = parseInt(d.slice(1));
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  }
  if (d.length >= 4) {
    const hh = parseInt(d.slice(0,2)), mm = parseInt(d.slice(2,4));
    return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  }
  return raw;
}

// Convert ISO YYYY-MM-DD → DD.MM.YYYY for display in form fields
function isoToDisplay(iso) {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return iso;
}

// Smart date parser: accepts DD.MM.YYYY, DD.MM.YY, DD/MM/YYYY → YYYY-MM-DD
function parseDate(raw) {
  if (!raw) return '';
  const s = raw.trim();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = '20' + yy;
    return `${yy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
  }
  return s;
}

['fDepTime','fArrTime'].forEach(id => {
  const el = document.getElementById(id);
  // Live: insert colon after 2 digits while typing
  el.addEventListener('input', e => {
    const v = e.target.value;
    const digits = v.replace(/\D/g,'');
    if (digits.length === 4 && !v.includes(':')) {
      e.target.value = digits.slice(0,2)+':'+digits.slice(2,4);
    }
  });
  // On blur: normalise whatever was typed
  el.addEventListener('blur', e => {
    const parsed = parseTime(e.target.value);
    if (parsed) e.target.value = parsed;
  });
});

['fDepDate','fArrDate'].forEach(id => {
  document.getElementById(id).addEventListener('blur', e => {
    const parsed = parseDate(e.target.value);
    if (parsed && parsed !== e.target.value) e.target.value = parsed;
  });
});

// ── HELPERS ───────────────────────────────────────────────────
function fmt(d) {
  if (!d) return '';
  return new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}
function fmtShort(d) {
  if (!d) return '';
  return new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}
function fmtDay(d) {
  if (d==='unknown') return 'Date unknown';
  return new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ── TIME HELPERS ─────────────────────────────────────────────
function depT(departs_at) {
  if (!departs_at) return null;
  const t = departs_at.slice(11,16);
  return t && t !== '00:00' ? t : null;
}

function arrT(departs_at, arrives_at) {
  if (!arrives_at) return null;
  const t = arrives_at.slice(11,16);
  if (!t || t === '00:00') return null;
  return t;
}

function overnightDays(departs_at, arrives_at) {
  if (!departs_at || !arrives_at) return 0;
  const d1 = departs_at.slice(0,10);
  const d2 = arrives_at.slice(0,10);
  if (d1 === d2) return 0;
  const diff = Math.round((new Date(d2) - new Date(d1)) / 86400000);
  return diff > 0 ? diff : 0;
}

function flightDuration(dep_at,arr_at,dep_tz,arr_tz){
  if(!dep_at||!arr_at)return null;
  function toUTC(s,tz){
    const[dp,tp]=s.slice(0,16).split("T");
    const[y,mo,d]=dp.split("-").map(Number);
    const[h,mi]=tp.split(":").map(Number);
    if(!tz)return new Date(y,mo-1,d,h,mi);
    try{
      const u=Date.UTC(y,mo-1,d,h,mi);
      const f=new Intl.DateTimeFormat("en",{timeZone:tz,hour:"2-digit",minute:"2-digit",hour12:false});
      const p={};f.formatToParts(new Date(u)).forEach(x=>p[x.type]=x.value);
      const om=(h-Number(p.hour==="24"?0:p.hour))*60+(mi-Number(p.minute));
      return new Date(u+om*60000);
    }catch(e){return new Date(y,mo-1,d,h,mi);}
  }
  const mins=Math.round((toUTC(arr_at,arr_tz)-toUTC(dep_at,dep_tz))/60000);
  if(mins<=0||mins>24*60)return null;
  const h=Math.floor(mins/60),m=mins%60;
  return h>0?(m>0?`${h}h ${m}m`:`${h}h`):`${m}m`;
}

// ── EDIT TRIP ─────────────────────────────────────────────
function openEditTrip() {
  if (!currentTrip) { toast('No trip selected'); return; }
  document.getElementById('etName').value     = currentTrip.name || '';
  document.getElementById('etLocation').value = currentTrip.location || '';
  document.getElementById('etStart').value    = isoToDisplay(currentTrip.start_date || '');
  document.getElementById('etEnd').value      = isoToDisplay(currentTrip.end_date || '');
  document.getElementById('etCurrency').value = currentTrip.home_currency || 'CHF';
  document.getElementById('etDesc').value     = currentTrip.description || '';
  document.getElementById('editTripOverlay').classList.add('open');
  setTimeout(() => document.getElementById('etName').focus(), 50);
}

function closeEditTripModal() {
  document.getElementById('editTripOverlay').classList.remove('open');
}

async function updateTrip() {
  const name = document.getElementById('etName').value.trim();
  if (!name) { toast('Trip name required'); return; }
  const body = {
    name,
    location:     document.getElementById('etLocation').value.trim() || null,
    start_date:   parseDate(document.getElementById('etStart').value) || null,
    end_date:     parseDate(document.getElementById('etEnd').value) || null,
    home_currency:document.getElementById('etCurrency').value.trim() || 'CHF',
    description:  document.getElementById('etDesc').value.trim() || null,
  };
  const r = await fetch(`${API}/api/trips/${currentTrip.id}`, {
    method:'PATCH', credentials:'include', headers:H, body:JSON.stringify(body)
  });
  if (!r.ok) { toast('Error saving [ERR05] — check console'); console.error('[ERR05]', await r.text()); return; }
  closeEditTripModal();
  await loadTrips();
  await selectTrip(trips.find(t => t.id === currentTrip.id) || trips[0]);
  toast('Trip updated ✓');
}

async function deleteTrip() {
  if (!confirm(`Delete "${currentTrip.name}" and all its segments? This cannot be undone.`)) return;
  await fetch(`${API}/api/trips/${currentTrip.id}`, {method:'DELETE', credentials:'include', headers:H});
  closeEditTripModal();
  await loadTrips();
  if (trips.length) openHomeView();
  else openHomeView();
  toast('Trip deleted');
}

async function enrichSeg(id, btn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⟳ Enriching…';
  try {
    const r = await fetch(`${API}/api/segments/${id}/enrich`, {method:'POST', headers:H});
    if (!r.ok) throw new Error(await r.text());

    // Re-fetch trip data without full re-render so open card state is preserved
    const tr = await fetch(`${API}/api/trips/${currentTrip.id}`, {credentials:'include', headers:H});
    currentTrip = await tr.json();

    // Update just the detail fields inside this card without closing it
    const card = btn.closest('.seg-card');
    if (card) {
      const segData = currentTrip.segments.find(s => s.id === id);
      if (segData) {
        // Re-render only the detail grid content
        const detail = card.querySelector('.seg-detail');
        const wasOpen = detail && detail.classList.contains('open');
        const actionsHtml = detail ? detail.querySelector('.seg-actions').outerHTML : '';
        if (detail) {
          detail.innerHTML = detailFields(segData) +
            `<div style="grid-column:1/-1" class="seg-actions">
              <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEditSeg('${id}')">Edit</button>
              <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openSegDetails('${id}')">Details</button>
              <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteSeg('${id}')">Delete</button>
            </div>`;
          // Re-query after innerHTML replacement (reference is now stale)
          const freshDetail = card.querySelector('.seg-detail');
          if (wasOpen && freshDetail) freshDetail.classList.add('open');
        }
        // Also refresh the hotel card header (dates, phone, stars etc)
        const main = card.querySelector('.seg-main');
        if (main && segData.type === 'hotel') {
          const m = segData.meta || {};
          const ciDate = (segData.departs_at||'').slice(0,10);
          const coDate = (segData.arrives_at||'').slice(0,10);
          const depTime = ciDate ? ((segData.departs_at||'').slice(11,16).replace('00:00','') || null) : null;
          const coTime  = coDate ? ((segData.arrives_at||'').slice(11,16).replace('00:00','') || null) : null;
          const ciStr = ciDate ? `${fmtShort(ciDate)}${depTime ? ' at '+depTime : (m.checkin_time ? ' at '+m.checkin_time : '')}` : '—';
          const coStr = coDate ? `${fmtShort(coDate)}${coTime ? ' at '+coTime : (m.checkout_time ? ' at '+m.checkout_time : '')}` : '—';
          const phoneHtml = m.phone   ? `<div class="hotel-phone">📞 ${m.phone}</div>` : '';
          const addrHtml  = m.address ? `<div class="hotel-addr">📍 ${m.address}</div>`  : '';
          const starsLbl  = m.stars   ? '★'.repeat(Math.min(parseInt(m.stars)||0,5)) : '';
          const nightsLbl = m.nights  ? m.nights+' nights' : '';
          main.querySelector('.seg-route').textContent = segData.carrier || segData.origin || '—';
          let datesEl = main.querySelector('.hotel-dates');
          if (!datesEl) {
            datesEl = document.createElement('div');
            main.insertBefore(datesEl, main.querySelector('.seg-sub') || null);
          }
          datesEl.className = 'hotel-dates';
          datesEl.innerHTML = `<span class="hotel-ci"><span class="hotel-dt-lbl">Check-in</span> ${ciStr}</span><span class="hotel-arrow">→</span><span class="hotel-co"><span class="hotel-dt-lbl">Check-out</span> ${coStr}</span>`;
          let phoneEl = main.querySelector('.hotel-phone');
          let addrEl  = main.querySelector('.hotel-addr');
          if (phoneHtml) { if (!phoneEl) { phoneEl = document.createElement('div'); main.appendChild(phoneEl); } phoneEl.outerHTML = phoneHtml; }
          if (addrHtml)  { if (!addrEl)  { addrEl  = document.createElement('div'); main.appendChild(addrEl);  } addrEl.outerHTML  = addrHtml; }
          const subEl = main.querySelector('.seg-sub');
          if (subEl) subEl.textContent = [starsLbl, nightsLbl].filter(Boolean).join(' ');
        }
      }
    }
    const seg = (currentTrip?.segments||[]).find(x=>x.id===id);
    const m = seg?.meta || {};
    const hasData = m.terminal_departure || m.gate || m.seat || m.boarding_time || m.aircraft || seg?.arrives_at;
    toast(hasData ? 'Enriched ✓' : 'Enriched — no new data available yet');
  } catch(e) {
    toast('Enrich failed — check console');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}





// ── Edit segment assistant ───────────────────────────────────────────────────
let _editAssistHistory = [];

function toggleEditAssist() {
  const panel = document.getElementById('editAssistPanel');
  const open  = panel.style.display === 'none';
  panel.style.display = open ? 'block' : 'none';
  document.getElementById('segFormFields').style.display = open ? 'none' : 'block';
  document.getElementById('editAssistBtn').style.display = open ? 'none' : 'inline-flex';
  document.getElementById('segSaveBtn').style.display    = open ? 'none' : 'inline-flex';
  if (open) {
    _editAssistHistory = [];
    document.getElementById('editAssistThread').innerHTML = '';
    // Prime with a greeting that shows it knows the segment
    const type    = currentType || 'segment';
    const from    = document.getElementById('fFrom').value;
    const to      = document.getElementById('fTo').value;
    const airline = document.getElementById('fAirline')?.value || document.getElementById('fCarrier').value;
    const flnum   = document.getElementById('fFlightNum')?.value || '';
    const carrier = flnum ? `${airline} ${flnum}`.trim() : airline;
    const greeting = type === 'flight'
      ? `Hi! I can update this flight (${from}→${to}${carrier ? ', '+carrier : ''}). What would you like to change?`
      : `Hi! I can update this ${type} segment. What would you like to change?`;
    _editAssistAddMsg('bot', greeting);
    document.getElementById('editAssistInput').focus();
  }
}

function _editAssistAddMsg(role, text) {
  const thread = document.getElementById('editAssistThread');
  const el = document.createElement('div');
  el.className = `edit-assist-msg ${role}`;
  el.textContent = text;
  thread.appendChild(el);
  thread.scrollTop = thread.scrollHeight;
}

async function editAssistSend() {
  const input = document.getElementById('editAssistInput');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  _editAssistAddMsg('user', text);

  // Build current segment state from form
  const type    = currentType || 'flight';
  const from    = document.getElementById('fFrom').value;
  const to      = document.getElementById('fTo').value;
  const airline = document.getElementById('fAirline')?.value || '';
  const flnum   = document.getElementById('fFlightNum')?.value || '';
  const carrier = flnum ? `${airline} ${flnum}`.trim() : (document.getElementById('fCarrier').value || '');
  const depDate = document.getElementById('fDepDate').value;
  const depTime = document.getElementById('fDepTime').value;
  const arrDate = document.getElementById('fArrDate').value;
  const arrTime = document.getElementById('fArrTime').value;
  const ref     = document.getElementById('fRef').value;
  const notes   = document.getElementById('fNotes').value;

  const segContext = {type, origin:from, destination:to, carrier,
    departs_at: depDate&&depTime ? `${parseDate(depDate)}T${depTime}` : null,
    arrives_at: arrDate&&arrTime ? `${parseDate(arrDate)}T${arrTime}` : null,
    confirmation_ref: ref, notes};

  _editAssistHistory.push({role:'user', content: text});

  try {
    const resp = await fetch(`${API}/api/parse/assist/edit`, {
      method: 'POST',
      headers: {...H, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        segment: segContext,
        history: _editAssistHistory,
        message: text,
        trip_segments: currentTrip ? (currentTrip.segments || []).map(s => ({
          type: s.type, origin: s.origin, destination: s.destination,
          carrier: s.carrier, departs_at: s.departs_at, arrives_at: s.arrives_at,
          id: s.id
        })) : []
      })
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();

    if (data.status === 'stuck') {
      const stuckMsg = data.message || "I'm not sure I can help with this edit. Would you like to report it?";
      const stuckEl = document.createElement('div');
      stuckEl.className = 'stuck-card';
      stuckEl.innerHTML = `<p>${stuckMsg}</p><div class="stuck-actions"><a class="stuck-btn primary" href="mailto:waypoint@emdm.ch?subject=Bug+report" target="_blank">🐛 Report a bug</a><a class="stuck-btn" href="mailto:waypoint@emdm.ch?subject=Feature+request" target="_blank">✦ Request a feature</a></div>`;
      document.querySelector('#editAssistThread')?.appendChild(stuckEl);
    } else {
      _editAssistAddMsg('bot', data.message || 'Done!');
    }
    _editAssistHistory.push({role:'user', content: text});
    _editAssistHistory.push({role:'assistant', content: data.message});

    // Apply updates to form fields
    const u = data.updates || {};
    if (u.origin)        document.getElementById('fFrom').value    = u.origin;
    if (u.destination)   document.getElementById('fTo').value      = u.destination;
    if (u.airline)     { const el = document.getElementById('fAirline');   if (el) el.value = u.airline; }
    if (u.flight_number){ const el = document.getElementById('fFlightNum');if (el) el.value = u.flight_number.toUpperCase(); }
    if (u.flight_iata) { const el = document.getElementById('fFlightNum');if (el) el.value = u.flight_iata.toUpperCase(); }
    if (u.carrier && !u.airline) document.getElementById('fCarrier').value = u.carrier;
    if (u.departs_date)    document.getElementById('fDepDate').value = u.departs_date;
    if (u.departs_time)    document.getElementById('fDepTime').value = u.departs_time;
    if (u.arrives_date)    document.getElementById('fArrDate').value = u.arrives_date;
    if (u.arrives_time)    document.getElementById('fArrTime').value = u.arrives_time;
    if (u.confirmation_ref) document.getElementById('fRef').value   = u.confirmation_ref;
    if (u.notes != null)   document.getElementById('fNotes').value  = u.notes;
    if (u.confirmed != null) document.getElementById('fConfirmed').checked = !!u.confirmed;
  } catch(e) {
    _editAssistAddMsg('bot', 'Something went wrong [ERR07] — please try again.');
    console.error('[ERR07]', e);
  }
}

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
