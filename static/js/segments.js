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
