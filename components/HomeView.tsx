'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSubaccounts } from '@/lib/useSubaccounts';
import type { Activity } from '@/lib/types';
import ActivityItem from '@/components/ActivityItem';
import Orb from '@/components/Orb';
import { IconLogout, IconMic, IconPlus } from '@/components/Icons';

export default function HomeView({ name, email }: { name: string; email: string }) {
  const sa = useSubaccounts();
  const [recent, setRecent] = useState<Activity[] | null>(null);

  useEffect(() => {
    if (sa.loading) return;
    const q = new URLSearchParams({ limit: '8' });
    if (sa.selected) q.set('subaccount', sa.selected);
    fetch('/api/activity?' + q, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setRecent(d.items || []))
      .catch(() => setRecent([]));
  }, [sa.loading, sa.selected]);

  return (
    <div>
      {/* Greeting */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-tight sm:text-4xl">
            Hello,<br />{name}
          </h1>
          <p className="mt-2 text-[15px] text-muted">Let&apos;s run your CRM by voice</p>
        </div>
        <form action="/auth/signout" method="post">
          <button title={'Sign out ' + email} aria-label="Sign out"
            className="flex size-12 items-center justify-center rounded-full bg-card text-muted transition hover:bg-card-2 hover:text-fg">
            <IconLogout size={20} />
          </button>
        </form>
      </header>

      <div className="mt-7 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-8">
          {/* Hero card */}
          <section className="relative overflow-hidden rounded-[28px] bg-cyan p-6 text-cyan-ink sm:p-7">
            <div className="relative z-10 max-w-[60%]">
              <h2 className="text-[26px] font-bold leading-tight">Talk to Nova</h2>
              <p className="mt-2 text-[15px] leading-snug text-cyan-ink/80">
                Find contacts, add tags, book appointments, send invoices. Just ask.
              </p>
              <Link href="/talk"
                aria-disabled={!sa.selected}
                className={`mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-ink px-5 font-semibold text-fg transition hover:bg-black ${!sa.selected ? 'pointer-events-none opacity-50' : ''}`}>
                <IconMic size={18} /> Start talking
              </Link>
            </div>
            <div className="absolute -right-24 top-1/2 -translate-y-1/2 rounded-full bg-[#0d2a36] p-2 sm:-right-4">
              <Orb state="idle" size={190} />
            </div>
          </section>

          {/* Sub-account chips */}
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-xl font-semibold">Sub-account</h2>
              <Link href="/subaccounts" className="text-[15px] text-muted hover:text-fg">Manage</Link>
            </div>
            {sa.loading ? (
              <div className="flex gap-2">{[0, 1].map((i) => <div key={i} className="h-12 w-36 animate-pulse rounded-full bg-card" />)}</div>
            ) : sa.error ? (
              <p className="rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">{sa.error}</p>
            ) : sa.items.length ? (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
                {sa.items.map((s) => (
                  <button key={s.id} onClick={() => sa.setSelected(s.id)} aria-pressed={s.id === sa.selected}
                    className={`h-12 shrink-0 rounded-full px-6 text-[15px] font-medium transition ${
                      s.id === sa.selected ? 'bg-cyan text-cyan-ink' : 'bg-card text-fg hover:bg-card-2'
                    }`}>
                    {s.name}
                  </button>
                ))}
              </div>
            ) : (
              <Link href="/subaccounts" className="flex items-center gap-3 rounded-2xl border border-dashed border-line p-4 text-muted hover:text-fg">
                <IconPlus /> Add your first sub-account to start talking
              </Link>
            )}
          </section>
        </div>

        {/* Recent activity */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">Recent activity</h2>
            <Link href="/history" className="text-[15px] text-muted hover:text-fg">See all</Link>
          </div>
          {recent === null ? (
            <ul className="space-y-2.5">{[0, 1, 2].map((i) => <li key={i} className="h-[72px] animate-pulse rounded-2xl bg-card" />)}</ul>
          ) : recent.length ? (
            <ul className="space-y-2.5">{recent.map((a) => <ActivityItem key={a.id} item={a} />)}</ul>
          ) : (
            <div className="rounded-2xl bg-card p-6 text-center text-[15px] text-muted">
              Nothing yet. Everything Nova does will show up here, like<br />
              <span className="text-fg">Tag <span className="text-cyan">VIP</span> added to contact <span className="text-cyan">John Smith</span></span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
