import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ghl, getContact } from '@/lib/ghl';
import { notifyReply, channelName } from '@/lib/notify';
import { signatureValid } from '@/lib/ghlApp';

export const dynamic = 'force-dynamic';

interface Msg { id?: string; locationId?: string; contactId?: string; direction?: string; body?: string; messageType?: string; type?: unknown }
const SKIP = new Set(['CALL', 'TYPE_CALL', 'ACTIVITY', 'TYPE_ACTIVITY', 'CUSTOM_PROVIDER_SMS_INTERNAL']);

// Events from Nova's GHL Marketplace app (one URL for every installed location).
// InboundMessage -> alert. Each message is confirmed with GHL (using the sub-account's token) before
// it is shown, so a forged request can't create alerts. UNINSTALL / INSTALL update the install status.
export async function POST(req: Request) {
  const raw = await req.text();
  let p: Record<string, unknown>;
  try { p = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const type = String(p.type || '');
  const locationId = String(p.locationId || '');
  const sig = signatureValid(raw, req.headers);
  if (sig === false) return NextResponse.json({ error: 'Bad signature' }, { status: 401 });
  const db = supabaseAdmin();

  if (type === 'UNINSTALL' || type === 'INSTALL') {
    // Only trusted when signed (these change state without a message to confirm)
    if (sig && locationId) {
      await db.from('ghl_app_installs').update({ status: type === 'UNINSTALL' ? 'uninstalled' : 'active' }).eq('location_id', locationId);
    }
    return NextResponse.json({ ok: true });
  }
  if (type !== 'InboundMessage') return NextResponse.json({ ok: true, ignored: type });

  const { data: inst } = await db.from('ghl_app_installs').select('status,subaccounts(id,org_id,name,location_id,ghl_token,timezone)')
    .eq('location_id', locationId).maybeSingle();
  const sa = (Array.isArray(inst?.subaccounts) ? inst?.subaccounts[0] : inst?.subaccounts) as
    { id: string; org_id: string; name: string; location_id: string; ghl_token: string; timezone: string } | null | undefined;
  if (!inst || inst.status !== 'active' || !sa) return NextResponse.json({ ok: true, ignored: 'location not enabled in Nova' });

  const messageId = String(p.messageId || '');
  let contactId = String(p.contactId || '');
  let body = String(p.body || '');
  let kind = String(p.messageType || '');
  let direction = String(p.direction || 'inbound');

  // Confirm the message really exists in this location
  let confirmed = false;
  if (messageId) {
    try {
      const d = await ghl<{ message?: Msg } & Msg>(sa.ghl_token, '/conversations/messages/' + encodeURIComponent(messageId), { version: '2021-04-15' });
      const m = (d.message || d) as Msg;
      if (m.locationId && m.locationId !== sa.location_id) return NextResponse.json({ error: 'Location mismatch' }, { status: 400 });
      contactId = m.contactId || contactId;
      body = m.body || body;
      kind = m.messageType || kind;
      direction = m.direction || direction;
      confirmed = true;
    } catch { /* fall back to the signature below */ }
  }
  if (!confirmed && !sig) return NextResponse.json({ error: 'Could not confirm the message' }, { status: 401 });
  if (direction !== 'inbound' || SKIP.has(kind.toUpperCase()) || !contactId) return NextResponse.json({ ok: true, ignored: 'not an inbound message' });

  let name = String(p.contactName || p.fullName || '');
  if (!name) name = await getContact(sa, contactId).then((c) => c.name).catch(() => '');

  const r = await notifyReply(sa, {
    contactId, name, channel: channelName(kind), preview: body,
    dedupe: 'app:' + (messageId || contactId + ':' + body.slice(0, 50) + ':' + Math.floor(Date.now() / 60000))
  });
  await db.from('ghl_app_installs').update({ last_event_at: new Date().toISOString() }).eq('location_id', locationId);
  return NextResponse.json({ ok: true, ...r });
}
