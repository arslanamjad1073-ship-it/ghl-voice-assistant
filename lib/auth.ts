import 'server-only';
import type { User } from '@supabase/supabase-js';

const list = (v?: string) => (v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// ALLOWED_EMAILS: who may create a NEW organization (full addresses or @domain entries).
// Empty = anyone who signs up can start their own organization. Invited team members never need it.
export function canCreateOrganization(email?: string | null) {
  const allowed = list(process.env.ALLOWED_EMAILS);
  if (!allowed.length) return true;
  const e = (email || '').toLowerCase();
  return allowed.some((a) => (a.startsWith('@') ? e.endsWith(a) : e === a));
}

export function displayName(user: User) {
  const meta = user.user_metadata || {};
  return (meta.full_name || meta.name || (user.email || '').split('@')[0] || 'there') as string;
}
