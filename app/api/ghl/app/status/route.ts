import { NextResponse } from 'next/server';
import { requireAccess, requireSubaccount } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { appConfigured, checkInstall } from '@/lib/ghlApp';

export const dynamic = 'force-dynamic';

// GET -> alert status of the member's sub-accounts: { configured, items: { [subaccountId]: { status, lastEventAt } } }
// Active installs are re-checked with GHL at most once an hour (detects an uninstall).
export async function GET() {
  const auth = await requireAccess();
  if (auth.error) return auth.error;
  const { access } = auth;
  const items: Record<string, { status: string; lastEventAt: string | null }> = {};
  if (!access.subaccountIds.length) return NextResponse.json({ configured: appConfigured(), items });
  let q = supabaseAdmin().from('ghl_app_installs').select('subaccount_id,location_id,status,last_event_at').eq('org_id', access.orgId);
  if (!access.allSubaccounts) q = q.in('subaccount_id', access.subaccountIds);
  const { data } = await q;
  await Promise.all((data || []).map(async (r) => {
    const status = r.status === 'active' ? await checkInstall(r.location_id) : r.status;
    items[r.subaccount_id] = { status, lastEventAt: r.last_event_at };
  }));
  return NextResponse.json({ configured: appConfigured(), items });
}

// DELETE ?subaccount= -> stop alerts from the app for this sub-account (remove the app in GHL too)
export async function DELETE(req: Request) {
  const r = await requireSubaccount(new URL(req.url).searchParams.get('subaccount'), { perm: 'manage_subaccounts' });
  if (r.error) return r.error;
  await supabaseAdmin().from('ghl_app_installs').update({ status: 'uninstalled', access_token: null, refresh_token: null })
    .eq('subaccount_id', r.sa.id).eq('org_id', r.sa.org_id);
  return NextResponse.json({ ok: true });
}
