import { NextResponse } from 'next/server';
import { requireSubaccount } from '@/lib/access';
import { searchContacts } from '@/lib/ghl';

export const dynamic = 'force-dynamic';

// GET /api/leads/contacts?subaccount=<id>&q=<name, email or phone>  (empty q = recently updated)
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const r = await requireSubaccount(p.get('subaccount'));
  if (r.error) return r.error;
  const sa = r.sa;
  try {
    return NextResponse.json({ items: await searchContacts(sa, (p.get('q') || '').trim().slice(0, 100)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
