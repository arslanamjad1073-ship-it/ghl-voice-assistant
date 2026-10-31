import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ghl } from '@/lib/ghl';
import { notifyReply, channelName } from '@/lib/notify';

export const dynamic = 'force-dynamic';

interface Conv { id: string; lastMessageBody?: string; lastMessageType?: string; lastMessageDirection?: string; lastMessageDate?: number | string; fullName?: string; contactName?: string }

const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) { const v = k.split('.').reduce<unknown>((x, p) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[p] : undefined), o); if (v) return String(v); }
  return '';
};

// GHL workflow: Trigger "Customer Replied" -> Action "Webhook" (POST) to /api/webhooks/ghl/<sub-account key>
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const db = supabaseAdmin();
  const { data: sa } = await db.from('subaccounts').select('id,org_id,name,location_id,ghl_token').eq('webhook_key', key).maybeSingle();
  if (!sa) return NextResponse.json({ error: 'Unknown webhook key' }, { status: 404 });
  // Locations with Nova's GHL app installed get alerts from the app; skip so nobody is alerted twice
  const { data: app } = await db.from('ghl_app_installs').select('status').eq('location_id', sa.location_id).maybeSingle();
  if (app?.status === 'active') return NextResponse.json({ ok: true, skipped: 'alerts come from the Nova GHL app' });

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

  if (!dedupe) dedupe = contactId + ':' + preview.slice(0, 50) + ':' + Math.floor(Date.now() / 60000);
  const r = await notifyReply(sa, { contactId, name, channel, preview, dedupe });
  return NextResponse.json({ ok: true, ...r });
}
