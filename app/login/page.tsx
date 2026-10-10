'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';
import Orb from '@/components/Orb';

type Mode = 'signin' | 'signup' | 'magic';

const input =
  'h-12 w-full rounded-2xl border border-line bg-card px-4 text-[15px] text-fg placeholder:text-faint outline-none transition focus:border-cyan focus:ring-3 focus:ring-cyan/20';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const urlError = params.get('error');
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(
    urlError === 'not_allowed'
      ? { text: 'This email is not on the allowed list. Ask an admin for access.', bad: true }
      : urlError ? { text: urlError, bad: true } : null
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const supabase = supabaseBrowser();
    const redirectTo = window.location.origin + '/auth/callback';
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace('/');
        router.refresh();
        return;
      }
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email, password, options: { data: { full_name: name.trim() }, emailRedirectTo: redirectTo }
        });
        if (error) throw error;
        // Supabase hides existing accounts: no error, no email, and an empty identities list
        if (data.user && !data.user.identities?.length) {
          setMode('magic');
          setMsg({ text: 'This email already has an account. Sign in with your password, or send yourself a sign-in link below.', bad: true });
          return;
        }
        if (data.session) { router.replace('/'); router.refresh(); return; }
        setMsg({ text: 'Check your inbox and confirm your email to finish signing up.' });
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
        if (error) throw error;
        setMsg({ text: 'We emailed you a sign-in link. Open it on this device.' });
      }
    } catch (err) {
      setMsg({ text: (err as Error).message || 'Something went wrong', bad: true });
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.replace('/login');
    setMsg(null);
  }

  return (
    <main className="mx-auto grid min-h-dvh max-w-5xl items-center gap-10 px-5 py-10 lg:grid-cols-2">
      <section className="flex flex-col items-center text-center lg:items-start lg:text-left">
        <div className="mb-6 lg:-ml-6"><Orb state="live" size={220} /></div>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Run your CRM<br />by voice.
        </h1>
        <p className="mt-4 max-w-sm text-[15px] text-muted">
          Meet Nova. Find contacts, add tags, book appointments and send invoices, just by asking.
        </p>
      </section>

      <section className="w-full max-w-md justify-self-center rounded-[28px] border border-line bg-panel p-6 sm:p-8">
        <p className="text-sm font-medium text-cyan">Flow<span className="text-fg">minds</span> · Nova</p>
        <h2 className="mt-2 text-2xl font-semibold">
          {mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Sign in with a link'}
        </h2>

        <form onSubmit={submit} className="mt-6 space-y-3">
          {mode === 'signup' && (
            <input className={input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          )}
          <input className={input} type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          {mode !== 'magic' && (
            <input className={input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
              required minLength={6} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          )}
          <button disabled={busy}
            className="h-12 w-full rounded-2xl bg-cyan font-semibold text-cyan-ink transition hover:bg-[#7ddcf7] disabled:cursor-wait disabled:opacity-60">
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Email me a link'}
          </button>
        </form>

        {msg && (
          <p role="status" className={`mt-4 rounded-2xl px-4 py-3 text-sm ${msg.bad ? 'bg-bad/10 text-bad' : 'bg-cyan/10 text-cyan'}`}>
            {msg.text}
            {urlError === 'not_allowed' && (
              <button onClick={signOut} className="ml-2 underline">Sign out</button>
            )}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
          {mode !== 'signin' && <button className="hover:text-fg" onClick={() => setMode('signin')}>Sign in with password</button>}
          {mode !== 'magic' && <button className="hover:text-fg" onClick={() => setMode('magic')}>Email me a sign-in link</button>}
          {mode !== 'signup' && <button className="hover:text-fg" onClick={() => setMode('signup')}>Create an account</button>}
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
