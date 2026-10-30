import { NextResponse } from 'next/server';
import { requireAccess, scopeIds } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const COLS = 'id,created_at,action,status,message,contact_name,user_name,user_email,subaccount_id,subaccount_name,details';

// GET /api/activity?subaccount=&status=&q=&from=YYYY-MM-DD&to=YYYY-MM-DD&before=<iso>&limit=
// Only this organization's history, and only for the sub-accounts the member can access.
export async function GET(req: Request) {
  const auth = await requireAccess();
  if (auth.error) return auth.error;
  const { access } = auth;
  const p = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(Number(p.get('limit')) || 30, 1), 100);

  const ids = scopeIds(access, p.get('subaccount'));
  if (!ids) return NextResponse.json({ items: [], hasMore: false });

  let q = supabaseAdmin().from('activities').select(COLS).eq('org_id', access.orgId);
  if (ids !== 'all') q = q.in('subaccount_id', ids);
  q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
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
