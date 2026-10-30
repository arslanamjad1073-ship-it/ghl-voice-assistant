import { NextResponse } from 'next/server';
import { signedInUser } from '@/lib/access';
import { canCreateOrganization, displayName } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET -> for the welcome screen: open invites for my email, and whether I may start an organization
export async function GET() {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const db = supabaseAdmin();
  const { data: m } = await db.from('memberships').select('status').eq('user_id', user.id).maybeSingle();
  // Invites are only listed for a confirmed email address
  const { data: invites } = !user.email_confirmed_at ? { data: [] } : await db.from('invites').select('token,role,invited_by_name,expires_at,organizations(name)')
    .eq('email', (user.email || '').toLowerCase()).is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString());
  return NextResponse.json({
    email: user.email, name: displayName(user), member: m?.status || null,
    canCreate: canCreateOrganization(user.email),
    invites: (invites || []).map((i) => {
      const org = (Array.isArray(i.organizations) ? i.organizations[0] : i.organizations) as { name?: string } | null;
      return { token: i.token, role: i.role, invitedBy: i.invited_by_name, orgName: org?.name || '' };
    })
  });
}

// POST { name } -> start a new organization; the signed-in person becomes its owner
export async function POST(req: Request) {
  const user = await signedInUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (!canCreateOrganization(user.email)) return NextResponse.json({ error: 'Your email cannot start a new organization. Ask for an invite.' }, { status: 403 });
  const { name } = await req.json().catch(() => ({}));
  const n = String(name || '').trim().slice(0, 120);
  if (!n) return NextResponse.json({ error: 'Enter your business name' }, { status: 400 });
  const db = supabaseAdmin();
  const { data: existing } = await db.from('memberships').select('id').eq('user_id', user.id).maybeSingle();
  if (existing) return NextResponse.json({ error: 'You already belong to an organization.' }, { status: 400 });
  const { data: org, error } = await db.from('organizations').insert({ name: n, owner_id: user.id }).select('id').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { error: mErr } = await db.from('memberships').insert({
    org_id: org.id, user_id: user.id, email: user.email, name: displayName(user), role: 'owner', all_subaccounts: true
  });
  if (mErr) {
    await db.from('organizations').delete().eq('id', org.id);
    return NextResponse.json({ error: mErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
