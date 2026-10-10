import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getSubaccount, getContact, getTranscript, transcriptText } from '@/lib/ghl';
import { gemini } from '@/lib/gemini';
import { SUMMARY_PROMPT } from '@/lib/leadPrompts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST { subaccountId, contactId } -> contact, AI summary and the conversation
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { subaccountId, contactId } = await req.json().catch(() => ({}));
  const sa = await getSubaccount(String(subaccountId || ''));
  if (!sa) return NextResponse.json({ error: 'Choose a sub-account first' }, { status: 400 });
  if (!contactId) return NextResponse.json({ error: 'Choose a contact' }, { status: 400 });

  try {
    const [contact, t] = await Promise.all([getContact(sa, contactId), getTranscript(sa, contactId)]);
    const channels = Array.from(new Set(t.messages.filter((m) => m.who !== 'System').map((m) => m.channel)));
    const conversational = t.messages.filter((m) => m.who !== 'System');
    if (!conversational.length) {
      return NextResponse.json({ contact, summary: '', messages: t.messages, messageCount: 0, channels, note: 'No conversation with this contact yet.' });
    }
    const summary = await gemini(SUMMARY_PROMPT, [{
      role: 'user',
      text: 'Contact: ' + contact.name + (contact.email ? ', ' + contact.email : '') + (contact.phone ? ', ' + contact.phone : '') +
        '\nTimezone: ' + sa.timezone + '\n\nTranscript:\n' + transcriptText(t.messages)
    }]);
    return NextResponse.json({ contact, summary, messages: t.messages, messageCount: conversational.length, channels, threads: t.threads });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
