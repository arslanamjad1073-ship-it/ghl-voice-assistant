import 'server-only';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Access } from '@/lib/access';
import { PERMISSIONS, type Permission, type Role } from '@/lib/permissions';

// Rules for who may give which access:
// - The owner can invite and change admins and users, and give any permission or sub-account.
// - A member with the Team permission can only invite / change Users, and only give permissions and
//   sub-accounts they have themselves.
// - Nobody changes the owner here (ownership is transferred by the owner only).

export interface Grant { role: 'admin' | 'user'; permissions: Permission[]; allSubaccounts: boolean; subaccountIds: string[] }

const uniq = <T,>(a: T[]) => Array.from(new Set(a));

export function parseGrant(b: Record<string, unknown>): Grant {
  return {
    role: b.role === 'admin' ? 'admin' : 'user',
    permissions: uniq((Array.isArray(b.permissions) ? b.permissions : []).map(String))
      .filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p)),
    allSubaccounts: b.allSubaccounts === true,
    subaccountIds: uniq((Array.isArray(b.subaccountIds) ? b.subaccountIds : []).map(String)).filter(Boolean).slice(0, 500)
  };
}

// Returns an error message, or '' when the actor may give this access
export async function checkGrant(actor: Access, g: Grant): Promise<string> {
  if (actor.role !== 'owner') {
    if (g.role !== 'user') return 'Only the owner can add or change admins.';
    const extra = g.permissions.filter((p) => !actor.permissions.includes(p));
    if (extra.length) return 'You can only give permissions you have yourself.';
    if (g.allSubaccounts && !actor.allSubaccounts) return 'You can only give access to sub-accounts you can access yourself.';
    if (g.subaccountIds.some((id) => !actor.subaccountIds.includes(id))) return 'You can only give access to sub-accounts you can access yourself.';
  }
  if (g.subaccountIds.length) {
    const { data } = await supabaseAdmin().from('subaccounts').select('id').eq('org_id', actor.orgId).in('id', g.subaccountIds);
    if ((data || []).length !== g.subaccountIds.length) return 'One of the sub-accounts does not belong to your organization.';
  }
  return '';
}

export function mayManageMember(actor: Access, target: { role: Role; user_id: string }) {
  if (target.role === 'owner') return false;
  if (target.user_id === actor.user.id) return false;
  return actor.role === 'owner' || target.role === 'user';
}

// Sets a member's sub-account list. A limited actor only changes the sub-accounts they can see.
export async function setMemberSubaccounts(actor: Access, membershipId: string, ids: string[]) {
  const db = supabaseAdmin();
  const { data: cur } = await db.from('member_subaccounts').select('subaccount_id').eq('membership_id', membershipId);
  const current = (cur || []).map((r) => r.subaccount_id as string);
  const visible = actor.allSubaccounts ? null : new Set(actor.subaccountIds);
  const keep = visible ? current.filter((id) => !visible.has(id)) : [];
  const next = uniq([...keep, ...ids]);
  const remove = current.filter((id) => !next.includes(id));
  const add = next.filter((id) => !current.includes(id));
  if (remove.length) await db.from('member_subaccounts').delete().eq('membership_id', membershipId).in('subaccount_id', remove);
  if (add.length) await db.from('member_subaccounts').insert(add.map((subaccount_id) => ({ membership_id: membershipId, subaccount_id })));
}

export const newInviteToken = () => randomBytes(24).toString('base64url');

export function appOrigin(req: Request) {
  const env = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (env) return env;
  const h = req.headers;
  const host = h.get('x-forwarded-host') || h.get('host');
  return host ? `${h.get('x-forwarded-proto') || 'https'}://${host}` : new URL(req.url).origin;
}

// Emails the invite link. New people get Supabase's invite email (creates their login);
// people who already have a login get a sign-in link. Both land on /invite/<token>.
// Supabase's built-in mailer is rate limited, so the link is also shown to copy.
export async function emailInvite(email: string, name: string, link: string): Promise<{ sent: boolean; note?: string }> {
  const auth = supabaseAdmin().auth;
  const { error } = await auth.admin.inviteUserByEmail(email, { redirectTo: link, data: name ? { full_name: name } : undefined });
  if (!error) return { sent: true };
  if (/already|registered|exists/i.test(error.message)) {
    const r = await auth.signInWithOtp({ email, options: { emailRedirectTo: link, shouldCreateUser: false } });
    if (!r.error) return { sent: true };
    return { sent: false, note: r.error.message };
  }
  return { sent: false, note: error.message };
}
