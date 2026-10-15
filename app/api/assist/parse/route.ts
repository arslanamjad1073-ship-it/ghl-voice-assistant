import { NextResponse } from 'next/server';
import { requireUser, displayName } from '@/lib/auth';
import { getSubaccountFull, getMeta } from '@/lib/ghlActions';
import { searchContacts, getTranscript, transcriptText } from '@/lib/ghl';
import { parsePrompt, writeContent } from '@/lib/assist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST { subaccountId, prompt } -> { action, reply, fields, contacts, contact, meta }
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { subaccountId, prompt } = await req.json().catch(() => ({}));
  const sa = await getSubaccountFull(String(subaccountId || ''));
  if (!sa) return NextResponse.json({ error: 'Choose a sub-account first' }, { status: 400 });
  if (!String(prompt || '').trim()) return NextResponse.json({ error: 'Type what you want to do' }, { status: 400 });

  try {
    const meta = await getMeta(sa);
    const track = { userId: auth.user.id, subaccountId: sa.id };
    const p = await parsePrompt(String(prompt), meta, { feature: 'prompt_parse', ...track });
    const contacts = p.contact_query ? await searchContacts(sa, p.contact_query).catch(() => []) : [];
    const q = p.contact_query.toLowerCase();
    const exact = contacts.find((c) => c.email.toLowerCase() === q || (q.replace(/\D/g, '').length >= 7 && c.phone.replace(/\D/g, '').endsWith(q.replace(/\D/g, '').slice(-9))));
    const contact = exact || (contacts.length === 1 ? contacts[0] : null);

    // AI-written content requested in the prompt
    if (p.write_instruction && ['send_email', 'send_sms', 'add_note'].includes(p.action)) {
      const transcript = contact ? await getTranscript(sa, contact.id, 60).then((t) => transcriptText(t.messages)).catch(() => '') : '';
      const w = await writeContent(p.action === 'send_email' ? 'email' : p.action === 'send_sms' ? 'sms' : 'note', p.write_instruction,
        { contactName: contact?.name, company: sa.name, sender: displayName(auth.user), transcript }, { feature: 'ai_write', ...track });
      p.fields = { ...p.fields, ...(w.subject ? { subject: w.subject } : {}), body: w.body, ai_written: true };
    }
    return NextResponse.json({ ...p, contacts: contacts.slice(0, 8), contact, meta });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
