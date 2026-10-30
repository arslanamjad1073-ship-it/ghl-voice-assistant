import { NextResponse } from 'next/server';
import { requireAccess } from '@/lib/access';
import { displayName } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { parseGrant, checkGrant, newInviteToken, appOrigin, emailInvite } from '@/lib/team';

export const dynamic = 'force-dynamic';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST { email, name?, role, permissions, allSubaccounts, subaccountIds, sendEmail? } -> { link, emailSent }
export async function POST(req: Request) {
  const auth = await requireAccess({ perm: 'manage_team' });
  if (auth.error) return auth.error;
  const { access } = auth;
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  const grant = parseGrant(b);
  const problem = await checkGrant(access, grant);
  if (problem) return NextResponse.json({ error: problem }, { status: 403 });

  const db = supabaseAdmin();
  const { data: existing } = await db.from('memberships').select('org_id').eq('email', email).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: existing.org_id === access.orgId ? 'This person is already in your team.' : 'This email already belongs to another Nova organization.' }, { status: 400 });
  }
  // Replace an older open invite for the same email
  await db.from('invites').update({ revoked_at: new Date().toISOString() }).eq('org_id', access.orgId).eq('email', email).is('accepted_at', null).is('revoked_at', null);

  const token = newInviteToken();
  const name = String(b.name || '').trim().slice(0, 120);
  const { error } = await db.from('invites').insert({
    org_id: access.orgId, email, name: name || null, role: grant.role, permissions: grant.permissions,
    all_subaccounts: grant.allSubaccounts, subaccount_ids: grant.allSubaccounts ? [] : grant.subaccountIds, token,
    invited_by: access.user.id, invited_by_name: displayName(access.user), expires_at: new Date(Date.now() + 7 * 86400000).toISOString()
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const link = appOrigin(req) + '/invite/' + token;
  const mail = b.sendEmail === false ? { sent: false } : await emailInvite(email, name, link);
  return NextResponse.json({ ok: true, link, emailSent: mail.sent, emailNote: mail.note || '' });
}

// DELETE ?id= -> cancel an open invite
export async function DELETE(req: Request) {
  const auth = await requireAccess({ perm: 'manage_team' });
  if (auth.error) return auth.error;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const db = supabaseAdmin();
  const { data: inv } = await db.from('invites').select('role').eq('id', id).eq('org_id', auth.access.orgId).maybeSingle();
  if (!inv) return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
  if (inv.role === 'admin' && auth.access.role !== 'owner') return NextResponse.json({ error: 'Only the owner can cancel admin invites.' }, { status: 403 });
  await db.from('invites').update({ revoked_at: new Date().toISOString() }).eq('id', id);
  return NextResponse.json({ ok: true });
}
