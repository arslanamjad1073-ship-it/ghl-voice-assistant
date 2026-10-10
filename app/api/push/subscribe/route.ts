import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// POST { subscription } from PushManager.subscribe()
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { subscription } = await req.json().catch(() => ({}));
  const endpoint = subscription?.endpoint, p256dh = subscription?.keys?.p256dh, key = subscription?.keys?.auth;
  if (!endpoint || !p256dh || !key) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
  const { error } = await supabaseAdmin().from('push_subscriptions').upsert(
    { user_id: auth.user.id, endpoint, p256dh, auth: key, user_agent: (req.headers.get('user-agent') || '').slice(0, 300) },
    { onConflict: 'endpoint' }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE { endpoint }
export async function DELETE(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { endpoint } = await req.json().catch(() => ({}));
  if (endpoint) await supabaseAdmin().from('push_subscriptions').delete().eq('endpoint', endpoint).eq('user_id', auth.user.id);
  return NextResponse.json({ ok: true });
}
