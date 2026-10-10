import { NextResponse } from 'next/server';
import { requireUser, displayName } from '@/lib/auth';
import { getSubaccount, getContact, getTranscript, transcriptText } from '@/lib/ghl';
import { draftFollowup } from '@/lib/followup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST { subaccountId, contactId } -> a fresh AI follow-up draft
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { subaccountId, contactId } = await req.json().catch(() => ({}));
  const sa = await getSubaccount(String(subaccountId || ''));
  if (!sa || !contactId) return NextResponse.json({ error: 'Sub-account and contact are required' }, { status: 400 });
  try {
    const [contact, t] = await Promise.all([getContact(sa, contactId), getTranscript(sa, contactId)]);
    return NextResponse.json(await draftFollowup(contact, transcriptText(t.messages), { senderName: displayName(auth.user), company: sa.name, timezone: sa.timezone }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
