'use strict';
/**
 * CloudStore.js — Supabase Postgres storage for per-user data
 *
 * Talks to PostgREST directly with the *requesting user's JWT*, so Row Level
 * Security enforces per-user isolation — the server never needs a service key.
 *
 * Used when Supabase is configured AND the request carries a verified user.
 * File-based managers remain the fallback for dev mode.
 */

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_ANON_KEY;

const enabled = !!(supabaseUrl && supabaseKey);

async function rest(token, method, pathAndQuery, body) {
  const headers = {
    apikey:         supabaseKey,
    Authorization:  `Bearer ${token}`,
    'Content-Type': 'application/json',
    Prefer:         'return=representation',
  };
  const res = await fetch(`${supabaseUrl}/rest/v1/${pathAndQuery}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${pathAndQuery} → ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ── Projects ─────────────────────────────────────────────────────────────── */

const CloudProjects = {
  async list(token) {
    const rows = await rest(token, 'GET',
      'projects?select=id,name,saved_at,shapes&order=saved_at.desc&limit=50');
    return rows.map(r => ({
      id: r.id, name: r.name, savedAt: r.saved_at,
      shapeCount: Array.isArray(r.shapes) ? r.shapes.length : 0,
    }));
  },

  async load(token, id) {
    const rows = await rest(token, 'GET', `projects?id=eq.${encodeURIComponent(id)}&limit=1`);
    if (!rows.length) throw new Error('المشروع غير موجود: ' + id);
    const r = rows[0];
    return {
      id: r.id, name: r.name, savedAt: r.saved_at, version: r.version,
      shapes: r.shapes || [], config: r.config || {}, gcode: r.gcode || '',
      selectedTool: r.selected_tool || null, notes: r.notes || '',
    };
  },

  async save(token, userId, name, data) {
    const safe = String(name).replace(/[^a-zA-Z0-9_؀-ۿ\s-]/g, '_').trim() || 'project';
    const id   = Date.now() + '_' + safe.replace(/\s+/g, '_');
    const row = {
      id, user_id: userId, name: safe,
      shapes:        data.shapes       || [],
      config:        data.config       || {},
      gcode:         data.gcode        || '',
      selected_tool: data.selectedTool || null,
      notes:         data.notes        || '',
      saved_at:      new Date().toISOString(),
    };
    await rest(token, 'POST', 'projects', row);
    return { id, name: safe };
  },

  async delete(token, id) {
    await rest(token, 'DELETE', `projects?id=eq.${encodeURIComponent(id)}`);
  },
};

/* ── Tools ────────────────────────────────────────────────────────────────── */

const CloudTools = {
  async list(token) {
    const rows = await rest(token, 'GET', 'user_tools?select=id,name,payload&order=created_at.asc');
    return rows.map(r => ({ id: r.id, name: r.name, ...(r.payload || {}) }));
  },

  async add(token, userId, tool) {
    const id = 'tool_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const { name = 'أداة جديدة', ...payload } = tool || {};
    await rest(token, 'POST', 'user_tools', { id, user_id: userId, name, payload });
    return { id, name, ...payload };
  },

  async update(token, id, tool) {
    const { name, ...payload } = tool || {};
    const patch = { payload, updated_at: new Date().toISOString() };
    if (name) patch.name = name;
    const rows = await rest(token, 'PATCH', `user_tools?id=eq.${encodeURIComponent(id)}`, patch);
    if (!rows || !rows.length) throw new Error('الأداة غير موجودة: ' + id);
    const r = rows[0];
    return { id: r.id, name: r.name, ...(r.payload || {}) };
  },

  async delete(token, id) {
    await rest(token, 'DELETE', `user_tools?id=eq.${encodeURIComponent(id)}`);
  },
};

module.exports = { enabled, CloudProjects, CloudTools };
