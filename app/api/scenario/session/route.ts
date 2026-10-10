import { NextResponse } from 'next/server';
import { isScenario } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { tzInfo } from '@/lib/tz';

export const dynamic = 'force-dynamic';

// Called by the Voximplant scenario when a call starts: returns the sub-account settings for the session token
export async function POST(req: Request) {
  if (!isScenario(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { token } = await req.json().catch(() => ({}));
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });

  const db = supabaseAdmin();
  const { data: s } = await db.from('call_sessions')
    .select('id,user_name,user_email,expires_at,subaccounts(name,location_id,ghl_token,timezone,currency,invoice_live_mode,invoice_sender_name,notify_webhook_url)')
    .eq('token', token).maybeSingle();
  if (!s) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  if (new Date(s.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'Session expired' }, { status: 410 });
  const sa = (Array.isArray(s.subaccounts) ? s.subaccounts[0] : s.subaccounts) as Record<string, unknown> | null;
  if (!sa) return NextResponse.json({ error: 'Sub-account was deleted' }, { status: 404 });

  const tz = tzInfo(String(sa.timezone || 'UTC'));
  return NextResponse.json({
    subaccount_name: sa.name,
    location_id: sa.location_id,
    ghl_token: sa.ghl_token,
    timezone: sa.timezone,
    tz_offset_hours: tz.offsetHours,
    tz_label: tz.label,
    currency: sa.currency,
    invoice_live_mode: sa.invoice_live_mode,
    invoice_sender_name: sa.invoice_sender_name || '',
    notify_webhook_url: sa.notify_webhook_url || '',
    user_name: s.user_name || '',
    user_email: s.user_email || ''
  });
}
