import 'server-only';
import type { SubaccountPublic } from '@/lib/types';

export const SUBACCOUNT_PUBLIC_COLUMNS =
  'id,name,location_id,timezone,currency,invoice_live_mode,invoice_sender_name,notify_webhook_url,webhook_key,voice_enabled,ghl_token,created_at,updated_at';

// Strips the token, keeping only its last 4 characters as a hint
export function toPublic(row: Record<string, unknown>): SubaccountPublic {
  const token = String(row.ghl_token || '');
  const { ghl_token: _omit, ...rest } = row;
  return { ...(rest as Omit<SubaccountPublic, 'token_hint'>), token_hint: token ? '••••' + token.slice(-4) : '' };
}

// Checks the token can read the location and returns its name and timezone
export async function fetchGhlLocation(locationId: string, token: string) {
  const res = await fetch('https://services.leadconnectorhq.com/locations/' + encodeURIComponent(locationId), {
    headers: { Authorization: 'Bearer ' + token, Version: '2021-07-28', Accept: 'application/json' },
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : data?.message || res.statusText;
    throw new Error('GHL rejected the token or location (' + res.status + '): ' + msg);
  }
  const loc = data.location || data;
  return { name: String(loc.name || ''), timezone: String(loc.timezone || ''), currency: String(loc.currency || loc.business?.currency || '').toUpperCase() };
}
