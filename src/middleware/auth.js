'use strict';
/**
 * auth.js — Server-side Supabase JWT verification middleware
 *
 * Verifies tokens against the Supabase Auth REST endpoint directly
 * (GET /auth/v1/user) — no supabase-js client needed on the server.
 *
 * attachUser         : verifies the Bearer token (if present) and sets req.user.
 *                      Never rejects — public endpoints stay public.
 * requireAuth        : 401 unless req.user is a verified user.
 * requireAuthOrApiKey: passes with EITHER a valid X-API-Key OR a logged-in user.
 *
 * Dev mode (no SUPABASE_URL): req.user is a fixed local user so the app
 * remains fully usable without authentication.
 */

const crypto = require('crypto');

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const authEnabled = !!(supabaseUrl && supabaseKey);

// Verified-token cache: avoids one Supabase round-trip per request
const TOKEN_CACHE_TTL = 60 * 1000;
const tokenCache = new Map(); // token -> { user, expires }

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tokenCache) if (v.expires < now) tokenCache.delete(k);
}, 5 * 60 * 1000).unref();

async function verifyToken(token) {
  const hit = tokenCache.get(token);
  if (hit && hit.expires > Date.now()) return hit.user;

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;

  const data = await res.json();
  if (!data || !data.id) return null;

  const user = {
    id:    data.id,
    email: data.email || null,
    name:  data.user_metadata?.full_name || data.user_metadata?.name || null,
  };
  tokenCache.set(token, { user, expires: Date.now() + TOKEN_CACHE_TTL });
  return user;
}

async function attachUser(req, res, next) {
  if (!authEnabled) {
    req.user = { id: 'dev-user', email: 'dev@localhost', dev: true };
    return next();
  }
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const token = header.slice(7);
    try {
      req.user = await verifyToken(token);
      if (req.user) req.accessToken = token; // for RLS-scoped DB calls
    } catch (e) {
      req.user = null;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'يجب تسجيل الدخول للوصول لهذه الخدمة.' });
}

function isValidApiKey(req) {
  const serverKey = process.env.API_SECRET_KEY;
  if (!serverKey) return false;
  const provided = req.headers['x-api-key'] || '';
  const a = Buffer.from(String(provided));
  const b = Buffer.from(serverKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAuthOrApiKey(req, res, next) {
  if (isValidApiKey(req)) return next();
  if (req.user) return next();
  res.status(401).json({ error: 'غير مصرح. سجّل الدخول أو قدّم مفتاح API صالح.' });
}

module.exports = { attachUser, requireAuth, requireAuthOrApiKey, isValidApiKey, authEnabled };
