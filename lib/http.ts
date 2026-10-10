import 'server-only';
import { timingSafeEqual } from 'crypto';

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Voximplant scenario requests carry "Authorization: Bearer <SCENARIO_SECRET>"
export function isScenario(req: Request) {
  const secret = process.env.SCENARIO_SECRET || '';
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  return secret.length >= 16 && safeEqual(got, secret);
}
