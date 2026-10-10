import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeBranding } from '@/lib/emailTemplate';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { id } = await params;
  const { data } = await supabaseAdmin().from('subaccounts').select('id,name,email_branding').eq('id', id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Sub-account not found' }, { status: 404 });
  return NextResponse.json({ id: data.id, name: data.name, branding: normalizeBranding(data.email_branding, data.name) });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser({ admin: true });
  if (auth.error) return auth.error;
  const { id } = await params;
  const db = supabaseAdmin();
  const { data: sa } = await db.from('subaccounts').select('name').eq('id', id).maybeSingle();
  if (!sa) return NextResponse.json({ error: 'Sub-account not found' }, { status: 404 });
  const { branding } = await req.json().catch(() => ({}));
  const clean = normalizeBranding(branding, sa.name);
  const { error } = await db.from('subaccounts').update({ email_branding: clean }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ branding: clean });
}
