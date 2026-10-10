import { NextResponse } from 'next/server';
import { isScenario } from '@/lib/http';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { renderEmail } from '@/lib/emailTemplate';

export const dynamic = 'force-dynamic';

// Called by the Voximplant scenario before send_email: returns the email HTML with the sub-account's branding
// and the caller's name in the signature. POST { token, subject, body, firstName }
export async function POST(req: Request) {
  if (!isScenario(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.token || !b.body) return NextResponse.json({ error: 'token and body are required' }, { status: 400 });
  const { data: s } = await supabaseAdmin().from('call_sessions')
    .select('user_name,expires_at,subaccounts(name,email_branding)').eq('token', b.token).maybeSingle();
  if (!s) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  if (new Date(s.expires_at).getTime() < Date.now()) return NextResponse.json({ error: 'Session expired' }, { status: 410 });
  const sa = (Array.isArray(s.subaccounts) ? s.subaccounts[0] : s.subaccounts) as { name?: string; email_branding?: object } | null;
  const html = renderEmail({ companyName: sa?.name || '', ...(sa?.email_branding || {}) }, {
    subject: String(b.subject || ''), body: String(b.body), senderName: s.user_name || '', firstName: String(b.firstName || '')
  });
  return NextResponse.json({ html });
}
