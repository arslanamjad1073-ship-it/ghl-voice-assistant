'use client';
import { supabaseBrowser } from '@/lib/supabase/client';

// Invite and sign-in emails can land with tokens in the URL: #access_token=… (invite / magic link
// sent by the server) or ?code=… (email confirmation). Turn them into a session, then clean the URL.
export async function sessionFromUrl() {
  if (typeof window === 'undefined') return;
  const supabase = supabaseBrowser();
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const url = new URL(window.location.href);
  try {
    if (hash.get('access_token') && hash.get('refresh_token')) {
      await supabase.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! });
    } else if (url.searchParams.get('code')) {
      await supabase.auth.exchangeCodeForSession(url.searchParams.get('code')!);
    } else return;
  } catch { /* expired link: the page shows the sign-in form */ }
  url.hash = '';
  url.searchParams.delete('code');
  window.history.replaceState(null, '', url.pathname + url.search);
}
