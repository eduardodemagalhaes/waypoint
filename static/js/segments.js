// ── SEGMENT MODAL ─────────────────────────────────────────────
const TYPE_PLACEHOLDERS = {
  flight:   {from:'ZRH or Zurich',to:'HRG or Hurghada',carrier:'Swiss LX 392',fromLbl:'From',toLbl:'To',carrierLbl:'Flight'},
  hotel:    {from:'City or address',to:'',carrier:'Hotel name',fromLbl:'Location',toLbl:'Check-out date',carrierLbl:'Property'},
  train:    {from:'Bern Hbf',to:'Zürich HB',carrier:'SBB IC 1',fromLbl:'From',toLbl:'To',carrierLbl:'Train'},
  taxi:     {from:'Pickup address',to:'Dropoff address',carrier:'Driver or company name',fromLbl:'Pickup',toLbl:'Dropoff',carrierLbl:'Driver / Company'},
  car:      {from:'Pick-up',to:'Drop-off',carrier:'Hertz / Avis…',fromLbl:'Pick-up',toLbl:'Drop-off',carrierLbl:'Provider'},
  activity: {from:'Location',to:'',carrier:'Operator',fromLbl:'Location',toLbl:'',carrierLbl:'Activity name'},
  other:    {from:'',to:'',carrier:'',fromLbl:'From',toLbl:'To',carrierLbl:'Name'},
};
let currentType = 'flight';

function pickType(btn, type) {
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('sel'));
  btn.classList.add('sel');
  currentType = type;
  const p = TYPE_PLACEHOLDERS[type] || TYPE_PLACEHOLDERS.other;
  document.getElementById('fFrom').placeholder     = p.from;
  document.getElementById('fTo').placeholder       = p.to;
  document.getElementById('fCarrier').placeholder  = p.carrier;
  document.getElementById('lblFrom').textContent   = p.fromLbl;
  document.getElementById('lblTo').textContent     = p.toLbl;
  document.getElementById('lblCarrier').textContent= p.carrierLbl;
  const isHotelType  = type === 'hotel';
  const isFlightType = type === 'flight';
  document.getElementById('arrRow').style.display           = (isHotelType || ['flight','train'].includes(type)) ? 'grid' : 'none';
  document.getElementById('taxiFields').style.display       = type === 'taxi'  ? 'block' : 'none';
  document.getElementById('hotelFields').style.display      = type === 'hotel' ? 'block' : 'none';
  document.getElementById('carrierRow').style.display       = isFlightType ? 'none' : '';
  document.getElementById('flightCarrierRow').style.display = isFlightType ? 'grid' : 'none';
  // Hotel: rename date/time labels
  document.getElementById('lblDepDate').textContent = isHotelType ? 'Check-in date'  : 'Departure date';
  document.getElementById('lblDepTime').textContent = isHotelType ? 'Check-in time'  : 'Departure time';
  document.getElementById('lblArrDate').textContent = isHotelType ? 'Check-out date' : 'Arrival date';
  document.getElementById('lblArrTime').textContent = isHotelType ? 'Check-out time' : 'Arrival time';
  // Hotel: hide "To" field (not meaningful for hotels)
  document.getElementById('fTo').closest('.form-row').style.display = isHotelType ? 'none' : '';
}

function openAddSeg() {
  if (!currentTrip) { toast('Create a trip first'); return; }
  editingSegId = null;
  document.getElementById('segModalTitle').textContent = 'Add segment';
  document.getElementById('segSaveBtn').textContent    = 'Save segment';
  clearSegForm();
  document.getElementById('fDepDate').value = isoToDisplay(currentTrip.start_date || '');
  document.getElementById('fDepTz').value   = 'Europe/Zurich';
  document.getElementById('segOverlay').classList.add('open');
  document.getElementById('fFrom').focus();
}

function openEditSeg(id) {
  window._editingSegId = id;
  const seg = currentTrip.segments.find(s => s.id === id);
  if (!seg) return;
  editingSegId = id;
  document.getElementById('segModalTitle').textContent = 'Edit segment';
  document.getElementById('segSaveBtn').textContent    = 'Update segment';
  const seg4enrich = (currentTrip?.segments||[]).find(s=>s.id===id);
  const enrichBtn = document.getElementById('editEnrichBtn');
  if (enrichBtn) enrichBtn.style.display = seg4enrich && ['flight','train','hotel'].includes(seg4enrich.type) ? 'inline-flex' : 'none';
  clearSegForm();
  const typeBtn = [...document.querySelectorAll('.type-btn')]
    .find(b => b.getAttribute('onclick').includes(`'${seg.type}'`));
  if (typeBtn) pickType(typeBtn, seg.type);
  document.getElementById('fFrom').value    = seg.origin || '';
  document.getElementById('fTo').value      = seg.destination || '';
  document.getElementById('fCarrier').value = seg.carrier || '';
  // For flights: split carrier "Swiss LX966" → airline + flight number
  if (seg.type === 'flight') {
    const cv = seg.carrier || '';
    const fm = cv.match(/\b([A-Z]{2}\d{2,4})\b/);
    document.getElementById('fFlightNum').value = fm ? fm[1] : ((seg.meta && seg.meta.flight_iata) || '');
    document.getElementById('fAirline').value   = fm ? cv.replace(fm[1],'').trim() : cv;
  }
  document.getElementById('fDepDate').value = isoToDisplay((seg.departs_at||'').slice(0,10));
  document.getElementById('fDepTime').value = (seg.departs_at||'').slice(11,16);
  document.getElementById('fArrDate').value = isoToDisplay((seg.arrives_at||'').slice(0,10));
  document.getElementById('fArrTime').value = (seg.arrives_at||'').slice(11,16);
  document.getElementById('fDepTz').value   = seg.departs_tz || '';
  document.getElementById('fRef').value     = seg.confirmation_ref || '';
  document.getElementById('fNotes').value   = (seg.meta && seg.meta.notes) || '';
  document.getElementById('fConfirmed').checked = seg.confirmed;
  if (seg.type === 'hotel' && seg.meta) {
    document.getElementById('fHotelAddress').value = seg.meta.address  || '';
    document.getElementById('fHotelPhone').value   = seg.meta.phone    || '';
    document.getElementById('fHotelRoom').value    = seg.meta.room_type|| '';
  }
  document.getElementById('segOverlay').classList.add('open');
}

