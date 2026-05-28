// ── API USAGE WIDGET ──────────────────────────────────────────────────────────
async function loadUsageWidget() { /* moved to admin panel */ }

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

// ── ORPHAN INBOX ──────────────────────────────────────────────────────────────
let orphans = [];

async function loadOrphans() {
  try {
    const r = await fetch(`${API}/api/emails/orphans`, {credentials:'include', headers:H});
    if (!r.ok) { orphans = []; return; }
    orphans = await r.json();
  } catch(e) { orphans = []; }
  renderInboxBadge();
}

function renderInboxBadge() {
  const badge = document.getElementById('inboxBadge');
  const nav   = document.getElementById('inboxNav');
  if (!badge || !nav) return;
  if (orphans.length > 0) {
    badge.textContent = orphans.length;
    badge.style.display = 'inline-block';
    nav.classList.add('has-orphans');
  } else {
    badge.style.display = 'none';
    nav.classList.remove('has-orphans');
  }
}

function openInbox() {
  currentTrip = null;
  closeSidebar();
  closeProfile();
  ['tripBar','nlBar','statusBar','timeline'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  let inbox = document.getElementById('inboxView');
  if (!inbox) {
    inbox = document.createElement('div');
    inbox.id = 'inboxView';
    document.querySelector('.main').appendChild(inbox);
  }
  inbox.style.display = 'block';
  renderInboxView(inbox);
}

function closeInbox() {
  const inbox = document.getElementById('inboxView');
  if (inbox) inbox.style.display = 'none';
}
function _showMainContent() {
  closeFolderView();
  closeSettings();
  closeHomeView();
  ['tripBar','nlBar','statusBar','timeline'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = '';
  });
}

const SEG_ICONS_ORPHAN = {flight:'✈️',train:'🚆',hotel:'🏨',car:'🚗',taxi:'🚕',activity:'🎭',other:'📌'};

