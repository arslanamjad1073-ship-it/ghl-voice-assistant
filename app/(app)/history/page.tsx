'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ActivityItem from '@/components/ActivityItem';
import { IconSearch } from '@/components/Icons';
import { useSubaccounts } from '@/lib/useSubaccounts';
import type { Activity } from '@/lib/types';

const field = 'h-11 rounded-2xl border border-line bg-card px-3.5 text-[15px] text-fg outline-none focus:border-cyan';

// Local-midnight ISO for a YYYY-MM-DD input value (optionally +1 day for an inclusive "to")
function dayStart(v: string, plusDay = false) {
  if (!v) return '';
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, m - 1, d + (plusDay ? 1 : 0)).toISOString();
}

function dayLabel(iso: string) {
  const d = new Date(iso), today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const full = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return same(d, today) ? 'Today · ' + full : same(d, yest) ? 'Yesterday · ' + full : full;
}

export default function HistoryPage() {
  const sa = useSubaccounts();
  const [sub, setSub] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState<Activity[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '40' });
    if (sub) p.set('subaccount', sub);
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    if (from) p.set('from', dayStart(from));
    if (to) p.set('to', dayStart(to, true));
    if (before) p.set('before', before);
    try {
      const r = await fetch('/api/activity?' + p, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not load history');
      setItems((cur) => (before ? [...cur, ...d.items] : d.items));
      setHasMore(d.hasMore);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sub, status, q, from, to]);

  // Debounce so typing in search doesn't fire a request per key
  useEffect(() => { const t = setTimeout(() => load(), 300); return () => clearTimeout(t); }, [load]);

  const groups = useMemo(() => {
    const out: { label: string; items: Activity[] }[] = [];
    for (const a of items) {
      const label = dayLabel(a.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(a); else out.push({ label, items: [a] });
    }
    return out;
  }, [items]);

  return (
    <div>
      <h1 className="text-[30px] font-semibold tracking-tight">History</h1>
      <p className="mt-1 text-[15px] text-muted">Everything Nova did, with the day, date and time.</p>

      <div className="mt-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_0.8fr_0.8fr_0.8fr]">
        <label className="relative">
          <span className="sr-only">Search</span>
          <IconSearch size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search contact, tag, person…" className={field + ' w-full pl-10'} />
        </label>
        <select value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Sub-account" className={field}>
          <option value="">All sub-accounts</option>
          {sa.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Result" className={field}>
          <option value="">All results</option>
          <option value="success">Succeeded</option>
          <option value="error">Failed</option>
        </select>
        <label className="flex flex-col">
          <span className="sr-only">From date</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field + ' [color-scheme:dark]'} aria-label="From date" />
        </label>
        <label className="flex flex-col">
          <span className="sr-only">To date</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field + ' [color-scheme:dark]'} aria-label="To date" />
        </label>
      </div>

      {error && <p className="mt-6 rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>}

      <div className="mt-8 space-y-8">
        {groups.map((g) => (
          <section key={g.label}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{g.label}</h2>
            <ul className="grid gap-2.5 lg:grid-cols-2">
              {g.items.map((a) => <ActivityItem key={a.id} item={a} when="time" />)}
            </ul>
          </section>
        ))}
        {!loading && !items.length && !error && (
          <p className="rounded-2xl bg-card p-8 text-center text-muted">No activity matches these filters.</p>
        )}
        {loading && <ul className="grid gap-2.5 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <li key={i} className="h-[72px] animate-pulse rounded-2xl bg-card" />)}</ul>}
        {hasMore && !loading && (
          <div className="flex justify-center">
            <button onClick={() => load(items[items.length - 1]?.created_at)}
              className="h-11 rounded-full bg-card px-6 font-medium hover:bg-card-2">Load more</button>
          </div>
        )}
      </div>
    </div>
  );
}
