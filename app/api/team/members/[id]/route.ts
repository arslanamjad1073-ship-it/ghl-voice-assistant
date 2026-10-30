import { NextResponse } from 'next/server';
import { requireAccess } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseGrant, checkGrant, mayManageMember, setMemberSubaccounts } from '@/lib/team';

export const dynamic = 'force-dynamic';

async function target(orgId: string, id: string) {
  const { data } = await supabaseAdmin().from('memberships').select('id,user_id,role,status').eq('id', id).eq('org_id', orgId).maybeSingle();
  return data as { id: string; user_id: string; role: 'owner' | 'admin' | 'user'; status: string } | null;
}

// PATCH { role, permissions, allSubaccounts, subaccountIds } or { status: 'active' | 'disabled' }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAccess({ perm: 'manage_team' });
  if (auth.error) return auth.error;
  const { access } = auth;
  const { id } = await params;
  const t = await target(access.orgId, id);
  if (!t) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (!mayManageMember(access, t)) return NextResponse.json({ error: t.role === 'owner' ? 'The owner cannot be changed here.' : 'You cannot change this member.' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const db = supabaseAdmin();

  if (b.status === 'active' || b.status === 'disabled') {
    const { error } = await db.from('memberships').update({ status: b.status }).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const g = parseGrant(b);
  const problem = await checkGrant(access, g);
  if (problem) return NextResponse.json({ error: problem }, { status: 403 });
  // A limited actor keeps the permissions of the target they cannot see or give
  let permissions = g.permissions;
  if (access.role !== 'owner') {
    const { data: cur } = await db.from('memberships').select('permissions').eq('id', id).maybeSingle();
    const kept = ((cur?.permissions || []) as string[]).filter((p) => !access.permissions.includes(p as never));
    permissions = Array.from(new Set([...kept, ...g.permissions])) as typeof permissions;
  }
  const { error } = await db.from('memberships').update({ role: g.role, permissions, all_subaccounts: g.allSubaccounts }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await setMemberSubaccounts(access, id, g.allSubaccounts ? [] : g.subaccountIds);
  return NextResponse.json({ ok: true });
}

// DELETE -> remove the member from the organization (their login stays, they lose all access)
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAccess({ perm: 'manage_team' });
  if (auth.error) return auth.error;
  const { id } = await params;
  const t = await target(auth.access.orgId, id);
  if (!t) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (!mayManageMember(auth.access, t)) return NextResponse.json({ error: t.role === 'owner' ? 'The owner cannot be removed.' : 'You cannot remove this member.' }, { status: 403 });
  const db = supabaseAdmin();
  await db.from('push_subscriptions').delete().eq('user_id', t.user_id);
  await db.from('call_sessions').update({ expires_at: new Date().toISOString() }).eq('user_id', t.user_id).gt('expires_at', new Date().toISOString());
  const { error } = await db.from('memberships').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
