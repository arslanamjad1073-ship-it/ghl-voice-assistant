import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { SUBACCOUNT_PUBLIC_COLUMNS, toPublic, fetchGhlLocation } from '@/lib/subaccounts';
import { isValidTimeZone } from '@/lib/tz';

export const dynamic = 'force-dynamic';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser({ admin: true });
  if (auth.error) return auth.error;
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: cur } = await db.from('subaccounts').select('location_id,ghl_token').eq('id', id).maybeSingle();
  if (!cur) return NextResponse.json({ error: 'Sub-account not found' }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (str(b.name)) patch.name = str(b.name);
  if (str(b.location_id)) patch.location_id = str(b.location_id);
  if (str(b.ghl_token)) patch.ghl_token = str(b.ghl_token); // blank = keep the current token
  if (str(b.timezone)) {
    if (!isValidTimeZone(str(b.timezone))) return NextResponse.json({ error: 'Unknown timezone "' + str(b.timezone) + '"' }, { status: 400 });
    patch.timezone = str(b.timezone);
  }
  if (str(b.currency)) patch.currency = str(b.currency).toUpperCase();
  if (typeof b.invoice_live_mode === 'boolean') patch.invoice_live_mode = b.invoice_live_mode;
  if ('invoice_sender_name' in b) patch.invoice_sender_name = str(b.invoice_sender_name) || null;
  if ('notify_webhook_url' in b) patch.notify_webhook_url = str(b.notify_webhook_url) || null;

  if (patch.location_id || patch.ghl_token) {
    try { await fetchGhlLocation(String(patch.location_id || cur.location_id), String(patch.ghl_token || cur.ghl_token)); }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  }

  const { data, error } = await db.from('subaccounts').update(patch).eq('id', id).select(SUBACCOUNT_PUBLIC_COLUMNS).single();
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'This location is already added.' : error.message }, { status: 400 });
  return NextResponse.json({ item: toPublic(data) });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser({ admin: true });
  if (auth.error) return auth.error;
  const { id } = await params;
  const { error } = await supabaseAdmin().from('subaccounts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
