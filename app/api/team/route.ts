import { NextResponse } from 'next/server';
import { requireAccess, can } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET -> organization, members (with their sub-account access), open invites, and the sub-accounts
// this member can hand out. Needs the Team permission (owner always has it).
export async function GET() {
  const auth = await requireAccess({ perm: 'manage_team' });
  if (auth.error) return auth.error;
  const { access } = auth;
  const db = supabaseAdmin();
  const [{ data: members }, { data: links }, { data: invites }, { data: subs }] = await Promise.all([
    db.from('memberships').select('id,user_id,email,name,role,permissions,all_subaccounts,status,created_at').eq('org_id', access.orgId).order('created_at'),
    db.from('member_subaccounts').select('membership_id,subaccount_id,memberships!inner(org_id)').eq('memberships.org_id', access.orgId),
    db.from('invites').select('id,email,name,role,permissions,all_subaccounts,subaccount_ids,token,invited_by_name,created_at,expires_at')
      .eq('org_id', access.orgId).is('accepted_at', null).is('revoked_at', null).order('created_at', { ascending: false }),
    access.subaccountIds.length
      ? db.from('subaccounts').select('id,name').eq('org_id', access.orgId).in('id', access.subaccountIds).order('name')
      : Promise.resolve({ data: [] as { id: string; name: string }[] })
  ]);
  const visible = new Set(access.subaccountIds);
  const byMember: Record<string, string[]> = {};
  for (const l of links || []) if (visible.has(l.subaccount_id)) (byMember[l.membership_id] ||= []).push(l.subaccount_id);
  return NextResponse.json({
    org: { id: access.orgId, name: access.orgName },
    me: { userId: access.user.id, role: access.role, permissions: access.permissions, allSubaccounts: access.allSubaccounts, canRename: access.role === 'owner' },
    members: (members || []).map((m) => ({
      ...m, all_subaccounts: m.role === 'owner' || m.all_subaccounts, permissions: m.role === 'owner' ? null : m.permissions,
      subaccount_ids: byMember[m.id] || []
    })),
    invites: (invites || []).map((i) => ({ ...i, subaccount_ids: (i.subaccount_ids || []).filter((id: string) => visible.has(id)), expired: new Date(i.expires_at) < new Date() })),
    subaccounts: subs || [],
    canInviteAdmins: access.role === 'owner',
    canTeam: can(access, 'manage_team')
  });
}

// PATCH { name } -> rename the organization (owner only)
export async function PATCH(req: Request) {
  const auth = await requireAccess({ ownerOnly: true });
  if (auth.error) return auth.error;
  const { name } = await req.json().catch(() => ({}));
  const n = String(name || '').trim().slice(0, 120);
  if (!n) return NextResponse.json({ error: 'Enter a name' }, { status: 400 });
  const { error } = await supabaseAdmin().from('organizations').update({ name: n }).eq('id', auth.access.orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, name: n });
}
