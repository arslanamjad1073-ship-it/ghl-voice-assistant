import { NextResponse } from 'next/server';
import { requireSubaccount } from '@/lib/access';
import { contactOpportunities } from '@/lib/ghlActions';

export const dynamic = 'force-dynamic';

// GET ?subaccount=&contact= -> the contact's opportunities
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const r = await requireSubaccount(p.get('subaccount'));
  if (r.error) return r.error;
  const sa = r.sa;
  if (!p.get('contact')) return NextResponse.json({ error: 'Sub-account and contact are required' }, { status: 400 });
  try { return NextResponse.json({ items: await contactOpportunities(sa, p.get('contact')!) }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
