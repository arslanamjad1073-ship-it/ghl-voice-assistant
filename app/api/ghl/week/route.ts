import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getSubaccountFull, getWeek, todayIn } from '@/lib/ghlActions';

export const dynamic = 'force-dynamic';

// GET ?subaccount=&calendar=&start=YYYY-MM-DD&len=<slot minutes> -> 7 days of free / booked / blocked slots
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const p = new URL(req.url).searchParams;
  const sa = await getSubaccountFull(p.get('subaccount') || '');
  if (!sa) return NextResponse.json({ error: 'Sub-account not found' }, { status: 404 });
  if (!p.get('calendar')) return NextResponse.json({ error: 'Choose a calendar' }, { status: 400 });
  const start = /^\d{4}-\d{2}-\d{2}$/.test(p.get('start') || '') ? p.get('start')! : todayIn(sa.timezone);
  try {
    return NextResponse.json(await getWeek(sa, p.get('calendar')!, start, Number(p.get('len')) || 30));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
