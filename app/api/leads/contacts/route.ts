import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getSubaccount, searchContacts } from '@/lib/ghl';

export const dynamic = 'force-dynamic';

// GET /api/leads/contacts?subaccount=<id>&q=<name, email or phone>  (empty q = recently updated)
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const p = new URL(req.url).searchParams;
  const sa = await getSubaccount(p.get('subaccount') || '');
  if (!sa) return NextResponse.json({ error: 'Choose a sub-account first' }, { status: 400 });
  try {
    return NextResponse.json({ items: await searchContacts(sa, (p.get('q') || '').trim().slice(0, 100)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