function renderInboxView(container) {
  if (orphans.length === 0) {
    container.innerHTML = `<div class="orphan-tray">
      <div class="orphan-tray-title">Inbox</div>
      <div class="orphan-tray-sub">No unassigned segments — you're all caught up.</div>
    </div>`;
    return;
  }

  // Group orphans by raw_email_id
  const groups = {};
  for (const seg of orphans) {
    const key = seg.raw_email_id || '__none__';
    if (!groups[key]) groups[key] = {subject: seg.email_subject, segs: []};
    groups[key].segs.push(seg);
  }

  let html = `<div class="orphan-tray">
    <div class="orphan-tray-title">📬 Inbox</div>
    <div class="orphan-tray-sub">${orphans.length} unassigned segment${orphans.length===1?'':'s'} — tap a group to assign.</div>`;

  for (const [key, group] of Object.entries(groups)) {
    const groupId = key.replace(/[^a-z0-9]/gi,'_');
    html += `<div class="orphan-group" id="ogrp_${groupId}">
      <div class="orphan-group-hdr">From: ${group.subject || '(no subject)'}</div>`;
    for (const seg of group.segs) {
      const icon = SEG_ICONS_ORPHAN[seg.type] || '📌';
      const route = seg.origin && seg.destination ? `${seg.origin} → ${seg.destination}` : (seg.destination || seg.origin || '');
      const date  = seg.departs_at ? seg.departs_at.slice(0,10) : '';
      const carrier = seg.carrier || '';
      html += `<div class="orphan-seg">
        <div class="orphan-seg-icon">${icon}</div>
        <div class="orphan-seg-body">
          <div class="orphan-seg-main">${seg.type.charAt(0).toUpperCase()+seg.type.slice(1)}${route ? ' · ' + route : ''}</div>
          <div class="orphan-seg-sub">${[date, carrier, seg.confirmation_ref].filter(Boolean).join(' · ')}</div>
        </div>
      </div>`;
    }
    // Trip selector
    const tripOpts = trips.map(t =>
      `<option value="${t.id}">${t.name}${t.start_date ? ' ('+t.start_date.slice(0,7)+')' : ''}</option>`
    ).join('');
    const segIds = JSON.stringify(group.segs.map(s => s.id));
    html += `<div class="orphan-actions">
      <select class="orphan-select" id="osel_${groupId}">
        <option value="">— Add to existing trip…</option>
        ${tripOpts}
        <option value="__new__">✦ Create new trip</option>
      </select>
      <button class="orphan-btn primary" onclick="assignOrphans('${groupId}', ${encodeURIComponent(JSON.stringify(group.segs.map(s=>s.id)))})">Assign</button>
      <button class="orphan-btn secondary" onclick="discardOrphans(${encodeURIComponent(JSON.stringify(group.segs.map(s=>s.id)))}, '${groupId}')">Discard</button>
    </div></div>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

async function assignOrphans(groupId, encodedIds) {
  const segIds = JSON.parse(decodeURIComponent(encodedIds));
  const sel = document.getElementById(`osel_${groupId}`);
  if (!sel || !sel.value) { showToast('Select a trip first'); return; }
  const tripId = sel.value;
  const btn = sel.parentElement.querySelector('.orphan-btn.primary');
  btn.disabled = true; btn.textContent = 'Assigning…';

  try {
    if (tripId === '__new__') {
      // Create trip from first segment's data then assign
      const firstSeg = orphans.find(s => segIds.includes(s.id));
      const dest = firstSeg?.destination || 'Trip';
      const month = firstSeg?.departs_at ? new Date(firstSeg.departs_at).toLocaleDateString('en',{month:'short',year:'numeric'}) : '';
      const newTripName = month ? `${dest} · ${month}` : dest;
      const tr = await fetch(`${API}/api/trips/`, {
        method:'POST', credentials:'include', headers:{...H,'Content-Type':'application/json'},
        body: JSON.stringify({name:newTripName, start_date: firstSeg?.departs_at?.slice(0,10)||null, end_date: firstSeg?.departs_at?.slice(0,10)||null})
      });
      if (!tr.ok) { showToast('Could not create trip'); btn.disabled=false; btn.textContent='Assign'; return; }
      const newTrip = await tr.json();
      await _assignSegmentsToTrip(segIds, newTrip.id);
      trips.push(newTrip);
    } else {
      await _assignSegmentsToTrip(segIds, tripId);
    }
    orphans = orphans.filter(s => !segIds.includes(s.id));
    renderInboxBadge();
    const inbox = document.getElementById('inboxView');
    if (inbox) renderInboxView(inbox);
    await loadTrips();
    showToast('Segments assigned ✓');
  } catch(e) {
    console.error('[ERR13] assignOrphans:', e);
    showToast('Assignment failed');
    btn.disabled=false; btn.textContent='Assign';
  }
}

async function _assignSegmentsToTrip(segIds, tripId) {
  await Promise.all(segIds.map(sid =>
    fetch(`${API}/api/segments/${sid}`, {
      method:'PATCH', credentials:'include', headers:{...H,'Content-Type':'application/json'},
      body: JSON.stringify({trip_id: tripId, parse_status: 'ok'})
    })
  ));
}

async function discardOrphans(encodedIds, groupId) {
  const segIds = JSON.parse(decodeURIComponent(encodedIds));
  if (!confirm(`Discard ${segIds.length} segment${segIds.length===1?'':'s'}? This cannot be undone.`)) return;
  try {
    await Promise.all(segIds.map(sid =>
      fetch(`${API}/api/segments/${sid}`, {method:'DELETE', credentials:'include', headers:H})
    ));
    orphans = orphans.filter(s => !segIds.includes(s.id));
    renderInboxBadge();
    const inbox = document.getElementById('inboxView');
    if (inbox) renderInboxView(inbox);
    showToast('Discarded');
  } catch(e) {
    console.error('[ERR14] discardOrphans:', e);
    showToast('Error discarding segments');
  }
}

// ── THEME ────────────────────────────────────────────────────
function getTheme() {
  return localStorage.getItem('wp_theme') || 'system';
}
function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'dark')  { root.setAttribute('data-theme','dark'); }
  else if (t === 'light') { root.setAttribute('data-theme','light'); }
  else { root.removeAttribute('data-theme'); }
}
function setTheme(t) {
  localStorage.setItem('wp_theme', t);
  applyTheme(t);
  // update picker UI if open
  document.querySelectorAll('.theme-opt').forEach(el => {
    el.classList.toggle('sel', el.getAttribute('onclick') === `setTheme('${t}')`);
  });
}
// apply on load
applyTheme(getTheme());

function openSettings() {
  currentTrip = null;
  closeSidebar();
  closeInbox();
  closeProfile();
  closeFolderView();
  closeHomeView();
  const asb = document.getElementById('addSegBtn'); if (asb) asb.style.display = 'none';
  const etb3 = document.getElementById('editTripBtn'); if (etb3) etb3.style.display = 'none';
  ['tripBar','nlBar','statusBar','timeline'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  // pdfDropZone removed
  let pg = document.getElementById('settingsPage');
  if (!pg) {
    pg = document.createElement('div');
    pg.id = 'settingsPage';
    document.querySelector('.main').appendChild(pg);
  }
  pg.style.display = 'block';
  renderSettingsPage(pg);
}

function closeSettings() {
  const pg = document.getElementById('settingsPage');
  if (pg) pg.style.display = 'none';
}

function renderSettingsPage(container) {
  container.innerHTML = `<div class="profile-page">
    <div class="profile-title">Settings</div>
    <div class="profile-sub">Appearance and system preferences.</div>

    <div class="profile-section">
      <div class="profile-section-title">Appearance</div>
      <div class="profile-field">
        <label>Theme</label>
        <div class="theme-picker" id="themePicker">
          <div class="theme-opt \${getTheme()==='light'?'sel':''}" onclick="setTheme('light')">
            <span class="theme-opt-icon">☀️</span><span>Light</span>
          </div>
          <div class="theme-opt \${getTheme()==='dark'?'sel':''}" onclick="setTheme('dark')">
            <span class="theme-opt-icon">🌙</span><span>Dark</span>
          </div>
          <div class="theme-opt \${getTheme()==='system'?'sel':''}" onclick="setTheme('system')">
            <span class="theme-opt-icon">💻</span><span>System</span>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

