import { NextResponse } from 'next/server';
import { requireAccess } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET -> latest notifications of the sub-accounts this member can access and has not muted, unread count, mute list
export async function GET() {
  const auth = await requireAccess();
  if (auth.error) return auth.error;
  const { access } = auth;
  const db = supabaseAdmin();
  const { data: st } = await db.from('user_state').select('notifications_read_at,muted_subaccounts').eq('user_id', access.user.id).maybeSingle();
  const muted: string[] = st?.muted_subaccounts || [];
  const readAt = st?.notifications_read_at || new Date(0).toISOString();
  if (!access.allSubaccounts && !access.subaccountIds.some((id) => !muted.includes(id))) return NextResponse.json({ items: [], readAt, unread: 0, muted });
  let q = db.from('notifications').select('id,created_at,subaccount_id,subaccount_name,contact_id,contact_name,channel,preview').eq('org_id', access.orgId);
  if (!access.allSubaccounts) q = q.in('subaccount_id', access.subaccountIds.filter((id) => !muted.includes(id)));
  else if (muted.length) q = q.not('subaccount_id', 'in', '(' + muted.join(',') + ')');
  const { data: items } = await q.order('created_at', { ascending: false }).limit(40);
  const list = items || [];
  return NextResponse.json({ items: list, readAt, unread: list.filter((n) => n.created_at > readAt).length, muted });
}

// POST -> mark everything read
export async function POST() {
  const auth = await requireAccess();
  if (auth.error) return auth.error;
  const now = new Date().toISOString();
  await supabaseAdmin().from('user_state').upsert({ user_id: auth.access.user.id, notifications_read_at: now }, { onConflict: 'user_id' });
  return NextResponse.json({ ok: true, readAt: now });
}
