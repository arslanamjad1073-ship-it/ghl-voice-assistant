import { NextResponse } from 'next/server';
import { signedInUser } from '@/lib/access';
import { displayName } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// POST { token } -> the signed-in person joins the organization with the access the invite gives
export async function POST(req: Request) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  // The invite proves nothing unless the person really owns the invited email address
  if (!user.email_confirmed_at) return NextResponse.json({ error: 'Confirm your email address first (check your inbox), then open the invite again.' }, { status: 403 });
  const { token } = await req.json().catch(() => ({}));
  const db = supabaseAdmin();
  const { data: inv } = await db.from('invites').select('*').eq('token', String(token || '')).maybeSingle();
  if (!inv || inv.revoked_at) return NextResponse.json({ error: 'This invite is no longer valid. Ask for a new one.' }, { status: 404 });
  if (inv.accepted_at) return NextResponse.json({ error: 'This invite was already used.' }, { status: 400 });
  if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'This invite has expired. Ask for a new one.' }, { status: 400 });
  if ((user.email || '').toLowerCase() !== String(inv.email).toLowerCase()) {
    return NextResponse.json({ error: `This invite is for ${inv.email}. You are signed in as ${user.email}.` }, { status: 403 });
  }
  const { data: existing } = await db.from('memberships').select('org_id').eq('user_id', user.id).maybeSingle();
  if (existing) return NextResponse.json({ error: existing.org_id === inv.org_id ? 'You are already in this team.' : 'Your login already belongs to another Nova organization.' }, { status: 400 });

  // The person who invited must still be allowed to give this access today
  const { data: inviter } = await db.from('memberships').select('role,permissions,all_subaccounts,status')
    .eq('org_id', inv.org_id).eq('user_id', inv.invited_by).maybeSingle();
  const inviterOk = inviter && inviter.status === 'active' && (inviter.role === 'owner' || (
    (inviter.permissions || []).includes('manage_team') && inv.role === 'user' &&
    (inv.permissions || []).every((p: string) => (inviter.permissions || []).includes(p)) &&
    (!inv.all_subaccounts || inviter.all_subaccounts)));
  if (!inviterOk) return NextResponse.json({ error: 'This invite is no longer valid because the person who sent it lost that access. Ask for a new one.' }, { status: 403 });
  let allowedIds: string[] | null = null; // limited inviter: only sub-accounts they still have
  if (inviter.role !== 'owner' && !inviter.all_subaccounts) {
    const { data: mine } = await db.from('member_subaccounts').select('subaccount_id,memberships!inner(user_id,org_id)')
      .eq('memberships.user_id', inv.invited_by).eq('memberships.org_id', inv.org_id);
    allowedIds = (mine || []).map((r) => r.subaccount_id as string);
  }

  const { data: m, error } = await db.from('memberships').insert({
    org_id: inv.org_id, user_id: user.id, email: user.email, name: inv.name || displayName(user),
    role: inv.role, permissions: inv.permissions || [], all_subaccounts: !!inv.all_subaccounts, invited_by: inv.invited_by
  }).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids: string[] = (inv.all_subaccounts ? [] : inv.subaccount_ids || []).filter((id: string) => !allowedIds || allowedIds.includes(id));
  if (ids.length) {
    const { data: valid } = await db.from('subaccounts').select('id').eq('org_id', inv.org_id).in('id', ids);
    if (valid?.length) await db.from('member_subaccounts').insert(valid.map((s) => ({ membership_id: m.id, subaccount_id: s.id })));
  }
  await db.from('invites').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id);
  return NextResponse.json({ ok: true });
}
