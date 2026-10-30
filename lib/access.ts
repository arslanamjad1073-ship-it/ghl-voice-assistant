import 'server-only';
import { cache } from 'react';
import type { User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSubaccountFull, type SubaccountFull } from '@/lib/ghlActions';
import { PERMISSIONS, type Permission, type Role, type AccessInfo } from '@/lib/permissions';

// Who is signed in, which organization they belong to, what they may do and which sub-accounts they may see.
// Every API route goes through requireAccess / requireSubaccount: the browser only hides buttons,
// the server is what actually enforces it.

export interface Access extends AccessInfo {
  user: User;
  membershipId: string;
  subaccountIds: string[]; // sub-accounts of the organization this member may use
}

export const signedInUser = cache(async (): Promise<User | null> => {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

export const getAccess = cache(async (signed?: User | null): Promise<Access | null> => {
  const user = signed === undefined ? await signedInUser() : signed;
  if (!user) return null;
  const db = supabaseAdmin();
  const { data: m } = await db.from('memberships')
    .select('id,org_id,role,permissions,all_subaccounts,status,organizations(name)')
    .eq('user_id', user.id).maybeSingle();
  if (!m || m.status !== 'active') return null;
  const org = (Array.isArray(m.organizations) ? m.organizations[0] : m.organizations) as { name?: string } | null;
  const role = m.role as Role;
  const allSubaccounts = role === 'owner' || !!m.all_subaccounts;
  const permissions = role === 'owner' ? [...PERMISSIONS] : (m.permissions || []).filter((p: string): p is Permission => (PERMISSIONS as readonly string[]).includes(p));

  let subaccountIds: string[];
  if (allSubaccounts) {
    const { data } = await db.from('subaccounts').select('id').eq('org_id', m.org_id);
    subaccountIds = (data || []).map((r) => r.id);
  } else {
    const { data } = await db.from('member_subaccounts').select('subaccount_id,subaccounts!inner(org_id)')
      .eq('membership_id', m.id).eq('subaccounts.org_id', m.org_id);
    subaccountIds = (data || []).map((r) => r.subaccount_id);
  }
  return { user, membershipId: m.id, orgId: m.org_id, orgName: org?.name || '', role, permissions, allSubaccounts, subaccountIds };
});

export const can = (a: Pick<AccessInfo, 'role' | 'permissions'>, p: Permission) => a.role === 'owner' || a.permissions.includes(p);

const deny = (error: string, status: number, code?: string) => ({ error: NextResponse.json({ error, ...(code ? { code } : {}) }, { status }) });

// For API routes: the member's access, or a ready-made error response
export async function requireAccess(opts: { perm?: Permission; ownerOnly?: boolean } = {}): Promise<{ access: Access; error?: never } | { access?: never; error: NextResponse }> {
  const user = await signedInUser();
  if (!user) return deny('Not signed in', 401);
  const access = await getAccess(user);
  if (!access) return deny('You are not a member of an organization yet', 403, 'no_org');
  if (opts.ownerOnly && access.role !== 'owner') return deny('Only the owner can do this', 403);
  if (opts.perm && !can(access, opts.perm)) return deny('You do not have permission for this. Ask the owner.', 403);
  return { access };
}

// A sub-account this member may use (same organization and in their access list), with its GHL token
export async function requireSubaccount(id: unknown, opts: { perm?: Permission } = {}): Promise<
  { access: Access; sa: SubaccountFull; error?: never } | { access?: never; sa?: never; error: NextResponse }> {
  const r = await requireAccess(opts);
  if (r.error) return r;
  const sid = typeof id === 'string' ? id : '';
  if (!sid) return deny('Choose a sub-account first', 400);
  if (!r.access.subaccountIds.includes(sid)) return deny('You do not have access to this sub-account', 403);
  const sa = await getSubaccountFull(sid);
  if (!sa || sa.org_id !== r.access.orgId) return deny('Sub-account not found', 404);
  return { access: r.access, sa };
}

// Narrows a query on a table with org_id + subaccount_id to what this member may see.
// Org-wide members filter by organization only (keeps the URL short with many sub-accounts).
export function scopeIds(a: Access, sub?: string | null): string[] | 'all' | null {
  if (sub) return a.subaccountIds.includes(sub) ? [sub] : null;
  if (a.allSubaccounts) return 'all';
  return a.subaccountIds.length ? a.subaccountIds : null;
}

// Fields copied onto every history / follow-up row
export function actor(a: Access, name: string) {
  return { org_id: a.orgId, user_id: a.user.id, user_email: a.user.email, user_name: name };
}

// Org members (active) who may see a sub-account: used for push notifications
export async function membersWithAccess(orgId: string, subaccountId: string) {
  const db = supabaseAdmin();
  const [{ data: all }, { data: some }] = await Promise.all([
    db.from('memberships').select('user_id,role,all_subaccounts').eq('org_id', orgId).eq('status', 'active'),
    db.from('member_subaccounts').select('memberships!inner(user_id,org_id,status)').eq('subaccount_id', subaccountId)
  ]);
  const ids = new Set<string>();
  for (const m of all || []) if (m.role === 'owner' || m.all_subaccounts) ids.add(m.user_id);
  for (const r of some || []) {
    const m = (Array.isArray(r.memberships) ? r.memberships[0] : r.memberships) as { user_id: string; org_id: string; status: string } | null;
    if (m && m.org_id === orgId && m.status === 'active') ids.add(m.user_id);
  }
  return Array.from(ids);
}
