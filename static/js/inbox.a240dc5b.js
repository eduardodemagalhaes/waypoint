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
