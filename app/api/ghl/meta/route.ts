import { NextResponse } from 'next/server';
import { requireSubaccount } from '@/lib/access';
import { getMeta } from '@/lib/ghlActions';

export const dynamic = 'force-dynamic';

// GET ?subaccount= -> pipelines+stages, calendars, team members, tags, timezone, currency
export async function GET(req: Request) {
  const r = await requireSubaccount(new URL(req.url).searchParams.get('subaccount'));
  if (r.error) return r.error;
  return NextResponse.json(await getMeta(r.sa));
}
