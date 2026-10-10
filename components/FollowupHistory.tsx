'use client';
import { useEffect, useState } from 'react';
import { relative } from '@/components/ActivityItem';

interface Row {
  id: number; created_at: string; channel: string; subject: string | null; body: string;
  ai_suggested: boolean; edited: boolean; status: 'sent' | 'failed'; error: string | null; user_name: string | null;
}
const LABEL: Record<string, string> = { sms: 'SMS', email: 'Email', facebook: 'Facebook', instagram: 'Instagram' };

// Follow-ups sent to this contact from the app; `version` bumps after each send to refresh
export default function FollowupHistory({ subaccountId, contactId, version }: { subaccountId: string; contactId: string; version: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/leads/followups?' + new URLSearchParams({ subaccount: subaccountId, contact: contactId }), { cache: 'no-store' })
      .then((r) => r.json()).then((d) => setRows(d.items || [])).catch(() => setRows([]));
  }, [subaccountId, contactId, version]);

  return (
    <div className="rounded-[24px] border border-line bg-panel p-5 sm:p-6">
      <h3 className="mb-3 text-lg font-semibold">Follow-up history</h3>
      {rows === null ? (
        <div className="h-16 animate-pulse rounded-2xl bg-card" />
      ) : !rows.length ? (
        <p className="text-sm text-muted">No follow-ups sent from Nova to this contact yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="w-full rounded-2xl bg-card p-3.5 text-left hover:bg-card-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${r.status === 'failed' ? 'bg-bad/15 text-bad' : 'bg-cyan/15 text-cyan'}`}>{LABEL[r.channel] || r.channel}</span>
                  {r.status === 'failed' && <span className="text-bad">Failed</span>}
                  {r.ai_suggested && <span className="text-muted">AI{r.edited ? ' · edited' : ''}</span>}
                  <span className="ml-auto text-muted" title={new Date(r.created_at).toLocaleString()}>
                    {new Date(r.created_at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, {new Date(r.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {relative(r.created_at)}
                  </span>
                </div>
                {r.subject && <p className="mt-1.5 text-sm font-medium">{r.subject}</p>}
                <p className={`mt-1 whitespace-pre-wrap text-sm text-muted ${open === r.id ? '' : 'line-clamp-2'}`}>{r.body}</p>
                {open === r.id && (
                  <p className="mt-2 text-xs text-faint">Sent by {r.user_name || 'unknown'}{r.error ? ' · ' + r.error : ''}</p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
