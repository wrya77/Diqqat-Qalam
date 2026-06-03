/**
 * supabase-auth.js — إدارة المصادقة عبر Supabase
 * يُحمَّل في التطبيق الرئيسي للتحقق من الجلسة وعرض بيانات المستخدم
 */

const AuthManager = (() => {
  let _client  = null;
  let _user    = null;
  let _ready   = false;

  async function init() {
    try {
      const res = await fetch('/api/config');
      const cfg = await res.json();

      if (!cfg.supabaseUrl || !cfg.supabaseKey) {
        console.info('Supabase not configured — running in local mode');
        _ready = true;
        _renderUserUI(null);
        return null;
      }

      _client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

      // Handle OAuth callback (token in URL hash)
      const { data: { session }, error } = await _client.auth.getSession();

      if (error) { console.warn('Auth session error:', error.message); }

      if (session) {
        _user = session.user;
        _renderUserUI(_user);
        // Clean hash from URL
        if (window.location.hash) history.replaceState(null, '', window.location.pathname);
      } else {
        // No session → redirect to auth
        window.location.href = '/auth';
        return null;
      }

      // Listen for auth state changes
      _client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') window.location.href = '/';
        if (event === 'SIGNED_IN' && session) { _user = session.user; _renderUserUI(_user); }
      });

      _ready = true;
      return _user;
    } catch (e) {
      console.warn('Auth init failed, running in local mode:', e.message);
      _ready = true;
      _renderUserUI(null);
      return null;
    }
  }

  function _renderUserUI(user) {
    const pill = document.getElementById('user-pill');
    if (!pill) return;
    if (user) {
      const avatar = user.user_metadata?.avatar_url;
      const name   = user.user_metadata?.full_name || user.email?.split('@')[0] || 'مستخدم';
      pill.innerHTML = `
        ${avatar ? `<img src="${avatar}" alt="" class="user-avatar">` : '<span class="user-avatar-placeholder">👤</span>'}
        <span class="user-name">${name}</span>
        <button class="tbtn icon-only" onclick="AuthManager.signOut()" title="تسجيل الخروج" style="margin-right:4px">⎋</button>
      `;
      pill.style.display = 'flex';
    } else {
      pill.innerHTML = `<a href="/auth" class="tbtn" style="font-size:11px">🔑 دخول</a>`;
      pill.style.display = 'flex';
    }
  }

  async function signOut() {
    if (_client) await _client.auth.signOut();
    window.location.href = '/';
  }

  function getUser()    { return _user; }
  function getClient()  { return _client; }
  function isReady()    { return _ready; }
  function isLoggedIn() { return !!_user; }

  return { init, signOut, getUser, getClient, isReady, isLoggedIn };
})();

// Auto-init when DOM ready
document.addEventListener('DOMContentLoaded', () => AuthManager.init());
