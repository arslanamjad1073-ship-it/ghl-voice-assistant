import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET /api/leads/followups?subaccount=&contact=  (contact optional: all follow-ups of the sub-account)
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const p = new URL(req.url).searchParams;
  let q = supabaseAdmin().from('followups')
    .select('id,created_at,contact_id,contact_name,channel,subject,body,ai_suggested,edited,status,error,user_name,subaccount_name')
    .order('created_at', { ascending: false }).limit(Math.min(Number(p.get('limit')) || 50, 200));
  if (p.get('subaccount')) q = q.eq('subaccount_id', p.get('subaccount'));
  if (p.get('contact')) q = q.eq('contact_id', p.get('contact'));
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}
