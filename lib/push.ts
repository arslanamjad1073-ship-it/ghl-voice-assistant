import 'server-only';
import webpush from 'web-push';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { membersWithAccess } from '@/lib/access';

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

// Sends a push to the browsers of members of the sub-account's organization who can access it
// and have not muted it; drops subscriptions the browser has revoked
export async function pushToSubscribers(orgId: string, subaccountId: string, payload: { title: string; body: string; url: string; tag?: string }) {
  if (!configure()) return { sent: 0, skipped: 'VAPID keys not set' };
  const db = supabaseAdmin();
  const allowed = await membersWithAccess(orgId, subaccountId);
  if (!allowed.length) return { sent: 0 };
  const [{ data: subs }, { data: muted }] = await Promise.all([
    db.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', allowed),
    db.from('user_state').select('user_id').contains('muted_subaccounts', [subaccountId])
  ]);
  const skip = new Set((muted || []).map((m) => m.user_id));
  let sent = 0;
  await Promise.all((subs || []).filter((s) => !skip.has(s.user_id)).map(async (s) => {
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
