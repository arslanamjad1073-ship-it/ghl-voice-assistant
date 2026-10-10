import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

// Voximplant one-time-key login: hash = md5(key + "|" + md5(user + ":voximplant.com:" + password))
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { key } = await req.json().catch(() => ({}));
  if (!key || typeof key !== 'string' || key.length > 200) return NextResponse.json({ error: 'Missing key' }, { status: 400 });
  const user = process.env.VOX_USER!, password = process.env.VOX_PASSWORD!;
  return NextResponse.json({ hash: md5(key + '|' + md5(user + ':voximplant.com:' + password)) });
}
