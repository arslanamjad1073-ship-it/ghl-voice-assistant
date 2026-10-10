import { NextResponse } from 'next/server';
import { requireUser, displayName } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSubaccount, getContact, getTranscript, channelStates, lastOutbound, sendMessage, CHANNEL_LABEL, type Channel } from '@/lib/ghl';
import { renderEmail } from '@/lib/emailTemplate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FIVE_MIN = 5 * 60 * 1000;
const CHANNELS: Channel[] = ['sms', 'email', 'facebook', 'instagram'];

// POST { subaccountId, contactId, channel, subject?, body, aiSuggested?, edited?, confirm? }
// 409 { warning } when something was sent to this contact in the last 5 minutes and confirm is not set.
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const b = await req.json().catch(() => ({}));
  const channel = b.channel as Channel;
  const text = String(b.body || '').trim();
  const subject = String(b.subject || '').trim();
  if (!CHANNELS.includes(channel)) return NextResponse.json({ error: 'Choose a channel' }, { status: 400 });
  if (!text) return NextResponse.json({ error: 'The message is empty' }, { status: 400 });
  if (channel === 'email' && !subject) return NextResponse.json({ error: 'The email needs a subject' }, { status: 400 });
  if (channel !== 'email' && text.length > 1600) return NextResponse.json({ error: 'The message is too long (max 1600 characters)' }, { status: 400 });

  const sa = await getSubaccount(String(b.subaccountId || ''));
  if (!sa || !b.contactId) return NextResponse.json({ error: 'Sub-account and contact are required' }, { status: 400 });
  const db = supabaseAdmin();

  let contact, transcript;
  try {
    [contact, transcript] = await Promise.all([getContact(sa, b.contactId), getTranscript(sa, b.contactId)]);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const state = channelStates(contact, transcript.messages)[channel];
  if (!state.available) return NextResponse.json({ error: state.reason || CHANNEL_LABEL[channel] + ' is not available' }, { status: 400 });

  // Recent-send guard: last team message in GHL, or a follow-up sent from this app
  if (!b.confirm) {
    const last = lastOutbound(transcript.messages);
    const { data: recent } = await db.from('followups').select('created_at,channel,user_name')
      .eq('subaccount_id', sa.id).eq('contact_id', contact.id).eq('status', 'sent')
      .gte('created_at', new Date(Date.now() - FIVE_MIN).toISOString()).order('created_at', { ascending: false }).limit(1);
    const candidates = [
      last && Date.now() - new Date(last.at).getTime() < FIVE_MIN ? { at: last.at, channel: last.channel, by: '' } : null,
      recent?.[0] ? { at: recent[0].created_at, channel: CHANNEL_LABEL[recent[0].channel as Channel], by: recent[0].user_name || '' } : null
    ].filter(Boolean) as { at: string; channel: string; by: string }[];
    const latest = candidates.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())[0];
    if (latest) {
      const mins = Math.max(1, Math.round((Date.now() - new Date(latest.at).getTime()) / 60000));
      return NextResponse.json({
        warning: `A message was already sent to ${contact.name} ${mins} minute${mins === 1 ? '' : 's'} ago` +
          ` (${latest.channel}${latest.by ? ', by ' + latest.by : ''}). Send this one anyway?`
      }, { status: 409 });
    }
  }

  const sender = displayName(auth.user);
  const firstName = contact.name.split(/\s+/)[0] || '';
  let messageId = '', error = '';
  try {
    if (channel === 'email') {
      const { data: row } = await db.from('subaccounts').select('email_branding').eq('id', sa.id).maybeSingle();
      const branding = { companyName: sa.name, ...(row?.email_branding || {}) };
      const html = renderEmail(branding, { subject, body: text, senderName: sender, firstName });
      messageId = await sendMessage(sa, contact.id, channel, text, { subject, html });
    } else {
      messageId = await sendMessage(sa, contact.id, channel, text);
    }
  } catch (e) {
    error = (e as Error).message;
  }

  const status = error ? 'failed' : 'sent';
  const base = { subaccount_id: sa.id, subaccount_name: sa.name, user_id: auth.user.id, user_email: auth.user.email, user_name: sender };
  await db.from('followups').insert({
    ...base, contact_id: contact.id, contact_name: contact.name, channel, subject: channel === 'email' ? subject : null, body: text,
    ai_suggested: !!b.aiSuggested, edited: !!b.edited, status, error: error || null, ghl_message_id: messageId || null
  });
  await db.from('activities').insert({
    ...base, action: 'send_followup', status: error ? 'error' : 'success', contact_id: contact.id, contact_name: contact.name,
    message: error
      ? `Follow-up ${CHANNEL_LABEL[channel]} to "${contact.name}" failed: ${error}`
      : channel === 'email' ? `Follow-up email "${subject}" sent to "${contact.name}"` : `Follow-up ${CHANNEL_LABEL[channel]} sent to "${contact.name}"`,
    details: { channel, subject, body: text, ai_suggested: !!b.aiSuggested, edited: !!b.edited, source: 'leads' }
  });

  if (error) return NextResponse.json({ error }, { status: 502 });
  return NextResponse.json({ ok: true, messageId });
}
