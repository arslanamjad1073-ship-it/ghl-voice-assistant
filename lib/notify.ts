import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { pushToSubscribers } from '@/lib/push';
import { broadcastRefresh } from '@/lib/realtime';

export interface AlertSubaccount { id: string; org_id: string; name: string }

// Saves a "contact replied" notification and alerts the members who can access the sub-account.
// dedupe makes repeated deliveries of the same message a no-op.
export async function notifyReply(sa: AlertSubaccount, m: { contactId: string; name: string; channel: string; preview: string; dedupe: string }) {
  const preview = m.preview.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || 'New message';
  const name = m.name || 'A contact';
  const { error } = await supabaseAdmin().from('notifications').insert({
    org_id: sa.org_id, subaccount_id: sa.id, subaccount_name: sa.name, contact_id: m.contactId, contact_name: name,
    channel: m.channel, preview, dedupe_key: m.dedupe.slice(0, 300)
  });
  if (error?.code === '23505') return { duplicate: true };
  if (error) throw new Error(error.message);
  const [push] = await Promise.all([pushToSubscribers(sa.org_id, sa.id, {
    title: `${name} · ${m.channel}`,
    body: preview,
    url: `/leads?sa=${sa.id}&contact=${encodeURIComponent(m.contactId)}`,
    tag: 'msg-' + m.contactId
  }), broadcastRefresh()]);
  return { push };
}

const CHANNEL: Record<string, string> = {
  SMS: 'SMS', EMAIL: 'Email', FB: 'Facebook', FACEBOOK: 'Facebook', IG: 'Instagram', INSTAGRAM: 'Instagram', WHATSAPP: 'WhatsApp',
  GMB: 'Google', WEBCHAT: 'Web chat', LIVE_CHAT: 'Live chat', CALL: 'Call'
};
export const channelName = (t?: unknown) => {
  const raw = String(t ?? '').replace(/^TYPE_/, '').toUpperCase();
  return CHANNEL[raw] || (raw && isNaN(Number(raw)) ? raw.charAt(0) + raw.slice(1).toLowerCase().replace(/_/g, ' ') : 'Message');
};
