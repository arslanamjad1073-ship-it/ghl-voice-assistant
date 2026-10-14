import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireUser, displayName } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Creates a call session for the chosen sub-account and returns what the browser
// needs to log in to Voximplant (usernames only; the password stays on the server).
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { subaccountId } = await req.json().catch(() => ({}));
  if (!subaccountId) return NextResponse.json({ error: 'Choose a sub-account first' }, { status: 400 });

  const db = supabaseAdmin();
  const { data: sa } = await db.from('subaccounts').select('id,name,voice_enabled').eq('id', subaccountId).maybeSingle();
  if (!sa) return NextResponse.json({ error: 'Sub-account not found' }, { status: 404 });
  if (!sa.voice_enabled) return NextResponse.json({ error: 'Voice is turned off for this sub-account. An admin can turn it on under Accounts › Edit.' }, { status: 403 });

  const user = process.env.VOX_USER, app = process.env.VOX_APP;
  if (!user || !app || !process.env.VOX_PASSWORD) {
    return NextResponse.json({ error: 'Voximplant is not configured (VOX_USER, VOX_APP, VOX_PASSWORD)' }, { status: 500 });
  }

  const token = randomBytes(24).toString('hex');
  const { error } = await db.from('call_sessions').insert({
    token,
    user_id: auth.user.id,
    user_email: auth.user.email,
    user_name: displayName(auth.user),
    subaccount_id: sa.id,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });
  if (error) return NextResponse.json({ error: 'Could not start the session: ' + error.message }, { status: 500 });

  const node = process.env.VOX_NODE || 'NODE_2';
  const n = node.replace('NODE_', 'n');
  return NextResponse.json({
    sessionToken: token,
    subaccountName: sa.name,
    node,
    callNumber: process.env.VOX_CALL_NUMBER || 'crm',
    usernames: [`${user}@${app}.voximplant.com`, `${user}@${app}.${n}.voximplant.com`]
  });
}
