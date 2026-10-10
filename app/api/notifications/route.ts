import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET -> latest notifications for the sub-accounts this user has not muted, unread count, and the mute list
export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const db = supabaseAdmin();
  const { data: st } = await db.from('user_state').select('notifications_read_at,muted_subaccounts').eq('user_id', auth.user.id).maybeSingle();
  const muted: string[] = st?.muted_subaccounts || [];
  let q = db.from('notifications').select('id,created_at,subaccount_id,subaccount_name,contact_id,contact_name,channel,preview')
    .order('created_at', { ascending: false }).limit(40);
  if (muted.length) q = q.not('subaccount_id', 'in', '(' + muted.join(',') + ')');
  const { data: items } = await q;
  const readAt = st?.notifications_read_at || new Date(0).toISOString();
  const list = items || [];
  return NextResponse.json({ items: list, readAt, unread: list.filter((n) => n.created_at > readAt).length, muted });
}

// POST -> mark everything read
export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const now = new Date().toISOString();
  await supabaseAdmin().from('user_state').upsert({ user_id: auth.user.id, notifications_read_at: now }, { onConflict: 'user_id' });
  return NextResponse.json({ ok: true, readAt: now });
}
