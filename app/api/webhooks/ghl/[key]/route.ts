import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ghl } from '@/lib/ghl';
import { pushToSubscribers } from '@/lib/push';
import { broadcastRefresh } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

interface Conv { id: string; lastMessageBody?: string; lastMessageType?: string; lastMessageDirection?: string; lastMessageDate?: number | string; fullName?: string; contactName?: string }

const CHANNEL: Record<string, string> = { SMS: 'SMS', EMAIL: 'Email', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', WHATSAPP: 'WhatsApp', CALL: 'Call', GMB: 'Google', WEBCHAT: 'Web chat', LIVE_CHAT: 'Live chat' };
const channelName = (t?: unknown) => {
  const raw = String(t ?? '').replace(/^TYPE_/, '').toUpperCase();
  return CHANNEL[raw] || (raw && isNaN(Number(raw)) ? raw.charAt(0) + raw.slice(1).toLowerCase() : 'Message');
};
const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) { const v = k.split('.').reduce<unknown>((x, p) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[p] : undefined), o); if (v) return String(v); }
  return '';
};

// GHL workflow: Trigger "Customer Replied" -> Action "Webhook" (POST) to /api/webhooks/ghl/<sub-account key>
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const db = supabaseAdmin();
  const { data: sa } = await db.from('subaccounts').select('id,name,location_id,ghl_token').eq('webhook_key', key).maybeSingle();
  if (!sa) return NextResponse.json({ error: 'Unknown webhook key' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const contactId = pick(body, 'contact_id', 'contactId', 'contact.id');
  if (!contactId) return NextResponse.json({ error: 'No contact_id in the payload' }, { status: 400 });

  let name = pick(body, 'full_name', 'contact_name', 'contact.name') || [pick(body, 'first_name'), pick(body, 'last_name')].filter(Boolean).join(' ');
  let preview = pick(body, 'message.body', 'message_body', 'body');
  let channel = channelName(pick(body, 'message.type', 'message_type'));
  let dedupe = '';

  // The conversation's last message is the reliable source for text, channel and direction
  try {
    const d = await ghl<{ conversations?: Conv[] }>(sa.ghl_token,
      '/conversations/search?locationId=' + encodeURIComponent(sa.location_id) + '&contactId=' + encodeURIComponent(contactId) + '&sort=desc&sortBy=last_message_date&limit=1',
      { version: '2021-04-15' });
    const c = d.conversations?.[0];
    if (c) {
      if (c.lastMessageDirection === 'outbound' && !preview) return NextResponse.json({ ok: true, skipped: 'last message is outbound' });
      preview = c.lastMessageBody || preview;
      channel = c.lastMessageType ? channelName(c.lastMessageType) : channel;
      name = name || c.fullName || c.contactName || '';
      dedupe = c.id + ':' + (c.lastMessageDate || '');
    }
  } catch { /* fall back to the payload */ }

  preview = preview.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || 'New message';
  name = name || 'A contact';
  if (!dedupe) dedupe = contactId + ':' + preview.slice(0, 50) + ':' + Math.floor(Date.now() / 60000);

  const { error } = await db.from('notifications').insert({
    subaccount_id: sa.id, subaccount_name: sa.name, contact_id: contactId, contact_name: name, channel, preview, dedupe_key: dedupe
  });
  if (error?.code === '23505') return NextResponse.json({ ok: true, duplicate: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const [push] = await Promise.all([pushToSubscribers(sa.id, {
    title: `${name} · ${channel}`,
    body: preview,
    url: `/leads?sa=${sa.id}&contact=${encodeURIComponent(contactId)}`,
    tag: 'msg-' + contactId
  }), broadcastRefresh()]);
  return NextResponse.json({ ok: true, push });
}
