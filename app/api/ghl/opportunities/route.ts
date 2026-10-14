import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getSubaccountFull, contactOpportunities } from '@/lib/ghlActions';

export const dynamic = 'force-dynamic';

// GET ?subaccount=&contact= -> the contact's opportunities
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const p = new URL(req.url).searchParams;
  const sa = await getSubaccountFull(p.get('subaccount') || '');
  if (!sa || !p.get('contact')) return NextResponse.json({ error: 'Sub-account and contact are required' }, { status: 400 });
  try { return NextResponse.json({ items: await contactOpportunities(sa, p.get('contact')!) }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
