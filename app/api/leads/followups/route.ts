import { NextResponse } from 'next/server';
import { requireAccess } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET /api/leads/followups?subaccount=&contact=  (contact optional: all follow-ups of the sub-account)
export async function GET(req: Request) {
  const auth = await requireAccess();
  if (auth.error) return auth.error;
  const { access } = auth;
  const p = new URL(req.url).searchParams;
  const sub = p.get('subaccount');
  if (sub && !access.subaccountIds.includes(sub)) return NextResponse.json({ items: [] });
  const ids = sub ? [sub] : access.subaccountIds;
  if (!ids.length) return NextResponse.json({ items: [] });
  let q = supabaseAdmin().from('followups')
    .select('id,created_at,contact_id,contact_name,channel,subject,body,ai_suggested,edited,status,error,user_name,subaccount_name')
    .eq('org_id', access.orgId).in('subaccount_id', ids)
    .order('created_at', { ascending: false }).limit(Math.min(Number(p.get('limit')) || 50, 200));
  if (p.get('contact')) q = q.eq('contact_id', p.get('contact'));
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}
