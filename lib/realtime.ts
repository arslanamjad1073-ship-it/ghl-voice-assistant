import 'server-only';

export const NOTIFY_TOPIC = 'nova-notifications';

// Tells open Nova tabs to refresh their bell right away (Supabase Realtime broadcast).
// The payload carries no message data; tabs fetch the details through the authenticated API.
export async function broadcastRefresh() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(url + '/realtime/v1/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key },
      body: JSON.stringify({ messages: [{ topic: NOTIFY_TOPIC, event: 'new', payload: { at: Date.now() } }] }),
      cache: 'no-store'
    });
  } catch { /* the 60s poll is the fallback */ }
}
