import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getSubaccountFull, getMeta } from '@/lib/ghlActions';

export const dynamic = 'force-dynamic';

// GET ?subaccount= -> pipelines+stages, calendars, team members, tags, timezone, currency
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const sa = await getSubaccountFull(new URL(req.url).searchParams.get('subaccount') || '');
  if (!sa) return NextResponse.json({ error: 'Sub-account not found' }, { status: 404 });
  return NextResponse.json(await getMeta(sa));
}
