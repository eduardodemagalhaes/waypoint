// ── CONNECTION SEARCH ────────────────────────────────────────────────────────

async function searchConnections(fromStation, toStation, options = {}) {
  // options: {datetime, arrive_before, targetEl}
  const targetEl = options.targetEl || document.getElementById('connResults');
  if (!targetEl) return;

  targetEl.style.display = 'block';
  targetEl.innerHTML = `<div class="conn-panel">
    <div class="conn-header">🔍 Searching connections…</div>
  </div>`;

  try {
    const r = await fetch(`${API}/api/parse/connections/search`, {
      method: 'POST',
      headers: {...H, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        from_station: fromStation,
        to_station: toStation,
        datetime: options.datetime || null,
        arrive_before: options.arrive_before || null,
      })
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    renderConnectionResults(d, fromStation, toStation, targetEl);
  } catch(e) {
    targetEl.innerHTML = `<div class="conn-panel">
      <div class="conn-header" style="color:var(--accent)">Connection search failed [ERR12]</div>
      <div style="padding:10px 12px;font-size:12px;color:var(--ink3)">${e.message}</div>
    </div>`;
  }
}

function renderConnectionResults(d, fromStation, toStation, targetEl) {
  const conns = d.connections || [];
  const fb    = d.fallback;

  let html = `<div class="conn-panel">
    <div class="conn-header">
      <span>🚂 ${fromStation} → ${toStation}</span>
      <button onclick="this.closest('.conn-panel').parentElement.style.display='none'"
        style="background:none;border:none;cursor:pointer;color:var(--ink3);font-size:14px">✕</button>
    </div>`;

  if (conns.length) {
    conns.forEach((c, i) => {
      const plat = c.platform_dep
        ? `<span class="conn-plat">Pl. ${c.platform_dep}</span>` : '';
      const xfer = c.transfers > 0
        ? `${c.transfers} change${c.transfers>1?'s':''}` : 'Direct';
      const dur  = (c.duration||'').replace('00d','').replace(':00','').trim();
      html += `<div class="conn-item" onclick="addConnectionSeg(${JSON.stringify(c).replace(/"/g,'&quot;')})">
        <div>
          <div class="conn-time">${c.departs.slice(11,16)} <span class="conn-arrow">→</span> ${c.arrives.slice(11,16)}</div>
          <div class="conn-meta">${c.carrier||'Train'} · ${xfer} · ${dur}</div>
        </div>
        ${plat}
        <button class="conn-add" onclick="event.stopPropagation();addConnectionSeg(${JSON.stringify(c).replace(/"/g,'&quot;')})">+ Add</button>
      </div>`;
    });
  }

  if (fb) {
    const suggestions = fb.suggestions || [];
    if (suggestions.length) {
      html += `<div class="conn-fallback">
        <div style="font-size:11px;font-weight:600;color:var(--ink3);margin-bottom:6px">
          ${conns.length ? 'Also try:' : 'No live results — alternatives:'}
        </div>`;
      suggestions.forEach(s => {
        if (s.type === 'taxi') {
          html += `<div class="conn-fallback-item">🚕 ${s.label}
            <a href="${s.search_url}" target="_blank" class="conn-fallback-link">Open in Maps ↗</a>
          </div>`;
        } else {
          html += `<div class="conn-fallback-item">🌐
            <a href="${s.url}" target="_blank" class="conn-fallback-link">${s.label} ↗</a>
            <span style="color:var(--ink4)">${s.note}</span>
          </div>`;
        }
      });
      html += '</div>';
    }
  }

  if (!conns.length && !fb?.suggestions?.length) {
    html += `<div style="padding:12px;font-size:12px;color:var(--ink3)">No connections found for this route.</div>`;
  }

  html += '</div>';
  targetEl.innerHTML = html;
}

async function addConnectionSeg(conn) {
  if (!currentTrip) { toast('Select a trip first'); return; }
  // Build segment from connection result
  const depDate = conn.departs.slice(0,10);
  const depTime = conn.departs.slice(11,16);
  const arrDate = conn.arrives.slice(0,10);
  const arrTime = conn.arrives.slice(11,16);

  const body = {
    trip_id:     currentTrip.id,
    type:        'train',
    origin:      conn.from_name,
    destination: conn.to_name,
    carrier:     conn.carrier || null,
    departs_at:  `${depDate}T${depTime}`,
    arrives_at:  `${arrDate}T${arrTime}`,
    confirmed:   false,
    meta: {
      platform_departure: conn.platform_dep || null,
      platform_arrival:   conn.platform_arr || null,
      source: 'connection-search',
    }
  };

  try {
    const r = await fetch(`${API}/api/segments/`, {
      method: 'POST',
      headers: {...H, 'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(await r.text());
    await selectTrip(currentTrip);
    toast(`Added: ${conn.carrier||'Train'} ${depTime}→${arrTime} ✓`);
    // Hide conn panel
    document.getElementById('connResults').style.display = 'none';
  } catch(e) {
    toast('Failed to add segment [ERR11]'); console.error('[ERR11]', e);
  }
}

// Detect connection search intent in NL bar
function detectConnectionSearch(text) {
  const lower = text.toLowerCase();
  const keywords = ['connection', 'train from', 'get from', 'how to get', 'travel from',
                    'connection from', 'find a train', 'next train', 'trains from'];
  return keywords.some(k => lower.includes(k));
}

boot();

// ── DATE GUARDRAIL ────────────────────────────────────────────
let _guardrailCallback = null;

function closeGuardrail() {
  document.getElementById('guardrailOverlay').classList.remove('open');
  _guardrailCallback = null;
}

function checkDateGuardrail(segDate, onProceed) {
  if (!segDate || !currentTrip) { onProceed(null); return; }
  const start = currentTrip.start_date;
  const end   = currentTrip.end_date;
  const outside = (start && segDate < start) || (end && segDate > end);
  if (!outside) { onProceed(null); return; }

  // Find another trip that covers this date
  const matchingTrip = trips.find(t =>
    t.id !== currentTrip.id &&
    t.start_date && t.end_date &&
    segDate >= t.start_date && segDate <= t.end_date
  );

  const fmt = d => d ? d.split('-').reverse().join('.') : '?';
  document.getElementById('guardrailMsg').textContent =
    `The segment date (${fmt(segDate)}) is outside "${currentTrip.name}" ` +
    `(${fmt(start)} – ${fmt(end)}). How would you like to proceed?`;

  const actions = document.getElementById('guardrailActions');
  actions.innerHTML = '';

  // Option 1: Update trip dates
  const btnExpand = document.createElement('button');
  btnExpand.className = 'btn btn-primary';
  btnExpand.textContent = 'Update trip dates to include this date';
  btnExpand.onclick = async () => {
    const newStart = (start && segDate < start) ? segDate : start;
    const newEnd   = (end   && segDate > end)   ? segDate : end;
    await fetch(`${API}/api/trips/${currentTrip.id}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({start_date: newStart, end_date: newEnd}),
    });
    // Refresh trip in memory
    const tr = await fetch(`${API}/api/trips/${currentTrip.id}`, {headers: H});
    const updated = await tr.json();
    currentTrip = {...currentTrip, start_date: updated.start_date, end_date: updated.end_date};
    const idx = trips.findIndex(t => t.id === currentTrip.id);
    if (idx >= 0) trips[idx] = {...trips[idx], ...currentTrip};
    closeGuardrail();
    onProceed(null);
  };
  actions.appendChild(btnExpand);

  // Option 2: Move to matching trip (if exists)
  if (matchingTrip) {
    const btnMove = document.createElement('button');
    btnMove.className = 'btn btn-secondary';
    btnMove.textContent = `Move to "${matchingTrip.name}" (${fmt(matchingTrip.start_date)} – ${fmt(matchingTrip.end_date)})`;
    btnMove.onclick = async () => {
      closeGuardrail();
      onProceed(matchingTrip.id);
    };
    actions.appendChild(btnMove);
  }

  // Option 3: Create new trip
  const btnNew = document.createElement('button');
  btnNew.className = 'btn btn-ghost';
  btnNew.textContent = 'Create a new trip for this date';
  btnNew.onclick = () => { closeGuardrail(); openNewTrip(); };
  actions.appendChild(btnNew);

  // Option 4: Save anyway
  const btnAnyway = document.createElement('button');
  btnAnyway.className = 'btn btn-ghost';
  btnAnyway.style.color = 'var(--text-tertiary)';
  btnAnyway.textContent = 'Save to current trip anyway';
  btnAnyway.onclick = () => { closeGuardrail(); onProceed(null); };
  actions.appendChild(btnAnyway);

  document.getElementById('guardrailOverlay').classList.add('open');
}
</script>

<!-- ── AUTH SCREEN ─────────────────────────────────────────── -->
<div class="auth-screen" id="authScreen" style="display:none">
  <div class="auth-card">
    <div class="auth-logo"><div class="auth-logo-dot"></div>Waypoint</div>

    <!-- LOGIN -->
    <div id="authLogin">
      <div class="auth-title">Sign in</div>
      <div class="auth-field"><label>Email</label>
        <input type="email" id="loginEmail" autocomplete="email" placeholder="you@example.com">
      </div>
      <div class="auth-field"><label>Password</label>
        <input type="password" id="loginPassword" autocomplete="current-password" placeholder="••••••••">
      </div>
      <button class="auth-btn" id="loginBtn" onclick="doLogin()">Sign in</button>
      <div class="auth-error" id="loginError"></div>
      <hr class="auth-divider">
      <div class="auth-switch">
        <a onclick="showForgot()">Forgot password?</a>
        &nbsp;·&nbsp;
        <a onclick="showRegister()">Create account</a>
      </div>
    </div>

    <!-- REGISTER -->
    <div id="authRegister" style="display:none">
      <div class="auth-title">Create account</div>
      <div class="auth-field"><label>Email</label>
        <input type="email" id="regEmail" autocomplete="email" placeholder="you@example.com">
      </div>
      <div class="auth-field"><label>Password</label>
        <input type="password" id="regPassword" autocomplete="new-password" placeholder="Min 8 characters">
      </div>
      <button class="auth-btn" id="registerBtn" onclick="doRegister()">Create account</button>
      <div class="auth-error" id="registerError"></div>
      <div class="auth-success" id="registerSuccess"></div>
      <hr class="auth-divider">
      <div class="auth-switch">Already have an account? <a onclick="showLogin()">Sign in</a></div>
    </div>

    <!-- FORGOT PASSWORD -->
    <div id="authForgot" style="display:none">
      <div class="auth-title">Reset password</div>
      <div class="auth-field"><label>Email</label>
        <input type="email" id="forgotEmail" autocomplete="email" placeholder="you@example.com">
      </div>
      <button class="auth-btn" id="forgotBtn" onclick="doForgot()">Send reset link</button>
      <div class="auth-error" id="forgotError"></div>
      <div class="auth-success" id="forgotSuccess"></div>
      <hr class="auth-divider">
      <div class="auth-switch"><a onclick="showLogin()">← Back to sign in</a></div>
    </div>

    <!-- RESET PASSWORD (shown when ?token= in URL) -->
    <div id="authReset" style="display:none">
      <div class="auth-title">Set new password</div>
      <div class="auth-field"><label>New password</label>
        <input type="password" id="resetPassword" autocomplete="new-password" placeholder="Min 8 characters">
      </div>
      <div class="auth-field"><label>Confirm password</label>
        <input type="password" id="resetPassword2" autocomplete="new-password" placeholder="Repeat password">
      </div>
      <button class="auth-btn" id="resetBtn" onclick="doReset()">Set new password</button>
      <div class="auth-error" id="resetError"></div>
      <div class="auth-success" id="resetSuccess"></div>
    </div>
  </div>
</div>


<script>
document.addEventListener('DOMContentLoaded', () => {
  ['loginEmail','loginPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  });
  ['regUsername','regEmail','regPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if(e.key==='Enter') doRegister(); });
  });
  const fe = document.getElementById('forgotEmail');
  if (fe) fe.addEventListener('keydown', e => { if(e.key==='Enter') doForgot(); });
});
