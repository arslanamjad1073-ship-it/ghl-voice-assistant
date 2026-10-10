import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getSubaccount, getTranscript, transcriptText } from '@/lib/ghl';
import { gemini, type Turn } from '@/lib/gemini';
import { ASK_PROMPT } from '@/lib/leadPrompts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST { subaccountId, contactId, question, history: [{ q, a }] } -> { answer }
// The conversation is loaded fresh for every question; the chat history comes from the browser,
// so each team member has their own follow-up memory.
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const b = await req.json().catch(() => ({}));
  const question = String(b.question || '').trim().slice(0, 1000);
  const sa = await getSubaccount(String(b.subaccountId || ''));
  if (!sa) return NextResponse.json({ error: 'Choose a sub-account first' }, { status: 400 });
  if (!b.contactId || !question) return NextResponse.json({ error: 'Contact and question are required' }, { status: 400 });

  const history: Turn[] = (Array.isArray(b.history) ? b.history : []).slice(-8).flatMap((h: { q?: string; a?: string }) => [
    { role: 'user' as const, text: String(h.q || '').slice(0, 1000) },
    { role: 'model' as const, text: String(h.a || '').slice(0, 2000) }
  ]).filter((t: Turn) => t.text);

  try {
    const t = await getTranscript(sa, String(b.contactId));
    const system = ASK_PROMPT + '\n\nTranscript (oldest first):\n' + (transcriptText(t.messages) || '[no messages]');
    const answer = await gemini(system, [...history, { role: 'user', text: question }]);
    return NextResponse.json({ answer });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
