import { NextResponse } from 'next/server';
import { requireUser, displayName } from '@/lib/auth';
import { getSubaccountFull } from '@/lib/ghlActions';
import { getContact, getTranscript, transcriptText } from '@/lib/ghl';
import { writeContent } from '@/lib/assist';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST { subaccountId, kind: email|sms|note, instruction, contactId? } -> { subject, body }
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const b = await req.json().catch(() => ({}));
  const sa = await getSubaccountFull(String(b.subaccountId || ''));
  if (!sa) return NextResponse.json({ error: 'Choose a sub-account first' }, { status: 400 });
  const kind = ['email', 'sms', 'note'].includes(b.kind) ? b.kind : 'email';
  if (!String(b.instruction || '').trim()) return NextResponse.json({ error: 'Tell the AI what to write' }, { status: 400 });
  try {
    let name = '', transcript = '';
    if (b.contactId) {
      const [c, t] = await Promise.all([getContact(sa, b.contactId), getTranscript(sa, b.contactId, 60).catch(() => null)]);
      name = c.name; transcript = t ? transcriptText(t.messages) : '';
    }
    return NextResponse.json(await writeContent(kind, String(b.instruction), { contactName: name, company: sa.name, sender: displayName(auth.user), transcript }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
