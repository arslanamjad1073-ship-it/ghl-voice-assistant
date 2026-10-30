import { NextResponse } from 'next/server';
import { displayName } from '@/lib/auth';
import { requireSubaccount } from '@/lib/access';
import { getContact, getTranscript, transcriptText } from '@/lib/ghl';
import { draftFollowup } from '@/lib/followup';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST { subaccountId, contactId } -> a fresh AI follow-up draft
export async function POST(req: Request) {
  const { subaccountId, contactId } = await req.json().catch(() => ({}));
  const r = await requireSubaccount(subaccountId);
  if (r.error) return r.error;
  const { sa, access } = r;
  if (!contactId) return NextResponse.json({ error: 'Choose a contact' }, { status: 400 });
  try {
    const [contact, t] = await Promise.all([getContact(sa, contactId), getTranscript(sa, contactId)]);
    return NextResponse.json(await draftFollowup(contact, transcriptText(t.messages), { senderName: displayName(access.user), company: sa.name, timezone: sa.timezone }, { orgId: sa.org_id, feature: 'followup_draft', userId: access.user.id, subaccountId: sa.id }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
