'use strict';
const supabase = require('./supabase');

async function signUp(email, password) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signIn(email, password) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signInWithMagicLink(email) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) throw error;
}

async function signInWithProvider(provider) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${process.env.SITE_URL || 'http://localhost:3000'}/auth/callback` }
  });
  if (error) throw error;
}

async function signOut() {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

async function getSession() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

module.exports = { signUp, signIn, signInWithMagicLink, signInWithProvider, signOut, getSession };
