import { NextResponse } from 'next/server';
import { requireAccess } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// POST { membershipId } -> the owner hands ownership to an active admin and becomes an admin with every permission
export async function POST(req: Request) {
  const auth = await requireAccess({ ownerOnly: true });
  if (auth.error) return auth.error;
  const { access } = auth;
  const { membershipId } = await req.json().catch(() => ({}));
  const db = supabaseAdmin();
  const { data: t } = await db.from('memberships').select('id,user_id,role,status').eq('id', String(membershipId || '')).eq('org_id', access.orgId).maybeSingle();
  if (!t || t.role !== 'admin' || t.status !== 'active') return NextResponse.json({ error: 'Choose an active admin to make owner.' }, { status: 400 });

  const all = ['manage_subaccounts', 'manage_ai', 'view_usage', 'manage_branding', 'manage_team'];
  const demote = await db.from('memberships').update({ role: 'admin', permissions: all, all_subaccounts: true }).eq('id', access.membershipId);
  if (demote.error) return NextResponse.json({ error: demote.error.message }, { status: 500 });
  const promote = await db.from('memberships').update({ role: 'owner', all_subaccounts: true }).eq('id', t.id);
  if (promote.error) {
    await db.from('memberships').update({ role: 'owner' }).eq('id', access.membershipId); // undo
    return NextResponse.json({ error: promote.error.message }, { status: 500 });
  }
  await db.from('organizations').update({ owner_id: t.user_id }).eq('id', access.orgId);
  return NextResponse.json({ ok: true });
}
