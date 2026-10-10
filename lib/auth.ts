import 'server-only';
import type { User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

const list = (v?: string) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// ALLOWED_EMAILS accepts full addresses and @domain entries, e.g. "ali@x.com,@flowveo.com".
// Empty = any confirmed Supabase user may use the app.
export function isAllowed(email?: string | null) {
  const allowed = list(process.env.ALLOWED_EMAILS);
  if (!allowed.length) return true;
  const e = (email || '').toLowerCase();
  return allowed.some((a) => (a.startsWith('@') ? e.endsWith(a) : e === a));
}

// ADMIN_EMAILS can add, edit and delete sub-accounts. Empty = every allowed user can.
export function isAdmin(email?: string | null) {
  const admins = list(process.env.ADMIN_EMAILS);
  if (!admins.length) return isAllowed(email);
  const e = (email || '').toLowerCase();
  return admins.some((a) => (a.startsWith('@') ? e.endsWith(a) : e === a));
}

export function displayName(user: User) {
  const meta = user.user_metadata || {};
  return (meta.full_name || meta.name || (user.email || '').split('@')[0] || 'there') as string;
}

export async function currentUser() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  return user && isAllowed(user.email) ? user : null;
}

// For API routes: returns the user, or a ready-made error response
export async function requireUser(opts: { admin?: boolean } = {}): Promise<{ user: User; error?: never } | { user?: never; error: NextResponse }> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) };
  if (!isAllowed(user.email)) return { error: NextResponse.json({ error: 'This email is not allowed to use the app' }, { status: 403 }) };
  if (opts.admin && !isAdmin(user.email)) return { error: NextResponse.json({ error: 'Only admins can manage sub-accounts' }, { status: 403 }) };
  return { user };
}
