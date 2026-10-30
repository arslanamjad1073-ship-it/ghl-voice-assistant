'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Orb from '@/components/Orb';
import { supabaseBrowser } from '@/lib/supabase/client';

interface Info { email: string; name: string; member: string | null; canCreate: boolean; invites: { token: string; role: string; invitedBy: string; orgName: string }[] }
const input = 'h-12 w-full rounded-2xl border border-line bg-card px-4 text-[15px] text-fg placeholder:text-faint outline-none transition focus:border-cyan focus:ring-3 focus:ring-cyan/20';

// Signed in, but not in an organization: accept an invite or start a new organization
export default function WelcomePage() {
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/org', { cache: 'no-store' }).then(async (r) => {
      if (r.status === 401) { router.replace('/login'); return; }
      const d = await r.json();
      if (d.member === 'active') { router.replace('/'); return; }
      setInfo(d);
    }).catch(() => setError('Could not load your account'));
  }, [router]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const r = await fetch('/api/org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error || 'Could not create the organization'); return; }
    window.location.href = '/subaccounts';
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.replace('/login');
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-5 py-10">
      <Orb state="idle" size={140} />
      <section className="mt-6 w-full rounded-[28px] border border-line bg-panel p-6 sm:p-8">
        <p className="text-sm font-medium text-cyan">Flow<span className="text-fg">minds</span> · Nova</p>
        {!info && !error && <div className="mt-4 h-24 animate-pulse rounded-2xl bg-card" />}
        {info?.member === 'disabled' && (
          <>
            <h1 className="mt-2 text-2xl font-semibold">Your access is paused</h1>
            <p className="mt-2 text-[15px] text-muted">The owner of your organization has disabled your account. Ask them to turn it back on.</p>
          </>
        )}
        {info && info.member !== 'disabled' && (
          <>
            <h1 className="mt-2 text-2xl font-semibold">Welcome, {info.name}</h1>
            {info.invites.length > 0 && (
              <div className="mt-5 space-y-2">
                <p className="text-sm text-muted">You have been invited to:</p>
                {info.invites.map((i) => (
                  <Link key={i.token} href={'/invite/' + i.token} className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 hover:bg-card-2">
                    <span><span className="block font-medium">{i.orgName}</span><span className="block text-xs text-muted">as {i.role === 'admin' ? 'Admin' : 'User'}{i.invitedBy ? `, by ${i.invitedBy}` : ''}</span></span>
                    <span className="text-sm font-semibold text-cyan">Open</span>
                  </Link>
                ))}
              </div>
            )}
            {info.canCreate ? (
              <form onSubmit={create} className="mt-6 space-y-3">
                <p className="text-[15px] text-muted">{info.invites.length ? 'Or start your own organization:' : 'Start your organization. You will be its owner and can then add sub-accounts and invite your team.'}</p>
                <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name, e.g. Acme Marketing" required />
                <button disabled={busy} className="h-12 w-full rounded-2xl bg-cyan font-semibold text-cyan-ink hover:bg-[#7ddcf7] disabled:opacity-60">{busy ? 'Creating…' : 'Create organization'}</button>
              </form>
            ) : !info.invites.length && (
              <p className="mt-4 text-[15px] text-muted">You are signed in as {info.email}, but you are not part of a team yet. Ask the owner of your organization to invite this email.</p>
            )}
          </>
        )}
        {error && <p className="mt-4 rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>}
        <button onClick={signOut} className="mt-6 text-sm text-muted hover:text-fg">Sign out</button>
      </section>
    </main>
  );
}
