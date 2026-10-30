import { NextResponse } from 'next/server';
import { requireAccess, scopeIds } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET /api/leads/followups?subaccount=&contact=  (contact optional: all follow-ups of the sub-account)
export async function GET(req: Request) {
  const auth = await requireAccess();
  if (auth.error) return auth.error;
  const { access } = auth;
  const p = new URL(req.url).searchParams;
  const ids = scopeIds(access, p.get('subaccount'));
  if (!ids) return NextResponse.json({ items: [] });
  let q = supabaseAdmin().from('followups')
    .select('id,created_at,contact_id,contact_name,channel,subject,body,ai_suggested,edited,status,error,user_name,subaccount_name')
    .eq('org_id', access.orgId);
  if (ids !== 'all') q = q.in('subaccount_id', ids);
  q = q.order('created_at', { ascending: false }).limit(Math.min(Number(p.get('limit')) || 50, 200));
  if (p.get('contact')) q = q.eq('contact_id', p.get('contact'));
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}
