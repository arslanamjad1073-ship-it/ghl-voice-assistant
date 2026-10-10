import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// POST { subaccountId, enabled } -> turn alerts (bell + push) for one sub-account on or off for this user
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { subaccountId, enabled } = await req.json().catch(() => ({}));
  if (!subaccountId || typeof enabled !== 'boolean') return NextResponse.json({ error: 'subaccountId and enabled are required' }, { status: 400 });
  const db = supabaseAdmin();
  const { data: st } = await db.from('user_state').select('muted_subaccounts').eq('user_id', auth.user.id).maybeSingle();
  const set = new Set<string>(st?.muted_subaccounts || []);
  if (enabled) set.delete(subaccountId); else set.add(subaccountId);
  const muted = Array.from(set);
  const { error } = await db.from('user_state').upsert({ user_id: auth.user.id, muted_subaccounts: muted }, { onConflict: 'user_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ muted });
}
