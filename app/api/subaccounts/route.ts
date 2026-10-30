import { NextResponse } from 'next/server';
import { requireAccess, can } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { SUBACCOUNT_PUBLIC_COLUMNS, toPublic, fetchGhlLocation } from '@/lib/subaccounts';
import { isValidTimeZone } from '@/lib/tz';

export const dynamic = 'force-dynamic';

// GET -> the sub-accounts this member can access (in their organization)
export async function GET() {
  const auth = await requireAccess();
  if (auth.error) return auth.error;
  const { access } = auth;
  const canManage = can(access, 'manage_subaccounts');
  if (!access.subaccountIds.length) return NextResponse.json({ items: [], canManage, canBrand: can(access, 'manage_branding') });
  const { data, error } = await supabaseAdmin().from('subaccounts').select(SUBACCOUNT_PUBLIC_COLUMNS)
    .eq('org_id', access.orgId).in('id', access.subaccountIds).order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // The alert webhook key is setup information: only for members who manage sub-accounts
  const items = (data || []).map((r) => toPublic(r)).map((s) => (canManage ? s : { ...s, webhook_key: '', notify_webhook_url: null }));
  return NextResponse.json({ items, canManage, canBrand: can(access, 'manage_branding') });
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export async function POST(req: Request) {
  const auth = await requireAccess({ perm: 'manage_subaccounts' });
  if (auth.error) return auth.error;
  const { access } = auth;
  const b = await req.json().catch(() => ({}));
  const location_id = str(b.location_id), ghl_token = str(b.ghl_token);
  if (!location_id || !ghl_token) return NextResponse.json({ error: 'Location ID and Private Integration token are required' }, { status: 400 });

  let loc;
  try { loc = await fetchGhlLocation(location_id, ghl_token); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

  // Timezone and currency come from GHL; anything unusable falls back to safe defaults
  const timezone = isValidTimeZone(loc.timezone) ? loc.timezone : 'UTC';

  const db = supabaseAdmin();
  const row = {
    org_id: access.orgId,
    name: str(b.name) || loc.name || location_id,
    location_id, ghl_token, timezone,
    currency: /^[A-Z]{3}$/.test(loc.currency) ? loc.currency : 'USD',
    notify_webhook_url: str(b.notify_webhook_url) || null,
    voice_enabled: b.voice_enabled === true,
    created_by: access.user.id
  };
  const { data, error } = await db.from('subaccounts').insert(row).select(SUBACCOUNT_PUBLIC_COLUMNS).single();
  if (error) {
    const msg = error.code === '23505' ? 'This GHL location is already connected to Nova (in this or another organization).' : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  // A member limited to some sub-accounts gets access to the one they just added
  if (!access.allSubaccounts) await db.from('member_subaccounts').insert({ membership_id: access.membershipId, subaccount_id: data.id });
  return NextResponse.json({ item: toPublic(data) });
}
