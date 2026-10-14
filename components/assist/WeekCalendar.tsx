'use client';
import { useEffect, useState } from 'react';
import { IconBack } from '@/components/Icons';

interface Item { start: string; end: string; kind: 'free' | 'booked' | 'blocked'; title?: string }
interface Day { date: string; items: Item[] }

const pad = (n: number) => (n < 10 ? '0' : '') + n;
function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const dayLabel = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return { wd: t.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }), md: t.toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }) };
};
export const clock = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`; };

const STYLE: Record<Item['kind'], string> = {
  free: 'border border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20',
  booked: 'border border-[#a78bfa]/40 bg-[#a78bfa]/15 text-[#c4b5fd] cursor-not-allowed',
  blocked: 'border border-bad/30 text-bad/90 cursor-not-allowed bg-[repeating-linear-gradient(135deg,rgba(248,113,113,.12)_0_6px,transparent_6px_12px)]'
};

// One week of a GHL calendar: free slots (pickable), booked appointments and blocked time
export default function WeekCalendar({ subaccountId, calendarId, slotMinutes, today, initialStart, value, onChange }: {
  subaccountId: string; calendarId: string; slotMinutes: number; today: string; initialStart: string;
  value: { date: string; time: string } | null; onChange: (v: { date: string; time: string } | null) => void;
}) {
  const [start, setStart] = useState(initialStart < today ? today : initialStart);
  const [days, setDays] = useState<Day[] | null>(null);
  const [tz, setTz] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!calendarId) return;
    setDays(null); setError('');
    fetch('/api/ghl/week?' + new URLSearchParams({ subaccount: subaccountId, calendar: calendarId, start, len: String(slotMinutes) }))
      .then((r) => r.json()).then((d) => { if (d.error) throw new Error(d.error); setDays(d.days); setTz(d.timezone); })
      .catch((e) => { setError(e.message || 'Could not load the calendar'); setDays([]); });
  }, [subaccountId, calendarId, start, slotMinutes]);

  const free = days?.reduce((n, d) => n + d.items.filter((i) => i.kind === 'free').length, 0) || 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setStart(addDays(start, -7) < today ? today : addDays(start, -7))} disabled={start <= today}
            aria-label="Previous week" className="flex size-9 items-center justify-center rounded-full bg-card hover:bg-card-2 disabled:opacity-40"><IconBack size={16} /></button>
          <span className="px-2 text-sm font-medium">{dayLabel(start).md} – {dayLabel(addDays(start, 6)).md}</span>
          <button type="button" onClick={() => setStart(addDays(start, 7))} aria-label="Next week"
            className="flex size-9 items-center justify-center rounded-full bg-card hover:bg-card-2"><IconBack size={16} className="rotate-180" /></button>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="size-3 rounded border border-cyan/40 bg-cyan/20" /> Available</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-[#a78bfa]/40" /> Booked</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded border border-bad/40 bg-[repeating-linear-gradient(135deg,rgba(248,113,113,.4)_0_2px,transparent_2px_4px)]" /> Blocked</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded bg-cyan" /> Selected</span>
        </div>
      </div>

      {error && <p className="mb-2 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
      <div className="-mx-1 overflow-x-auto pb-2">
        <div className="grid min-w-[760px] grid-cols-7 gap-1.5 px-1">
          {(days || Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), items: [] as Item[] }))).map((d) => {
            const l = dayLabel(d.date);
            return (
              <div key={d.date} className={`rounded-xl p-1.5 ${d.date === today ? 'bg-cyan/5 ring-1 ring-cyan/20' : 'bg-card/40'}`}>
                <div className="mb-1.5 text-center">
                  <div className="text-[11px] uppercase tracking-wide text-muted">{l.wd}</div>
                  <div className="text-sm font-semibold">{l.md}</div>
                </div>
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {days === null && [0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-card" />)}
                  {days !== null && !d.items.length && <p className="py-3 text-center text-[11px] text-faint">No times</p>}
                  {d.items.map((it, i) => {
                    const selected = it.kind === 'free' && value?.date === d.date && value?.time === it.start;
                    return (
                      <button type="button" key={i} disabled={it.kind !== 'free'} title={it.kind === 'free' ? `${clock(it.start)}–${clock(it.end)}` : `${it.title} · ${clock(it.start)}–${clock(it.end)}`}
                        onClick={() => onChange(selected ? null : { date: d.date, time: it.start })}
                        className={`block w-full truncate rounded-lg px-1.5 py-1.5 text-center text-xs font-medium transition ${selected ? 'bg-cyan text-cyan-ink' : STYLE[it.kind]}`}>
                        {clock(it.start)}{it.kind !== 'free' && <span className="block truncate text-[10px] font-normal opacity-80">{it.title}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {days && !error && <p className="mt-1 text-xs text-muted">{free} open slot{free === 1 ? '' : 's'} this week · times in {tz} · {slotMinutes} min each</p>}
    </div>
  );
}
