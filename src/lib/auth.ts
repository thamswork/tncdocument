import { supabaseAdmin } from './supabase';
import bcrypt from '@node-rs/bcrypt';

export interface TNCUser {
  id: string;
  username: string;
  full_name: string;
  role: 'superadmin' | 'admin';
}

export const SESSION_COOKIE = 'tnc_docs_session';
const SESSION_DURATION = 60 * 60 * 8;

export async function loginUser(username: string, password: string): Promise<TNCUser | null> {
  const { data: user, error } = await supabaseAdmin
    .from('tnc_users')
    .select('id, username, password_hash, full_name, role, is_active')
    .eq('username', username.toLowerCase().trim())
    .eq('is_active', true)
    .single();
  if (error || !user) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;
  return { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
}

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomUUID() + '-' + crypto.randomUUID();
  await supabaseAdmin.from('tnc_sessions').insert({
    token, user_id: userId,
    expires_at: new Date(Date.now() + SESSION_DURATION * 1000).toISOString(),
  });
  return token;
}

export async function getSessionUser(token: string | undefined): Promise<TNCUser | null> {
  if (!token) return null;
  const { data, error } = await supabaseAdmin
    .from('tnc_sessions')
    .select('user_id, expires_at, tnc_users (id, username, full_name, role, is_active)')
    .eq('token', token)
    .single();
  if (error || !data) return null;
  if (new Date(data.expires_at) < new Date()) return null;
  const user = Array.isArray(data.tnc_users) ? data.tnc_users[0] : data.tnc_users;
  if (!user || !user.is_active) return null;
  return { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
}

export async function destroySession(token: string): Promise<void> {
  await supabaseAdmin.from('tnc_sessions').delete().eq('token', token);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function getUsers() {
  const { data } = await supabaseAdmin
    .from('tnc_users')
    .select('id, username, full_name, role, is_active, created_at')
    .order('created_at');
  return data || [];
}

export function canPublish(user: TNCUser): boolean { return user.role === 'superadmin'; }
export function canEdit(user: TNCUser): boolean { return user.role === 'superadmin' || user.role === 'admin'; }
