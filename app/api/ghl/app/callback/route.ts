import { NextResponse } from 'next/server';
import { getAccess, signedInUser, can } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { appConfigured, exchangeCode, locationTokenFromCompany, readState, tokenColumns, type TokenSet } from '@/lib/ghlApp';

export const dynamic = 'force-dynamic';

// GHL sends the browser here after "Allow". The signed-in Nova member must be allowed to manage the
// sub-account whose Location ID matches the location the app was installed on.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const done = (q: string) => NextResponse.redirect(new URL('/subaccounts?' + q, url));
  const fail = (msg: string) => done('alerts_error=' + encodeURIComponent(msg));
  if (!appConfigured()) return fail('The Nova GHL app is not set up yet.');
  if (url.searchParams.get('error')) return fail('GHL: ' + (url.searchParams.get('error_description') || url.searchParams.get('error')));
  const code = url.searchParams.get('code');
  if (!code) return fail('GHL did not send an install code. Try again.');

  const user = await signedInUser();
  if (!user) return NextResponse.redirect(new URL('/login?error=' + encodeURIComponent('Sign in to Nova, then click Enable notifications again.'), url));
  const access = await getAccess(user);
  if (!access || !can(access, 'manage_subaccounts')) return fail('You need the Sub-accounts permission to enable notifications.');
  const state = readState(url.searchParams.get('state'));
  if (state && state.u !== user.id) return fail('This install was started by someone else. Click Enable notifications again.');

  const db = supabaseAdmin();
  const redirectUri = new URL(process.env.GHL_APP_INSTALL_URL!).searchParams.get('redirect_uri') || url.origin + url.pathname;
  let t: TokenSet;
  try { t = await exchangeCode(code, redirectUri); }
  catch (e) { return fail('Could not finish the install: ' + (e as Error).message); }

  // The Nova sub-account this is for: the one the button was clicked on, else the one matching the location
  let target: { id: string; name: string; location_id: string } | null = null;
  if (state) {
    const { data } = await db.from('subaccounts').select('id,name,location_id').eq('id', state.s).eq('org_id', access.orgId).maybeSingle();
    target = data;
  }
  if (!t.locationId && t.companyId) {
    // Installed at agency level: get a token for the target location
    if (!target) return fail('Installed at agency level. Click Enable notifications on the sub-account in Nova instead.');
    try { t = await locationTokenFromCompany(t.access_token, t.companyId, target.location_id); }
    catch (e) { return fail('Installed at agency level, but GHL did not allow access to ' + target.name + ': ' + (e as Error).message); }
  }
  const locationId = t.locationId || '';
  if (!locationId) return fail('GHL did not say which location the app was installed on.');
  if (target && target.location_id !== locationId) {
    return fail(`The app was installed on a different GHL location (${locationId}) than "${target.name}" (${target.location_id}). Install it on the matching location.`);
  }
  if (!target) {
    const { data } = await db.from('subaccounts').select('id,name,location_id').eq('location_id', locationId).eq('org_id', access.orgId).maybeSingle();
    target = data;
  }
  if (!target) return fail(`Location ${locationId} is not added in Nova yet. Add it under Sub-accounts first.`);
  if (!access.subaccountIds.includes(target.id)) return fail('You do not have access to this sub-account.');

  const { data: other } = await db.from('ghl_app_installs').select('org_id').eq('location_id', locationId).maybeSingle();
  if (other && other.org_id !== access.orgId) return fail('This GHL location is connected to another Nova organization.');

  const { error } = await db.from('ghl_app_installs').upsert({
    org_id: access.orgId, subaccount_id: target.id, location_id: locationId, ...tokenColumns(t),
    status: 'active', installed_by: user.id, checked_at: new Date().toISOString()
  }, { onConflict: 'location_id' });
  if (error) return fail(error.message);
  return done('alerts_on=' + encodeURIComponent(target.name));
}
