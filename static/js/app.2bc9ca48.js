// ── CONFIG ───────────────────────────────────────────────────
const API = '';
// Auth via session cookie — no token header needed
const H   = {'Content-Type':'application/json'};

// ── STATE ────────────────────────────────────────────────────
let trips = [], currentTrip = null, editingSegId = null;
let currentUser = null;

// ── DIALOG STATE ─────────────────────────────────────────────
let dlg = {
  active:false,
  history:[],
  draft:null,
  avNote:null,
  returnDraft:null,
  returnAvNote:null,
  awaitingReturn:false,
};

// ── BOOT ─────────────────────────────────────────────────────
async function boot() {
  // Check for password reset token in URL
  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = urlParams.get('token');
  if (window.location.pathname.includes('reset-password') || resetToken) {
    await showResetScreen(resetToken);
    return;
  }

  // Check auth
  try {
    const r = await fetch(`${API}/api/auth/me`, {credentials:'include'});
    if (!r.ok) { showAuthScreen(); return; }
    currentUser = await r.json();
  } catch(e) { showAuthScreen(); return; }

  // Authenticated — render app
  hideAuthScreen();
  renderUserPill();
  if (window.innerWidth <= 700) document.getElementById('mobMenuBtn').style.display = 'inline-flex';
  if (window.innerWidth <= 700) document.getElementById('mobFab').style.display = 'flex';
  await loadTrips();
  await loadOrphans();
  await loadUsageWidget();
  openHomeView();
}

// ── AUTH UI ───────────────────────────────────────────────────
function showAuthScreen()  { document.getElementById('authScreen').style.display = 'flex'; }
function hideAuthScreen()  { document.getElementById('authScreen').style.display = 'none'; }
function showLogin()    { _authPanel('authLogin'); }
function showRegister() { _authPanel('authRegister'); }
function showForgot()   { _authPanel('authForgot'); }
function _authPanel(id) {
  ['authLogin','authRegister','authForgot','authReset'].forEach(p => {
    document.getElementById(p).style.display = p === id ? '' : 'none';
  });
}
async function showResetScreen(token) {
  showAuthScreen();
  _authPanel('authReset');
  const el = document.getElementById('authReset');
  el.dataset.token = token || '';
  // Validate token immediately so user gets early feedback
  if (!token) {
    document.getElementById('resetError').textContent = 'Invalid or missing reset link.';
    document.getElementById('resetBtn').disabled = true;
    return;
  }
  // Quick pre-check by attempting a dummy reset — actually just show form and let submit handle it
  // Token validity is checked server-side on submit; no need to expose a validation endpoint
  document.getElementById('resetError').textContent = '';
  document.getElementById('resetBtn').disabled = false;
}

function renderUserPill() {
  const el = document.getElementById('hdrUser');
  if (!el || !currentUser) return;
  el.style.display = 'flex';
  const av = document.getElementById('hdrAvatar');
  if (av) {
    av.style.display = 'flex';
    const initials = (currentUser.username||'?').slice(0,1).toUpperCase() +
      ((currentUser.username||'').split(' ')[1]||'').slice(0,1).toUpperCase();
    av.innerHTML = currentUser.avatar_url
      ? `<img src="${currentUser.avatar_url}" alt="">`
      : initials;
  }
  // sidebar profile label is static ("Profile" + person icon)
  const ub = document.getElementById('sidebarUserBlock');
  if (ub) ub.style.display = 'block';
}

async function doLogin() {
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const r = await fetch(`${API}/api/auth/login`, {
      method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email, password})
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.detail || 'Login failed'; return; }
    currentUser = d.user;
    hideAuthScreen();
    renderUserPill();
    await loadTrips();
    if (Array.isArray(trips) && trips.length) selectTrip(trips[0]);
    else renderEmpty();
  } catch(e) { err.textContent = 'Connection error'; }
  finally { btn.disabled = false; btn.textContent = 'Sign in'; }
}

async function doRegister() {
  const btn = document.getElementById('registerBtn');
  const err = document.getElementById('registerError');
  const suc = document.getElementById('registerSuccess');
  const email    = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  err.textContent = ''; suc.textContent = '';
  btn.disabled = true; btn.textContent = 'Creating account…';
  try {
    const r = await fetch(`${API}/api/auth/register`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email, password})
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.detail || 'Registration failed'; return; }
    suc.textContent = '✓ Check your email to confirm your account.';
    document.getElementById('regEmail').value = '';
    document.getElementById('regPassword').value = '';
  } catch(e) { err.textContent = 'Connection error'; }
  finally { btn.disabled = false; btn.textContent = 'Create account'; }
}

async function doForgot() {
  const btn = document.getElementById('forgotBtn');
  const err = document.getElementById('forgotError');
  const suc = document.getElementById('forgotSuccess');
  const email = document.getElementById('forgotEmail').value.trim();
  err.textContent = ''; suc.textContent = '';
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const r = await fetch(`${API}/api/auth/forgot-password`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email})
    });
    const d = await r.json();
    suc.textContent = d.message || 'If that email is registered, a reset link has been sent.';
  } catch(e) { err.textContent = 'Connection error'; }
  finally { btn.disabled = false; btn.textContent = 'Send reset link'; }
}

async function doReset() {
  const btn   = document.getElementById('resetBtn');
  const err   = document.getElementById('resetError');
  const suc   = document.getElementById('resetSuccess');
  const token = document.getElementById('authReset').dataset.token;
  const password  = document.getElementById('resetPassword').value;
  const password2 = document.getElementById('resetPassword2').value;
  err.textContent = ''; suc.textContent = '';
  if (password !== password2) { err.textContent = 'Passwords do not match'; return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await fetch(`${API}/api/auth/reset-password`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({token, password})
    });
    const d = await r.json();
    if (!r.ok) { err.textContent = d.detail || 'Reset failed'; return; }
    suc.textContent = '✓ Password updated! Redirecting to sign in…';
    setTimeout(() => {
      window.history.replaceState({}, '', '/');
      _authPanel('authLogin');
    }, 2000);
  } catch(e) { err.textContent = 'Connection error'; }
  finally { btn.disabled = false; btn.textContent = 'Set new password'; }
}

async function doLogout() {
  const ub = document.getElementById('sidebarUserBlock');
  if (ub) ub.style.display = 'none';
  await fetch(`${API}/api/auth/logout`, {method:'POST', credentials:'include'});
  currentUser = null;
  trips = []; currentTrip = null;
  showAuthScreen();
  showLogin();
}

async function loadTrips() {
  try {
    const r = await fetch(`${API}/api/trips/`, {credentials:'include', headers:H});
    const data = await r.json();
    trips = Array.isArray(data) ? data : [];
  } catch(e) {
    console.error('[ERR01] loadTrips failed:', e);
    trips = [];
  }
  renderSidebar();
}




// ── API USAGE WIDGET ──────────────────────────────────────────────────────────
async function loadUsageWidget() { /* moved to admin panel */ }