function clearSegForm() {
  ['fFrom','fTo','fCarrier','fAirline','fFlightNum','fDepDate','fDepTime','fArrDate','fArrTime','fDepTz','fRef','fNotes',
   'fTaxiPhone','fTaxiDriver','fHotelAddress','fHotelPhone','fHotelRoom']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('taxiFields').style.display       = 'none';
  document.getElementById('hotelFields').style.display      = 'none';
  document.getElementById('carrierRow').style.display       = '';
  document.getElementById('flightCarrierRow').style.display = 'none';
  document.getElementById('editAssistPanel').style.display  = 'none';
  document.getElementById('editAssistThread').innerHTML     = '';
  document.getElementById('segFormFields').style.display    = 'block';
  document.getElementById('editAssistBtn').style.display    = 'inline-flex';
  document.getElementById('segSaveBtn').style.display       = 'inline-flex';
  document.getElementById('fConfirmed').checked = false;
  pickType(document.querySelector('.type-btn'), 'flight');
}

function closeSegModal() { document.getElementById('segOverlay').classList.remove('open'); }

async function saveSeg() {
  const depDate = parseDate(document.getElementById('fDepDate').value);
  const depTime = parseTime(document.getElementById('fDepTime').value) || '00:00';
  if (!depDate) { toast('Departure date is required'); return; }
  const arrDate = parseDate(document.getElementById('fArrDate').value);
  const arrTime = parseTime(document.getElementById('fArrTime').value) || '00:00';
  const notes   = document.getElementById('fNotes').value.trim();
  const body = {
    trip_id:          currentTrip.id,
    type:             currentType,
    origin:           document.getElementById('fFrom').value.trim() || null,
    destination:      document.getElementById('fTo').value.trim() || null,
    carrier:          (() => {
      if (currentType === 'flight') {
        const al = document.getElementById('fAirline').value.trim();
        const fn = document.getElementById('fFlightNum').value.trim().toUpperCase();
        return (al && fn) ? `${al} ${fn}` : (al || fn || null);
      }
      return document.getElementById('fCarrier').value.trim() || null;
    })(),
    departs_at:       `${depDate}T${depTime}:00`,
    departs_tz:       document.getElementById('fDepTz').value.trim() || null,
    arrives_at:       arrDate ? `${arrDate}T${arrTime}:00` : null,
    confirmation_ref: document.getElementById('fRef').value.trim() || null,
    confirmed:        document.getElementById('fConfirmed').checked,
    parse_status:     'ok',
    meta:             (() => {
      // Start from existing meta so enrichment data is preserved on edit
      const existing = editingSegId
        ? ((currentTrip.segments.find(s=>s.id===editingSegId)||{}).meta || {})
        : {};
      const m = Object.assign({}, existing);
      if (notes) m.notes = notes; else delete m.notes;
      if (currentType === 'taxi') {
        const ph = document.getElementById('fTaxiPhone').value.trim();
        const dr = document.getElementById('fTaxiDriver').value.trim();
        if (ph) m.phone = ph; if (dr) m.driver = dr;
      }
      if (currentType === 'flight') {
        const fn = document.getElementById('fFlightNum').value.trim().toUpperCase();
        if (fn) m.flight_iata = fn;
      }
      if (currentType === 'hotel') {
        const addr = document.getElementById('fHotelAddress').value.trim();
        const ph   = document.getElementById('fHotelPhone').value.trim();
        const room = document.getElementById('fHotelRoom').value.trim();
        if (addr) m.address   = addr; else if (!addr && m.address) {} // keep existing
        if (ph)   m.phone     = ph;
        if (room) m.room_type = room;
      }
      return m;
    })(),
  };
  const segDate = body.departs_at ? body.departs_at.slice(0,10) : null;
  checkDateGuardrail(segDate, async (targetTripId) => {
    if (targetTripId) body.trip_id = targetTripId;
    const url    = editingSegId ? `${API}/api/segments/${editingSegId}` : `${API}/api/segments/`;
    const method = editingSegId ? 'PATCH' : 'POST';
    const r = await fetch(url, {method, headers:H, body:JSON.stringify(body)});
    if (!r.ok) { toast('Error saving [ERR04] — check console'); console.error('[ERR04]', await r.text()); return; }
    closeSegModal();
    await selectTrip(currentTrip);
    toast(editingSegId ? 'Segment updated' : 'Segment added');
  });
}

// ── DELETE ────────────────────────────────────────────────────
async function deleteSeg(id) {
  if (!confirm('Delete this segment?')) return;
  await fetch(`${API}/api/segments/${id}`, {method:'DELETE', credentials:'include', headers:H});
  await selectTrip(currentTrip);
  toast('Segment deleted');
}

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

