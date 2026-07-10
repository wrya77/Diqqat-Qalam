/**
 * supabase-auth.js — Authentication gate for the main app (/app)
 *
 * Behaviour:
 *   1. Shows a full-screen loading gate immediately.
 *   2. Fetches Supabase credentials from /api/config.
 *   3. Checks for an active session.
 *   4. If authenticated → remove gate, render user UI, let app proceed.
 *   5. If NOT authenticated → open the app in GUEST mode (full editor,
 *      local-only autosave). Cloud-only actions (save/open cloud projects,
 *      upgrade) prompt for login via requireLogin().
 *   6. Listens for SIGNED_OUT → redirect to /auth; SIGNED_IN → upgrade UI.
 */

const AuthManager = (() => {
  'use strict';

  let _client  = null;
  let _user    = null;
  let _ready   = false;
  let _token   = null;
  let _guest   = false;

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
      pill.innerHTML = `
        <span title="أنت تجرّب كضيف — عملك محفوظ على هذا الجهاز فقط" style="font-size:11px;color:var(--text3,#6b7280);white-space:nowrap">🎨 وضع التجربة</span>
        <a href="/auth" class="tbtn primary" style="font-size:11px;white-space:nowrap">🔑 دخول</a>`;
      pill.style.display = 'flex';
    }
  }

  /* ── Login prompt shown when a guest hits a cloud-only action ── */
  function _loginPrompt(action) {
    if (document.getElementById('_login-prompt')) return;
    const safe = String(action || 'استخدام هذه الميزة').replace(/[<>&"']/g, '');
    const wrap = document.createElement('div');
    wrap.id = '_login-prompt';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(4,6,12,.62);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px;direction:rtl';
    wrap.innerHTML = `
      <div style="background:var(--panel,#0d1117);border:1px solid var(--border,#22262e);border-radius:16px;max-width:380px;width:100%;padding:26px 24px;box-shadow:0 20px 60px rgba(0,0,0,.5);text-align:center;font-family:inherit">
        <div style="font-size:40px;margin-bottom:6px">🔑</div>
        <h3 style="margin:0 0 8px;font-size:18px;color:var(--text,#e6edf3)">سجّل الدخول للمتابعة</h3>
        <p style="margin:0 0 4px;font-size:13px;color:var(--text2,#9aa4b2);line-height:1.6">تحتاج حساباً مجانياً لـ<b style="color:var(--accent,#3b82f6)">${safe}</b>.</p>
        <p style="margin:0 0 18px;font-size:12px;color:var(--text3,#6b7280)">✔ عملك الحالي محفوظ على هذا الجهاز ولن يضيع.</p>
        <div style="display:flex;gap:10px">
          <button id="_lp-cancel" style="flex:1;padding:11px;border-radius:10px;border:1px solid var(--border,#22262e);background:transparent;color:var(--text2,#9aa4b2);cursor:pointer;font:inherit">لاحقاً</button>
          <a href="/auth" style="flex:2;padding:11px;border-radius:10px;border:0;background:var(--accent,#3b82f6);color:#fff;cursor:pointer;font:inherit;font-weight:700;text-decoration:none;display:flex;align-items:center;justify-content:center">تسجيل الدخول</a>
        </div>
      </div>`;
    wrap.addEventListener('click', e => { if (e.target === wrap) wrap.remove(); });
    document.body.appendChild(wrap);
    wrap.querySelector('#_lp-cancel').addEventListener('click', () => wrap.remove());
  }

  /* Returns true if the caller may proceed; false (and prompts) for a guest. */
  function requireLogin(action) {
    if (!_guest) return true;
    _loginPrompt(action);
    return false;
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
        console.warn('[Auth] Supabase SDK not loaded — redirecting to /auth');
        _redirectToAuth('sdk');
        return null;
      }

      _client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

      if (!_client) {
        console.warn('[Auth] createClient returned null — redirecting to /auth');
        _redirectToAuth('client');
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
        _guest = false;
        _renderUserUI(_user);
      } else {
        // لا جلسة → افتح التطبيق كـ"ضيف": المحرر يعمل كاملاً، الحفظ محلي فقط.
        // الميزات السحابية (حفظ/فتح المشاريع، الترقية) تطلب الدخول عبر requireLogin().
        _guest = true;
        _renderUserUI(null);
      }
      _hideGate();
      _ready = true;

      // Keep session fresh; redirect out only on explicit sign-out
      _client.auth.onAuthStateChange((event, newSession) => {
        if (event === 'SIGNED_OUT') {
          _token = null; _user = null;
          window.location.replace('/auth');
          return;
        }
        if (event === 'SIGNED_IN' && newSession) {
          _user  = newSession.user;
          _token = newSession.access_token;
          _guest = false;
          _renderUserUI(_user);
        }
        if (event === 'TOKEN_REFRESHED' && newSession) {
          _user  = newSession.user;
          _token = newSession.access_token;
        }
      });

      return _user;

    } catch (err) {
      console.warn('[Auth] init error — redirecting to /auth:', err.message);
      _redirectToAuth('error');
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
  function isGuest()    { return _guest; }
  function getUserId()  { return _user?.id || null; }
  function getEmail()   { return _user?.email || null; }
  function getToken()   { return _token; }

  return { init, signOut, getUser, getClient, isReady, isLoggedIn, isGuest, requireLogin, getUserId, getEmail, getToken };
})();

// Inject gate immediately before DOM is ready (script runs synchronously)
// Then init after DOM loads to access /api/config
document.addEventListener('DOMContentLoaded', () => AuthManager.init());
