import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const COLS = 'id,created_at,action,status,message,contact_name,user_name,user_email,subaccount_id,subaccount_name,details';

// GET /api/activity?subaccount=&status=&q=&from=YYYY-MM-DD&to=YYYY-MM-DD&before=<iso>&limit=
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const p = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(p.get('limit')) || 30, 1), 100);

  let q = supabaseAdmin().from('activities').select(COLS).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  const sub = p.get('subaccount');
  if (sub) q = q.eq('subaccount_id', sub);
  const status = p.get('status');
  if (status === 'success' || status === 'error') q = q.eq('status', status);
  const search = (p.get('q') || '').trim().replace(/[%_,()]/g, ' ');
  if (search) q = q.or(`message.ilike.%${search}%,contact_name.ilike.%${search}%,user_name.ilike.%${search}%`);
  const from = p.get('from');
  if (from) q = q.gte('created_at', from);
  const to = p.get('to');
  if (to) q = q.lt('created_at', to);
  const before = p.get('before');
  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data || [];
  return NextResponse.json({ items: rows.slice(0, limit), hasMore: rows.length > limit });
}
