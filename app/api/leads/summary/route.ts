import { NextResponse } from 'next/server';
import { displayName } from '@/lib/auth';
import { requireSubaccount } from '@/lib/access';
import { getContact, getTranscript, transcriptText, channelStates, lastOutbound } from '@/lib/ghl';
import { draftFollowup } from '@/lib/followup';
import { llm } from '@/lib/llm';
import { SUMMARY_PROMPT } from '@/lib/leadPrompts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST { subaccountId, contactId } -> contact, AI summary and the conversation
export async function POST(req: Request) {
  const { subaccountId, contactId } = await req.json().catch(() => ({}));
  const r = await requireSubaccount(subaccountId);
  if (r.error) return r.error;
  const { sa, access } = r;
  const auth = { user: access.user };
  if (!contactId) return NextResponse.json({ error: 'Choose a contact' }, { status: 400 });

  try {
    const [contact, t] = await Promise.all([getContact(sa, contactId), getTranscript(sa, contactId)]);
    const channels = Array.from(new Set(t.messages.filter((m) => m.who !== 'System').map((m) => m.channel)));
    const conversational = t.messages.filter((m) => m.who !== 'System');
    const text = transcriptText(t.messages);
    const extra = { states: channelStates(contact, t.messages), lastOutbound: lastOutbound(t.messages), senderName: displayName(auth.user), userEmail: auth.user.email || '' };
    const draft = draftFollowup(contact, text, { senderName: displayName(auth.user), company: sa.name, timezone: sa.timezone }, { orgId: sa.org_id, feature: 'followup_draft', userId: auth.user.id, subaccountId: sa.id })
      .catch((e) => ({ error: (e as Error).message }));
    if (!conversational.length) {
      return NextResponse.json({ contact, summary: '', messages: t.messages, messageCount: 0, channels, note: 'No conversation with this contact yet.', followup: await draft, ...extra });
    }
    const [summary, followup] = await Promise.all([llm(SUMMARY_PROMPT, [{
      role: 'user',
      text: 'Contact: ' + contact.name + (contact.email ? ', ' + contact.email : '') + (contact.phone ? ', ' + contact.phone : '') +
        '\nTimezone: ' + sa.timezone + '\n\nTranscript:\n' + text
    }], { track: { orgId: sa.org_id, feature: 'lead_summary', userId: auth.user.id, subaccountId: sa.id } }), draft]);
    return NextResponse.json({ contact, summary, messages: t.messages, messageCount: conversational.length, channels, threads: t.threads, followup, ...extra });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
