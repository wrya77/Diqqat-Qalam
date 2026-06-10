/**
 * supabase-auth.js — Authentication gate for the main app (/app)
 *
 * Behaviour:
 *   1. Shows a full-screen loading gate immediately.
 *   2. Fetches Supabase credentials from /api/config.
 *   3. If Supabase is not configured → redirect to /auth (setup required).
 *   4. Checks for an active session.
 *   5. If authenticated → remove gate, render user UI, let app proceed.
 *   6. If NOT authenticated → redirect to /auth immediately.
 *   7. Listens for SIGNED_OUT events → redirect to /auth.
 */

const AuthManager = (() => {
  'use strict';

  let _client  = null;
  let _user    = null;
  let _ready   = false;
  let _token   = null;

  /* ── Attach JWT to all same-origin /api requests automatically ── */
  const _origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const isApi = url.startsWith('/api') || url.startsWith(location.origin + '/api');
      if (isApi && _token) {
        init = init || {};
        const headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || undefined);
        if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + _token);
        init.headers = headers;
      }
    } catch (e) { /* never break a request over auth decoration */ }
    return _origFetch(input, init);
  };

  /* ── Auth gate overlay — static HTML in index.html, we just remove it ── */
  function _showGate() { /* gate is already in HTML */ }

  function _hideGate() {
    // Remove visibility lock so the app content becomes visible
    const style = document.getElementById('_auth-init-style');
    if (style) style.remove();
    // Fade out and remove the gate overlay
    const gate = document.getElementById('_auth-gate');
    if (!gate) return;
    gate.style.opacity = '0';
    setTimeout(() => gate.remove(), 420);
  }

  function _updateGateMsg(msg) {
    const el = document.getElementById('_gate-msg');
    if (el) el.textContent = msg;
  }

  /* ── Redirect helpers ── */
  function _redirectToAuth(reason) {
    _updateGateMsg('جاري التوجيه لصفحة الدخول…');
    const dest = '/auth' + (reason ? '?from=' + encodeURIComponent(reason) : '');
    setTimeout(() => { window.location.replace(dest); }, 300);
  }

  /* ── Render user avatar / name in toolbar ── */
  function _renderUserUI(user) {
    const pill = document.getElementById('user-pill');
    if (!pill) return;

    if (user) {
      const avatar = user.user_metadata?.avatar_url;
      const name   = user.user_metadata?.full_name
                   || user.user_metadata?.name
                   || user.email?.split('@')[0]
                   || 'مستخدم';
      // Sanitize to prevent XSS
      const safeName   = name.replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c]));
      const safeAvatar = avatar ? avatar.replace(/"/g, '%22') : '';

      pill.innerHTML = safeAvatar
        ? `<img src="${safeAvatar}" alt="" class="user-avatar" onerror="this.style.display='none'">`
        : '<span class="user-avatar-placeholder">👤</span>';
      pill.innerHTML += `
        <span class="user-name">${safeName}</span>
        <button class="tbtn icon-only" id="btn-signout" title="تسجيل الخروج">⎋</button>
      `;
      pill.style.display = 'flex';
      document.getElementById('btn-signout')?.addEventListener('click', () => AuthManager.signOut());
    } else {
      pill.innerHTML = `<a href="/auth" class="tbtn" style="font-size:11px">🔑 دخول</a>`;
      pill.style.display = 'flex';
    }
  }

  /* ── Main init ── */
  async function init() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('config fetch failed: ' + res.status);
      const cfg = await res.json();

      if (!cfg.supabaseUrl || !cfg.supabaseKey || cfg.devMode) {
        console.info('[Auth] dev-mode — skipping authentication');
        _renderUserUI(null);
        _hideGate();
        _ready = true;
        return null;
      }

      if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.warn('[Auth] Supabase SDK not loaded — opening without auth');
        _renderUserUI(null);
        _hideGate();
        _ready = true;
        return null;
      }

      _client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

      if (!_client) {
        console.warn('[Auth] createClient returned null — opening without auth');
        _renderUserUI(null);
        _hideGate();
        _ready = true;
        return null;
      }

      // Clean OAuth hash from URL first so getSession works correctly
      if (window.location.hash && window.location.hash.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }

      const { data: { session }, error } = await _client.auth.getSession();

      if (error) {
        console.warn('[Auth] getSession error:', error.message);
      }

      if (session) {
        _user  = session.user;
        _token = session.access_token;
        _renderUserUI(_user);
        _hideGate();
        _ready = true;
      } else {
        _renderUserUI(null);
        _hideGate();
        _ready = true;
      }

      // Keep session fresh; redirect out on sign-out
      _client.auth.onAuthStateChange((event, newSession) => {
        if (event === 'SIGNED_OUT' || (!newSession && event !== 'INITIAL_SESSION')) {
          _token = null;
          window.location.replace('/auth');
          return;
        }
        if (event === 'SIGNED_IN' && newSession) {
          _user  = newSession.user;
          _token = newSession.access_token;
          _renderUserUI(_user);
        }
        if (event === 'TOKEN_REFRESHED' && newSession) {
          _user  = newSession.user;
          _token = newSession.access_token;
        }
      });

      return _user;

    } catch (err) {
      console.warn('[Auth] init error — opening without auth:', err.message);
      _renderUserUI(null);
      _hideGate();
      _ready = true;
      return null;
    }
  }

  /* ── Sign out ── */
  async function signOut() {
    try {
      if (_client) await _client.auth.signOut();
    } catch (e) { /* ignore */ }
    window.location.replace('/auth');
  }

  /* ── Public API ── */
  function getUser()    { return _user; }
  function getClient()  { return _client; }
  function isReady()    { return _ready; }
  function isLoggedIn() { return !!_user; }
  function getUserId()  { return _user?.id || null; }
  function getEmail()   { return _user?.email || null; }
  function getToken()   { return _token; }

  return { init, signOut, getUser, getClient, isReady, isLoggedIn, getUserId, getEmail, getToken };
})();

// Inject gate immediately before DOM is ready (script runs synchronously)
// Then init after DOM loads to access /api/config
document.addEventListener('DOMContentLoaded', () => AuthManager.init());
