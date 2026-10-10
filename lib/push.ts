import 'server-only';
import webpush from 'web-push';
import { supabaseAdmin } from '@/lib/supabase/admin';

let configured = false;
function configure() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv);
    configured = true;
  }
  return true;
}

// Sends a push to every subscribed browser; drops subscriptions the browser has revoked
export async function pushToAll(payload: { title: string; body: string; url: string; tag?: string }) {
  if (!configure()) return { sent: 0, skipped: 'VAPID keys not set' };
  const db = supabaseAdmin();
  const { data } = await db.from('push_subscriptions').select('id,endpoint,p256dh,auth');
  let sent = 0;
  await Promise.all((data || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
    }
  }));
  return { sent };
}
