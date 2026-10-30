'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Orb from '@/components/Orb';
import { supabaseBrowser } from '@/lib/supabase/client';
import { sessionFromUrl } from '@/lib/authFromUrl';

interface Invite { orgName: string; email: string; name: string; role: 'admin' | 'user'; invitedBy: string; status: 'open' | 'accepted' | 'expired' | 'cancelled' }
const input = 'h-12 w-full rounded-2xl border border-line bg-card px-4 text-[15px] text-fg placeholder:text-faint outline-none transition focus:border-cyan focus:ring-3 focus:ring-cyan/20 disabled:opacity-60';
const btn = 'h-12 w-full rounded-2xl bg-cyan font-semibold text-cyan-ink transition hover:bg-[#7ddcf7] disabled:cursor-wait disabled:opacity-60';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [me, setMe] = useState<{ email: string } | null | undefined>(undefined);
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const refreshUser = useCallback(async () => {
    const { data: { user } } = await supabaseBrowser().auth.getUser();
    setMe(user ? { email: user.email || '' } : null);
  }, []);

  useEffect(() => {
    (async () => {
      await sessionFromUrl();
      await refreshUser();
      const r = await fetch('/api/invites/' + token, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ text: d.error || 'This invite link is not valid.', bad: true }); return; }
      setInvite(d); setName(d.name || '');
    })();
  }, [token, refreshUser]);

  async function auth(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setBusy(true); setMsg(null);
    const supabase = supabaseBrowser();
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: invite.email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: invite.email, password, options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin + '/invite/' + token }
        });
        if (error) throw error;
        if (data.user && !data.user.identities?.length) { setMode('signin'); throw new Error('This email already has a login. Sign in with its password.'); }
        if (!data.session) { setMsg({ text: `We emailed ${invite.email} a confirmation link. Open it on this device to finish joining.` }); return; }
      }
      await refreshUser();
    } catch (err) {
      setMsg({ text: (err as Error).message || 'Something went wrong', bad: true });
    } finally { setBusy(false); }
  }

  async function accept() {
    setBusy(true); setMsg(null);
    try {
      if (newPassword) {
        const { error } = await supabaseBrowser().auth.updateUser({ password: newPassword });
        if (error) throw error;
      }
      const r = await fetch('/api/invites/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not join');
      window.location.href = '/';
    } catch (err) {
      setMsg({ text: (err as Error).message, bad: true });
      setBusy(false);
    }
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    setMe(null); setMsg(null);
  }

  const sameEmail = !!me && !!invite && me.email.toLowerCase() === invite.email.toLowerCase();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 py-10">
      <Orb state="idle" size={130} />
      <section className="mt-6 w-full rounded-[28px] border border-line bg-panel p-6 sm:p-8">
        <p className="text-sm font-medium text-cyan">Flow<span className="text-fg">minds</span> · Nova</p>
        {!invite && !msg && <div className="mt-4 h-28 animate-pulse rounded-2xl bg-card" />}
        {invite && (
          <>
            <h1 className="mt-2 text-2xl font-semibold leading-tight">Join {invite.orgName}</h1>
            <p className="mt-2 text-[15px] text-muted">
              {invite.invitedBy || 'The team'} invited <b className="text-fg">{invite.email}</b> as {invite.role === 'admin' ? 'an Admin' : 'a User'}.
            </p>

            {invite.status !== 'open' && (
              <p className="mt-4 rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">
                {invite.status === 'accepted' ? 'This invite was already used. Sign in to continue.' : invite.status === 'expired' ? 'This invite has expired. Ask for a new one.' : 'This invite was cancelled.'}
              </p>
            )}

            {invite.status === 'open' && me === null && (
              <form onSubmit={auth} className="mt-6 space-y-3">
                <div role="tablist" className="grid grid-cols-2 gap-1 rounded-2xl bg-card p-1 text-sm">
                  {(['signup', 'signin'] as const).map((m) => (
                    <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                      className={`h-10 rounded-xl font-medium ${mode === m ? 'bg-card-2 text-fg' : 'text-muted'}`}>{m === 'signup' ? 'New to Nova' : 'I have a login'}</button>
                  ))}
                </div>
                <input className={input} value={invite.email} disabled aria-label="Email" />
                {mode === 'signup' && <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required autoComplete="name" />}
                <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'Choose a password' : 'Password'}
                  required minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
                <button disabled={busy} className={btn}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create login' : 'Sign in'}</button>
              </form>
            )}

            {invite.status === 'open' && me && !sameEmail && (
              <div className="mt-5 rounded-2xl bg-[#f5b041]/10 p-4 text-sm text-[#f8c471]">
                You are signed in as {me.email}. This invite is for {invite.email}.
                <button onClick={signOut} className="ml-2 font-semibold underline">Sign out</button>
              </div>
            )}

            {invite.status === 'open' && sameEmail && (
              <div className="mt-6 space-y-3">
                <input className={input} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6}
                  placeholder="Set a password (optional)" autoComplete="new-password" aria-label="Set a password" />
                <p className="text-xs text-muted">Came here from the invite email? Set a password so you can sign in later. Otherwise leave it empty.</p>
                <button onClick={accept} disabled={busy} className={btn}>{busy ? 'Joining…' : `Join ${invite.orgName}`}</button>
              </div>
            )}
          </>
        )}
        {msg && <p role="status" className={`mt-4 rounded-2xl px-4 py-3 text-sm ${msg.bad ? 'bg-bad/10 text-bad' : 'bg-cyan/10 text-cyan'}`}>{msg.text}</p>}
      </section>
    </main>
  );
}
