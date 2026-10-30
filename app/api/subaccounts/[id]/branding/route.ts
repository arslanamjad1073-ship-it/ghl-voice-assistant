import { NextResponse } from 'next/server';
import { requireSubaccount } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeBranding } from '@/lib/emailTemplate';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await requireSubaccount(id);
  if (r.error) return r.error;
  const { data } = await supabaseAdmin().from('subaccounts').select('id,name,email_branding').eq('id', id).eq('org_id', r.sa.org_id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Sub-account not found' }, { status: 404 });
  return NextResponse.json({ id: data.id, name: data.name, branding: normalizeBranding(data.email_branding, data.name) });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await requireSubaccount(id, { perm: 'manage_branding' });
  if (r.error) return r.error;
  const db = supabaseAdmin();
  const sa = r.sa;
  const { branding } = await req.json().catch(() => ({}));
  const clean = normalizeBranding(branding, sa.name);
  const { error } = await db.from('subaccounts').update({ email_branding: clean }).eq('id', id).eq('org_id', sa.org_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ branding: clean });
}
