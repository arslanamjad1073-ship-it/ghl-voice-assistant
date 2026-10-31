import { NextResponse } from 'next/server';
import { requireSubaccount } from '@/lib/access';
import { appConfigured, installUrl, makeState } from '@/lib/ghlApp';

export const dynamic = 'force-dynamic';

// GET ?subaccount= -> sends the browser to GHL to install Nova's app on that sub-account (turns on message alerts)
export async function GET(req: Request) {
  const back = (msg: string) => NextResponse.redirect(new URL('/subaccounts?alerts_error=' + encodeURIComponent(msg), req.url));
  if (!appConfigured()) return back('The Nova GHL app is not set up yet (GHL_APP_CLIENT_ID, GHL_APP_CLIENT_SECRET, GHL_APP_INSTALL_URL).');
  const r = await requireSubaccount(new URL(req.url).searchParams.get('subaccount'), { perm: 'manage_subaccounts' });
  if (r.error) return back((await r.error.json().catch(() => ({}))).error || 'Not allowed');
  return NextResponse.redirect(installUrl(makeState(r.sa.id, r.access.user.id)));
}
