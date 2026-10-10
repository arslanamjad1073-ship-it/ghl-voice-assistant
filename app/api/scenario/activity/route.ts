import { NextResponse } from 'next/server';
import { isScenario } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null);

// Called by the Voximplant scenario after each CRM action
export async function POST(req: Request) {
  if (!isScenario(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.token || !b.action || !b.message) return NextResponse.json({ error: 'token, action and message are required' }, { status: 400 });

  const db = supabaseAdmin();
  const { data: s } = await db.from('call_sessions')
    .select('id,user_id,user_email,user_name,subaccount_id,expires_at,subaccounts(name)')
    .eq('token', b.token).maybeSingle();
  if (!s) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  if (new Date(s.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'Session expired' }, { status: 410 });
  const sa = (Array.isArray(s.subaccounts) ? s.subaccounts[0] : s.subaccounts) as { name?: string } | null;

  let details = b.details && typeof b.details === 'object' ? b.details : null;
  if (details && JSON.stringify(details).length > 8000) details = { truncated: true };

  const { error } = await db.from('activities').insert({
    session_id: s.id,
    subaccount_id: s.subaccount_id,
    subaccount_name: sa?.name || null,
    user_id: s.user_id,
    user_email: s.user_email,
    user_name: s.user_name,
    action: String(b.action).slice(0, 60),
    status: b.status === 'error' ? 'error' : 'success',
    message: String(b.message).slice(0, 1000),
    contact_id: clip(b.contact_id, 100),
    contact_name: clip(b.contact_name, 200),
    details
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
