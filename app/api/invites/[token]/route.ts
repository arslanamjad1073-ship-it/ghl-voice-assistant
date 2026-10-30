import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET -> what the invite page shows (works before signing in; the token is the secret)
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data: inv } = await supabaseAdmin().from('invites')
    .select('email,name,role,invited_by_name,expires_at,accepted_at,revoked_at,organizations(name)').eq('token', token).maybeSingle();
  if (!inv) return NextResponse.json({ error: 'This invite link is not valid.' }, { status: 404 });
  const org = (Array.isArray(inv.organizations) ? inv.organizations[0] : inv.organizations) as { name?: string } | null;
  const status = inv.accepted_at ? 'accepted' : inv.revoked_at ? 'cancelled' : new Date(inv.expires_at) < new Date() ? 'expired' : 'open';
  return NextResponse.json({ orgName: org?.name || '', email: inv.email, name: inv.name || '', role: inv.role, invitedBy: inv.invited_by_name || '', status });
}
