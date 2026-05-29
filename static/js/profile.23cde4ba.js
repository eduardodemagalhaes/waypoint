// ── PROFILE PAGE ──────────────────────────────────────────────────────────────
function openProfile() {
  currentTrip = null;
  closeSidebar();
  closeInbox();
  closeSettings();
  closeFolderView();
  closeHomeView();
  const asb = document.getElementById('addSegBtn'); if (asb) asb.style.display = 'none';
  const etb2 = document.getElementById('editTripBtn'); if (etb2) etb2.style.display = 'none';
  ['tripBar','nlBar','statusBar','timeline'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  let pg = document.getElementById('profilePage');
  if (!pg) {
    pg = document.createElement('div');
    pg.id = 'profilePage';
    document.querySelector('.main').appendChild(pg);
  }
  pg.style.display = 'block';
  renderProfilePage(pg);
}

function closeProfile() {
  const pg = document.getElementById('profilePage');
  if (pg) pg.style.display = 'none';
}

function renderProfilePage(container) {
  const airports = (currentUser.home_airports || '').split(',').map(s=>s.trim()).filter(Boolean);
  const [a1='', a2='', a3=''] = airports;
  container.innerHTML = `<div class="profile-page">
    <div class="profile-title">Profile</div>
    <div class="profile-sub">Your personal settings and home base.</div>

    <div class="profile-section">
      <div class="profile-section-title">Account</div>
      <div class="profile-field">
        <label>Email</label>
        <input type="email" value="${currentUser.email || ''}" disabled style="opacity:.6;cursor:not-allowed">
      </div>
      <div class="profile-field">
        <label>Username</label>
        <input type="text" value="${currentUser.username || ''}" disabled style="opacity:.6;cursor:not-allowed">
      </div>
    </div>

    <div class="profile-section">
      <div class="profile-section-title">Home Base</div>
      <div class="profile-field">
        <label>Home city</label>
        <input type="text" id="profHomeCity" value="${currentUser.home_city || ''}" placeholder="e.g. Zurich">
        <div class="hint">Used to exclude your home location from ambiguous trip matching.</div>
      </div>
      <div class="profile-field">
        <label>Home airports <span style="font-weight:400;text-transform:none;letter-spacing:0">(up to 3 IATA codes)</span></label>
        <div class="profile-airports">
          <input type="text" id="profAirport1" value="${a1}" placeholder="ZRH" maxlength="4">
          <input type="text" id="profAirport2" value="${a2}" placeholder="GVA" maxlength="4">
          <input type="text" id="profAirport3" value="${a3}" placeholder="BSL" maxlength="4">
        </div>
        <div class="hint">Segments departing or arriving here won't trigger trip-match questions.</div>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:0">
      <button class="profile-save" id="profileSaveBtn" onclick="saveProfile()">Save</button>
      <span class="profile-saved" id="profileSavedMsg">✓ Saved</span>
    </div>
  </div>`;
}

async function saveProfile() {
  const btn = document.getElementById('profileSaveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const city = document.getElementById('profHomeCity').value.trim();
  const airports = [
    document.getElementById('profAirport1').value.trim().toUpperCase(),
    document.getElementById('profAirport2').value.trim().toUpperCase(),
    document.getElementById('profAirport3').value.trim().toUpperCase(),
  ].filter(Boolean).join(',');
  try {
    const r = await fetch(`${API}/api/auth/profile`, {
      method:'PATCH', credentials:'include',
      headers:{...H,'Content-Type':'application/json'},
      body: JSON.stringify({home_city: city, home_airports: airports})
    });
    if (!r.ok) throw new Error(await r.text());
    const updated = await r.json();
    currentUser = {...currentUser, ...updated};
    renderUserPill();
    const msg = document.getElementById('profileSavedMsg');
    if (msg) { msg.classList.add('show'); setTimeout(()=>msg.classList.remove('show'), 2500); }
  } catch(e) {
    console.error('[ERR15] saveProfile:', e);
    showToast('Could not save profile');
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}


// ── SEGMENT DETAILS MODAL ─────────────────────────────────────────────────────
let _detailsSegId = null;

function openSegDetails(id) {
  _detailsSegId = id;
  const seg = (currentTrip?.segments || []).find(s => s.id === id);
  if (!seg) return;
  const m = seg.meta || {};
  const type = seg.type;

  document.getElementById('segDetailsTitle').textContent =
    type.charAt(0).toUpperCase() + type.slice(1) + ' details';

  // Build all known fields
  const rows = [];
  const add = (lbl, val) => { if (val || val === 0) rows.push([lbl, val]); };

  if (type === 'flight') {
    add('From', seg.origin);
    add('To', seg.destination);
    add('Flight', seg.carrier);
    add('Status', m.flight_status || null);
    add('Aircraft', m.aircraft || null);
    add('Airline', m.airline || null);
    add('Distance', m.distance_km ? `${m.distance_km} km` : null);
    add('Departs', seg.departs_at ? seg.departs_at.slice(0,16).replace('T',' ') : null);
    add('Arrives', seg.arrives_at ? seg.arrives_at.slice(0,16).replace('T',' ') : null);
    const _detDur = flightDuration(seg.departs_at, seg.arrives_at, seg.departs_tz, seg.arrives_tz);
    if (_detDur) add('Duration', _detDur);
    if (seg.departs_tz && seg.arrives_tz && seg.departs_tz !== seg.arrives_tz) {
      add('Dep timezone', seg.departs_tz); add('Arr timezone', seg.arrives_tz);
    } else if (seg.departs_tz) { add('Timezone', seg.departs_tz); }
    add('Ref', seg.confirmation_ref);
    add('Dep terminal', m.terminal_departure ? (m.terminal_hint ? `${m.terminal_departure} ·  typical` : m.terminal_departure) : null);
    add('Dep gate', m.gate != null ? m.gate : (m.enrich_status === 'ok' ? 'TBA' : null));
    add('Arr terminal', m.terminal_arrival || null);
    add('Arr gate', m.gate_arrival || null);
    add('Boarding', m.boarding_time);
    add('Seat', m.seat);
    add('Cabin', m.cabin_class);
    add('Baggage', m.baggage_allowance);
    add('Baggage claim', m.baggage_claim);
    add('Price', m.price);
    add('Ticket #', m.ticket_number);
    add('Card', m.payment_card);
    if (m.delay_minutes > 0) add('Expected delay', `+${m.delay_minutes} min`);
    if (m.last_updated) {
      try {
        const lu = new Date(m.last_updated.replace(' ','T').replace(/Z$/,'+00:00'));
        if (!isNaN(lu)) add('Data as of', lu.toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}));
      } catch(e) {}
    }
  } else if (type === 'train') {
    add('From', seg.origin);
    add('To', seg.destination);
    add('Service', seg.carrier);
    add('Train #', m.train_number);
    add('Departs', seg.departs_at ? seg.departs_at.slice(0,16).replace('T',' ') : null);
    add('Arrives', seg.arrives_at ? seg.arrives_at.slice(0,16).replace('T',' ') : null);
    add('Class', m.class);
    add('Coach', m.coach);
    add('Seat', m.seat);
    add('Platform dep', m.platform_departure ? `Platform ${m.platform_departure}` : null);
    add('Platform arr', m.platform_arrival ? `Platform ${m.platform_arrival}` : null);
    add('Ref', seg.confirmation_ref);
    add('Price', m.price);
  } else if (type === 'hotel') {
    add('Hotel', seg.carrier);
    add('City', seg.destination || seg.origin);
    add('Check-in', seg.departs_at ? seg.departs_at.slice(0,10) : null);
    add('Check-out', seg.arrives_at ? seg.arrives_at.slice(0,10) : null);
    add('Nights', m.nights);
    add('Room', m.room_type);
    add('Check-in time', m.checkin_time);
    add('Check-out time', m.checkout_time);
    add('Address', m.address);
    add('Phone', m.phone);
    add('Ref', seg.confirmation_ref);
    add('Price', m.price);
    add('Cancellation', m.cancellation_policy);
  } else {
    add('From', seg.origin);
    add('To', seg.destination);
    add('Operator', seg.carrier);
    add('Departs', seg.departs_at ? seg.departs_at.slice(0,16).replace('T',' ') : null);
    add('Ref', seg.confirmation_ref);
    add('Price', m.price);
  }

  const body = document.getElementById('segDetailsBody');
  body.innerHTML = rows.map(([lbl, val]) =>
    `<div><div class="det-lbl">${lbl}</div><div class="det-val">${val}</div></div>`
  ).join('');

  // Show enrich button for enrichable types
  const enrichBtn = document.getElementById('segDetailsEnrichBtn');
  if (enrichBtn) enrichBtn.style.display = ['flight','train','hotel'].includes(type) ? '' : 'none';

  document.getElementById('segDetailsOverlay').classList.add('open');
}

function closeSegDetails() {
  document.getElementById('segDetailsOverlay').classList.remove('open');
  _detailsSegId = null;
}

function editFromDetails() {
  const id = _detailsSegId;
  closeSegDetails();
  if (id) openEditSeg(id);
}

async function enrichFromDetails() {
  if (!_detailsSegId) return;
  const btn = document.getElementById('segDetailsEnrichBtn');
  btn.disabled = true; btn.textContent = '⟳ Enriching…';
  await enrichSeg(_detailsSegId, btn);
  // Refresh details view with updated data
  if (_detailsSegId) {
    await selectTrip(currentTrip);
    openSegDetails(_detailsSegId);
  }
  btn.disabled = false; btn.textContent = '⟳ Enrich';
}

async function enrichFromEdit() {
  const id = window._editingSegId;
  if (!id) return;
  const btn = document.getElementById('editEnrichBtn');
  await enrichSeg(id, btn);
  // Re-populate form fields with freshly enriched data
  const seg = (currentTrip?.segments || []).find(s => s.id === id);
  if (seg) {
    // Re-open the edit form with updated segment data
    openEditSeg(id);
  }
}
