import { NextResponse } from 'next/server';
import { requireUser, isAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { SUBACCOUNT_PUBLIC_COLUMNS, toPublic, fetchGhlLocation } from '@/lib/subaccounts';
import { isValidTimeZone } from '@/lib/tz';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { data, error } = await supabaseAdmin().from('subaccounts').select(SUBACCOUNT_PUBLIC_COLUMNS).order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: (data || []).map(toPublic), canManage: isAdmin(auth.user.email) });
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export async function POST(req: Request) {
  const auth = await requireUser({ admin: true });
  if (auth.error) return auth.error;
  const b = await req.json().catch(() => ({}));
  const location_id = str(b.location_id), ghl_token = str(b.ghl_token);
  if (!location_id || !ghl_token) return NextResponse.json({ error: 'Location ID and Private Integration token are required' }, { status: 400 });

  let loc;
  try { loc = await fetchGhlLocation(location_id, ghl_token); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  const timezone = str(b.timezone) || loc.timezone || 'UTC';
  if (!isValidTimeZone(timezone)) return NextResponse.json({ error: 'Unknown timezone "' + timezone + '". Use a name like America/New_York.' }, { status: 400 });

  const row = {
    name: str(b.name) || loc.name || location_id,
    location_id, ghl_token, timezone,
    currency: (str(b.currency) || 'USD').toUpperCase(),
    invoice_live_mode: b.invoice_live_mode !== false,
    invoice_sender_name: str(b.invoice_sender_name) || null,
    notify_webhook_url: str(b.notify_webhook_url) || null,
    created_by: auth.user.id
  };
  const { data, error } = await supabaseAdmin().from('subaccounts').insert(row).select(SUBACCOUNT_PUBLIC_COLUMNS).single();
  if (error) {
    const msg = error.code === '23505' ? 'This location is already added.' : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ item: toPublic(data) });
}
