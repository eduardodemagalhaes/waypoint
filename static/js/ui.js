const UPCOMING_LIMIT = 4;

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

// ── HOME SCREEN ──────────────────────────────────────────────
function openHomeView() {
  currentTrip = null;
  const etb = document.getElementById('editTripBtn'); if (etb) etb.style.display = 'none';
  const asb = document.getElementById('addSegBtn'); if (asb) asb.style.display = 'none';
  closeSidebar();
  closeInbox();
  closeProfile();
  closeSettings();
  closeFolderView();
  ['tripBar','nlBar','statusBar','timeline'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  // pdfDropZone removed
  const cb = document.getElementById('calBtn');
  if (cb) cb.style.display = 'none';
  let pg = document.getElementById('homeView');
  if (!pg) {
    pg = document.createElement('div');
    pg.id = 'homeView';
    document.querySelector('.main').appendChild(pg);
  }
  pg.style.display = 'block';
  renderHome(pg);
  renderSidebar();
}

function closeHomeView() {
  const pg = document.getElementById('homeView');
  if (pg) pg.style.display = 'none';
}

function renderHome(container) {
  const pg = container || document.getElementById('homeView');
  if (!pg) return;
  const today = new Date().toISOString().slice(0,10);
  const upcoming = trips.filter(t => !t.end_date || t.end_date >= today)
    .sort((a,b) => (a.start_date||'').localeCompare(b.start_date||''));
  const past = trips.filter(t => t.end_date && t.end_date < today)
    .sort((a,b) => (b.start_date||'').localeCompare(a.start_date||''));
  const visible = upcoming.slice(0, UPCOMING_LIMIT);
  const overflow = upcoming.slice(UPCOMING_LIMIT);

  const tripRow = (t) => {
    const segs = t.segments ? t.segments.length : 0;
    const dates = (t.start_date||t.end_date) ? `${fmtShort(t.start_date)||'?'} – ${fmtShort(t.end_date)||'?'}` : 'No dates';
    return `<div class="home-trip-row" onclick="sidebarSelect('${t.id}')">
      <div><div class="home-trip-name">${t.name}</div><div class="home-trip-date">${dates}</div></div>
      ${segs ? `<span class="home-trip-segs">${segs} seg${segs===1?'':'s'}</span>` : ''}
    </div>`;
  };

  let tripsHtml = '';
  if (!trips.length) {
    tripsHtml = `<div style="padding:16px 0;font-size:13px;color:var(--ink3)">No trips yet — create one below.</div>`;
  } else {
    if (visible.length) tripsHtml += visible.map(tripRow).join('');
    if (overflow.length) {
      tripsHtml += `<div class="home-folder-row" onclick="openFolder('future')">
        <span>▸</span><span>More upcoming trips</span>
        <span class="home-folder-count">${overflow.length}</span>
      </div>`;
    }
    if (past.length) {
      tripsHtml += `<div class="home-folder-row" onclick="openFolder('past')">
        <span>▸</span><span>Past trips</span>
        <span class="home-folder-count">${past.length}</span>
      </div>`;
    }
  }

  pg.innerHTML = `<div class="home-page">
    <div class="home-title">Good ${greeting()}, ${(currentUser&&currentUser.username)||'traveller'}</div>
    <div class="home-sub">${homeSubtitle(upcoming, past)}</div>

    <div class="home-section-title">Quick actions</div>
    <div class="home-actions">
      <div class="home-action" onclick="openPlanner()">
        <span class="home-action-icon">✦</span>
        <span class="home-action-label">Plan with AI</span>
        <span class="home-action-sub">Describe a trip and let the assistant build it</span>
      </div>
      <div class="home-action" onclick="triggerPdfUpload()">
        <span class="home-action-icon">📄</span>
        <span class="home-action-label">Upload PDF</span>
        <span class="home-action-sub">Import a booking confirmation or boarding pass</span>
      </div>
      <div class="home-action" onclick="openNewTrip()">
        <span class="home-action-icon">＋</span>
        <span class="home-action-label">New trip</span>
        <span class="home-action-sub">Create a trip manually and add segments</span>
      </div>
    </div>
    <div class="home-email-tip">
      <span>📬</span>
      <span>Forward booking emails to</span>
      <span class="home-email-addr" title="Click to copy" onclick="copyEmailAddr(this)">waypoint@emdm.ch</span>
      <span style="margin-left:auto;font-size:11px;color:var(--ink4)">and they'll appear in Inbox</span>
    </div>

    ${trips.length ? `<div class="home-section-title" style="margin-top:28px">Trips</div>
    <div class="home-trips">${tripsHtml}</div>` : tripsHtml}
  </div>`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning'; if (h < 18) return 'afternoon'; return 'evening';
}
function homeSubtitle(upcoming, past) {
  if (!upcoming.length && !past.length) return 'No trips yet. Start planning below.';
  if (upcoming.length) {
    const next = upcoming[0];
    const diff = next.start_date ? Math.ceil((new Date(next.start_date)-new Date())/86400000) : null;
    const when = diff === null ? '' : diff <= 0 ? ' — underway' : diff === 1 ? ' — tomorrow' : ` — in ${diff} days`;
    return `Next trip: <strong>${next.name}</strong>${when}`;
  }
  return `${past.length} past trip${past.length===1?'':'s'}`;
}
function copyEmailAddr(el) {
  navigator.clipboard.writeText('waypoint@emdm.ch').then(() => {
    const orig = el.textContent;
    el.textContent = 'Copied!';
    setTimeout(() => el.textContent = orig, 1500);
  });
}

// ── SIDEBAR ──────────────────────────────────────────────────

function renderSidebar() {
  const today = new Date().toISOString().slice(0,10);
  const upcoming = trips.filter(t => !t.end_date || t.end_date >= today);
  const past     = trips.filter(t => t.end_date  && t.end_date <  today);
  upcoming.sort((a,b) => (a.start_date||'').localeCompare(b.start_date||''));
  past.sort((a,b)     => (b.start_date||'').localeCompare(a.start_date||''));

  const visible   = upcoming.slice(0, UPCOMING_LIMIT);
  const overflow  = upcoming.slice(UPCOMING_LIMIT);

  let html = '';
  if (visible.length) {
    html += '<div class="sidebar-section">Upcoming</div>';
    html += visible.map(t => sidebarItem(t)).join('');
  }
  if (overflow.length) {
    const folderActive = currentFolder === 'future' ? 'active' : '';
    html += `<div class="sidebar-folder ${folderActive}" onclick="openFolder('future')">
      <span class="sidebar-folder-arrow">▸</span>
      <span>More trips</span>
      <span class="sidebar-folder-count">${overflow.length}</span>
    </div>`;
  }
  if (past.length) {
    const folderActive = currentFolder === 'past' ? 'active' : '';
    html += '<div class="sidebar-section" style="margin-top:8px">Past</div>';
    html += `<div class="sidebar-folder ${folderActive}" onclick="openFolder('past')">
      <span class="sidebar-folder-arrow">▸</span>
      <span>Past trips</span>
      <span class="sidebar-folder-count">${past.length}</span>
    </div>`;
  }
  if (!html) html = '<div style="padding:12px 14px;font-size:12px;color:var(--ink3)">No trips yet</div>';
  document.getElementById('sidebarContent').innerHTML = html;
}

function sidebarItem(t) {
  const active = currentTrip && t.id === currentTrip.id ? 'active' : '';
  const segCount = t.segments ? t.segments.length : '';
  const dates = (t.start_date || t.end_date)
    ? `${fmtShort(t.start_date)||'?'} – ${fmtShort(t.end_date)||'?'}` : 'No dates';
  return `<div class="sidebar-item ${active}" onclick="sidebarSelect('${t.id}')">
    <div class="sidebar-item-name">${t.name}</div>
    <div class="sidebar-item-date">${dates}</div>
    ${segCount ? `<div class="sidebar-item-seg">${segCount} segment${segCount===1?'':'s'}</div>` : ''}
  </div>`;
}

function sidebarSelect(tripId) {
  const trip = trips.find(t => t.id === tripId);
  if (trip) { closeInbox(); closeProfile(); closeFolderView(); selectTrip(trip); closeSidebar(); }
}

// ── FOLDER VIEW ──────────────────────────────────────────────
let currentFolder = null; // 'past' | 'future' | null

function openFolder(which) {
  currentFolder = which;
  currentTrip = null;
  closeSidebar();
  closeInbox();
  closeProfile();
  ['tripBar','nlBar','statusBar','timeline'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  // pdfDropZone removed
  const cb = document.getElementById('calBtn');
  if (cb) cb.style.display = 'none';

  let view = document.getElementById('folderView');
  if (!view) {
    view = document.createElement('div');
    view.id = 'folderView';
    document.querySelector('.main').appendChild(view);
  }
  view.style.display = 'block';
  renderFolderView(view, which);
  renderSidebar(); // refresh active state
}

function closeFolderView() {
  currentFolder = null;
  const view = document.getElementById('folderView');
  if (view) view.style.display = 'none';
}

function renderFolderView(container, which) {
  const today = new Date().toISOString().slice(0,10);
  let list, title, emptyMsg;
  if (which === 'past') {
    list = trips.filter(t => t.end_date && t.end_date < today);
    list.sort((a,b) => (b.start_date||'').localeCompare(a.start_date||'')); // newest first
    title = 'Past trips';
    emptyMsg = 'No past trips yet.';
  } else {
    const upcoming = trips.filter(t => !t.end_date || t.end_date >= today);
    upcoming.sort((a,b) => (a.start_date||'').localeCompare(b.start_date||''));
    list = upcoming.slice(UPCOMING_LIMIT);
    title = 'More trips';
    emptyMsg = 'No additional trips.';
  }

  if (!list.length) {
    container.innerHTML = `<div style="padding:2rem 0;color:var(--ink3);font-size:14px">${emptyMsg}</div>`;
    return;
  }

  const rows = list.map(t => {
    const segCount = t.segments ? t.segments.length : 0;
    const dates = (t.start_date || t.end_date)
      ? `${fmtShort(t.start_date)||'?'} – ${fmtShort(t.end_date)||'?'}` : 'No dates';
    const segsLabel = segCount ? `<span style="color:var(--ink4);font-size:12px">${segCount} segment${segCount===1?'':'s'}</span>` : '';
    return `<div class="folder-trip-row" onclick="sidebarSelect('${t.id}')">
      <div>
        <div style="font-size:14px;font-weight:500;color:var(--ink)">${t.name}</div>
        <div style="font-size:12px;color:var(--ink3);margin-top:2px">${dates}</div>
      </div>
      ${segsLabel}
    </div>`;
  }).join('');

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:1.2rem">
      <h2 style="font-size:1.1rem;font-weight:600;color:var(--ink);margin:0">${title}</h2>
      <span style="font-size:12px;color:var(--ink4)">${list.length} trip${list.length===1?'':'s'}</span>
    </div>
    <div class="folder-trip-list">${rows}</div>`;
}

function toggleDD() {} // legacy no-op
function renderTripDD() { renderSidebar(); }

function appendStuckCard(message) {
  const thread = document.getElementById('nlThread');
  if (!thread) return;
  const msg = message || "I\'m not sure I can help with this. It might be outside my current capabilities, or there could be a bug.";
  const card = document.createElement('div');
  card.className = 'stuck-card';
  card.innerHTML = `
    <p>${msg}</p>
    <div class="stuck-actions">
      <a class="stuck-btn primary" href="mailto:waypoint@emdm.ch?subject=Bug+report&body=What+I+tried+to+do:%0A%0AWhat+happened:%0A%0ABrowser:" target="_blank">🐛 Report a bug</a>
      <a class="stuck-btn" href="mailto:waypoint@emdm.ch?subject=Feature+request&body=What+I'd+like+Waypoint+to+do:" target="_blank">✦ Request a feature</a>
      <button class="stuck-btn" onclick="cancelDialog()">Start over</button>
    </div>`;
  thread.appendChild(card);
  thread.scrollTop = thread.scrollHeight;
}

// ── NAV / TRIP SELECT ───────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('mob-open');
  document.getElementById('mobOverlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mob-open');
  document.getElementById('mobOverlay').classList.remove('open');
}

async function selectTrip(trip) {
  if (!trip) return;
  const etb = document.getElementById('editTripBtn'); if (etb) etb.style.display = 'inline-flex';
  const asb = document.getElementById('addSegBtn'); if (asb) asb.style.display = 'inline-flex';
  if (document.activeElement) document.activeElement.blur();
  closeInbox(); closeProfile(); _showMainContent();
  if (window.innerWidth <= 700) closeSidebar();
  // pdfDropZone removed
  const cb = document.getElementById('calBtn');
  if (cb) cb.style.display = 'inline-flex';
  cancelDialog();
  currentTrip = trip;
  document.getElementById('tripName').textContent = trip.name;
  const r = await fetch(`${API}/api/trips/${trip.id}`, {credentials:'include', headers:H});
  currentTrip = await r.json();
  // Sync segment count back into trips array for sidebar
  const idx = trips.findIndex(t => t.id === currentTrip.id);
  if (idx >= 0) trips[idx] = {...trips[idx], segments: currentTrip.segments};
  renderSidebar();
  renderMeta();
  renderTimeline();
}

function renderMeta() {
  const t = currentTrip;
  const locPart = t.location ? `${t.location} · ` : '';
  const datePart = [fmt(t.start_date), fmt(t.end_date)].filter(Boolean).join(' – ');
  document.getElementById('tripMeta').textContent = locPart + datePart;
  document.getElementById('statusBar').style.display = 'flex';
  document.getElementById('sDep').textContent = fmtShort(t.start_date) || '—';
  document.getElementById('sRet').textContent = fmtShort(t.end_date) || '—';
  const segs = t.segments || [];
  document.getElementById('sSeg').textContent = segs.length;
  if (t.start_date) {
    const diff = Math.ceil((new Date(t.start_date) - new Date()) / 86400000);
    document.getElementById('sNext').textContent =
      diff > 0 ? `${diff}d` : diff === 0 ? 'Today' : 'Past';
  }
  const review = segs.filter(s => s.parse_status === 'needs_review' || s.parse_status === 'failed');
  const rb = document.getElementById('reviewBanner');
  if (review.length) {
    rb.style.display = 'flex';
    document.getElementById('reviewText').textContent =
      `${review.length} segment${review.length>1?'s':''} need${review.length>1?'':'s'} review.`;
  } else {
    rb.style.display = 'none';
  }
}
