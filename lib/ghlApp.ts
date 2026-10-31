import 'server-only';
import { createHmac, timingSafeEqual, verify as verifySig } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Nova's GHL Marketplace app. Installing it on a location turns on message alerts: GHL then sends
// InboundMessage events to /api/webhooks/ghl-app. Env: GHL_APP_CLIENT_ID, GHL_APP_CLIENT_SECRET,
// GHL_APP_INSTALL_URL (the install link from the developer portal), optional GHL_APP_WEBHOOK_PUBLIC_KEY.

const API = 'https://services.leadconnectorhq.com';

export function appConfigured() {
  return !!(process.env.GHL_APP_CLIENT_ID && process.env.GHL_APP_CLIENT_SECRET && process.env.GHL_APP_INSTALL_URL);
}

export function callbackUrl(origin: string) {
  return origin + '/api/ghl/app/callback';
}

// ---------- state: which Nova sub-account and user started the install (signed, 15 min) ----------
const sign = (s: string) => createHmac('sha256', process.env.GHL_APP_CLIENT_SECRET || '').update(s).digest('base64url');

export function makeState(subaccountId: string, userId: string) {
  const body = Buffer.from(JSON.stringify({ s: subaccountId, u: userId, e: Date.now() + 15 * 60000 })).toString('base64url');
  return body + '.' + sign(body);
}

export function readState(state: string | null): { s: string; u: string } | null {
  if (!state || !state.includes('.')) return null;
  const [body, mac] = state.split('.');
  const want = Buffer.from(sign(body)), got = Buffer.from(mac || '');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString());
    return d.e > Date.now() ? { s: String(d.s), u: String(d.u) } : null;
  } catch { return null; }
}

export function installUrl(state: string) {
  const u = new URL(process.env.GHL_APP_INSTALL_URL!);
  u.searchParams.set('state', state);
  return u.toString();
}

// ---------- OAuth tokens ----------
export interface TokenSet {
  access_token: string; refresh_token: string; expires_in: number; userType?: string;
  locationId?: string; companyId?: string; scope?: string; userId?: string;
}

async function tokenRequest(form: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(API + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: process.env.GHL_APP_CLIENT_ID!, client_secret: process.env.GHL_APP_CLIENT_SECRET!, ...form }),
    cache: 'no-store'
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) {
    const err = new Error('GHL ' + res.status + ': ' + (d.error_description || d.message || d.error || res.statusText));
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return d as TokenSet;
}

export const exchangeCode = (code: string, redirectUri: string) =>
  tokenRequest({ grant_type: 'authorization_code', code, user_type: 'Location', redirect_uri: redirectUri });

// An agency-level (Company) install gives a company token; turn it into a token for one location
export async function locationTokenFromCompany(companyToken: string, companyId: string, locationId: string): Promise<TokenSet> {
  const res = await fetch(API + '/oauth/locationToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Authorization: 'Bearer ' + companyToken, Version: '2021-07-28' },
    body: new URLSearchParams({ companyId, locationId }),
    cache: 'no-store'
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) throw new Error('GHL ' + res.status + ': ' + (d.message || d.error || 'could not get a location token'));
  return { ...d, locationId } as TokenSet;
}

const expiresAt = (t: TokenSet) => new Date(Date.now() + Math.max(60, (Number(t.expires_in) || 86399) - 300) * 1000).toISOString();
export const tokenColumns = (t: TokenSet) => ({
  access_token: t.access_token, refresh_token: t.refresh_token, expires_at: expiresAt(t), scopes: t.scope || null,
  user_type: t.userType || 'Location', company_id: t.companyId || null
});

// Checks an install still works (refreshing the token when due). GHL refuses once the app is uninstalled.
// Checked at most once an hour per location.
export async function checkInstall(locationId: string): Promise<'active' | 'disconnected' | 'uninstalled' | 'unknown'> {
  const db = supabaseAdmin();
  const { data: row } = await db.from('ghl_app_installs').select('status,access_token,refresh_token,expires_at,checked_at').eq('location_id', locationId).maybeSingle();
  if (!row) return 'unknown';
  if (row.status !== 'active') return row.status as 'disconnected' | 'uninstalled';
  if (row.checked_at && Date.now() - new Date(row.checked_at).getTime() < 3600000) return 'active';
  const now = new Date().toISOString();
  let token = row.access_token as string;
  try {
    if (!row.expires_at || new Date(row.expires_at).getTime() < Date.now()) {
      const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.refresh_token, user_type: 'Location' });
      // Refresh tokens are single use: only save if nobody refreshed in the meantime
      await db.from('ghl_app_installs').update({ ...tokenColumns(t), checked_at: now }).eq('location_id', locationId).eq('refresh_token', row.refresh_token);
      token = t.access_token;
    }
    const res = await fetch(API + '/locations/' + encodeURIComponent(locationId), {
      headers: { Authorization: 'Bearer ' + token, Version: '2021-07-28', Accept: 'application/json' }, cache: 'no-store'
    });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('revoked'), { status: res.status });
    await db.from('ghl_app_installs').update({ checked_at: now }).eq('location_id', locationId);
    return 'active';
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 400 || status === 401 || status === 403) {
      await db.from('ghl_app_installs').update({ status: 'disconnected', checked_at: now }).eq('location_id', locationId);
      return 'disconnected';
    }
    return 'active'; // network trouble: try again next time
  }
}

// ---------- webhook signature (optional extra check) ----------
// GHL signs app webhooks; x-wh-signature is RSA-SHA256, x-ghl-signature is Ed25519. Returns null when no key is set.
export function signatureValid(raw: string, headers: Headers): boolean | null {
  const key = (process.env.GHL_APP_WEBHOOK_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim();
  if (!key) return null;
  try {
    const ed = headers.get('x-ghl-signature');
    if (ed) return verifySig(null, Buffer.from(raw), key, Buffer.from(ed, 'base64'));
    const rsa = headers.get('x-wh-signature');
    if (rsa) return verifySig('sha256', Buffer.from(raw), key, Buffer.from(rsa, 'base64'));
  } catch { return false; }
  return false;
}
