'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useSubaccounts } from '@/lib/useSubaccounts';
import type { Activity } from '@/lib/types';
import ActivityItem from '@/components/ActivityItem';
import Assistant from '@/components/assist/Assistant';
import { IconPlus } from '@/components/Icons';

export default function HomeView({ name, email = '' }: { name: string; email?: string }) {
  const sa = useSubaccounts();
  const [recent, setRecent] = useState<Activity[] | null>(null);

  const loadRecent = useCallback(() => {
    if (sa.loading) return;
    const q = new URLSearchParams({ limit: '8' });
    if (sa.selected) q.set('subaccount', sa.selected);
    fetch('/api/activity?' + q, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setRecent(d.items || []))
      .catch(() => setRecent([]));
  }, [sa.loading, sa.selected]);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  return (
    <div>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold leading-[1.1] tracking-tight sm:text-4xl">Hello, {name}</h1>
          <p className="mt-2 text-[15px] text-muted">Tell Nova what to do in your CRM.</p>
        </div>
        {sa.items.length > 0 && (
          <div className="-mx-4 flex max-w-full gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {sa.items.map((s) => (
              <button key={s.id} onClick={() => sa.setSelected(s.id)} aria-pressed={s.id === sa.selected}
                className={`h-10 shrink-0 rounded-full px-5 text-sm font-medium transition ${s.id === sa.selected ? 'bg-cyan text-cyan-ink' : 'bg-card text-fg hover:bg-card-2'}`}>
                {s.name}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {sa.loading ? (
            <div className="h-52 animate-pulse rounded-[28px] bg-card" />
          ) : sa.error ? (
            <p className="rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">{sa.error}</p>
          ) : sa.current ? (
            <Assistant subaccountId={sa.current.id} subaccountName={sa.current.name} senderName={name} userEmail={email}
              voiceEnabled={!!sa.current.voice_enabled} onDone={loadRecent} />
          ) : (
            <Link href="/subaccounts" className="flex items-center gap-3 rounded-2xl border border-dashed border-line p-6 text-muted hover:text-fg">
              <IconPlus /> Add your first sub-account to get started
            </Link>
          )}
        </div>

        <section className="min-w-0">
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
              Nothing yet. Everything you do here shows up in this list, like<br />
              <span className="text-fg">Tag <span className="text-cyan">VIP</span> added to contact <span className="text-cyan">John Smith</span></span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
