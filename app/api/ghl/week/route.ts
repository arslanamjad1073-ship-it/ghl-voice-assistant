import { NextResponse } from 'next/server';
import { requireSubaccount } from '@/lib/access';
import { getWeek, todayIn } from '@/lib/ghlActions';

export const dynamic = 'force-dynamic';

// GET ?subaccount=&calendar=&start=YYYY-MM-DD&len=<slot minutes> -> 7 days of free / booked / blocked slots
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const r = await requireSubaccount(p.get('subaccount'));
  if (r.error) return r.error;
  const sa = r.sa;
  if (!p.get('calendar')) return NextResponse.json({ error: 'Choose a calendar' }, { status: 400 });
  const start = /^\d{4}-\d{2}-\d{2}$/.test(p.get('start') || '') ? p.get('start')! : todayIn(sa.timezone);
  try {
    return NextResponse.json(await getWeek(sa, p.get('calendar')!, start, Number(p.get('len')) || 30));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
