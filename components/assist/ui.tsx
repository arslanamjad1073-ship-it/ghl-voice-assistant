'use client';
import type { ReactNode } from 'react';
import { IconAlert, IconCheck, IconX } from '@/components/Icons';

export const input = 'h-11 w-full rounded-xl border border-line bg-card px-3.5 text-[14.5px] text-fg placeholder:text-faint outline-none transition focus:border-cyan focus:ring-3 focus:ring-cyan/20 disabled:opacity-60';
export const textarea = input + ' h-auto resize-y py-2.5 leading-relaxed';
export const primaryBtn = 'inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cyan px-6 font-semibold text-cyan-ink transition hover:bg-[#7ddcf7] disabled:cursor-not-allowed disabled:opacity-50';
export const ghostBtn = 'inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-3.5 text-sm text-muted hover:bg-card-2 hover:text-fg disabled:opacity-50';

export interface Meta {
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  calendars: { id: string; name: string; slotMinutes: number }[];
  users: { id: string; name: string; email: string; role: string }[];
  tags: string[];
  timezone: string; currency: string; today: string; invoiceLiveMode: boolean;
}
export interface Contact { id: string; name: string; email: string; phone: string; tags: string[]; company: string }

export function Field({ label, hint, children, className = '' }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={'block ' + className}>
      <span className="mb-1.5 block text-sm font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Result({ result }: { result: { ok: boolean; text: string } | null }) {
  if (!result) return null;
  return (
    <p role="status" className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-sm ${result.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>
      {result.ok ? <IconCheck size={18} className="shrink-0" /> : <IconAlert size={18} className="shrink-0" />} {result.text}
    </p>
  );
}

export function Card({ icon, title, subtitle, onClose, children }: { icon: ReactNode; title: string; subtitle?: string; onClose?: () => void; children: ReactNode }) {
  return (
    <div className="activity-in min-w-0 rounded-[24px] border border-line bg-panel p-4 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cyan/12 text-cyan">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold leading-tight">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {onClose && <button onClick={onClose} aria-label="Close" className="flex size-9 items-center justify-center rounded-full text-muted hover:bg-card hover:text-fg"><IconX size={18} /></button>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string } }> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export const ACTION = (subaccountId: string, action: string, contactId: string | undefined, data: object) =>
  postJson<{ message?: string }>('/api/ghl/action', { subaccountId, action, contactId, data });

// Case-insensitive name match used to map AI-parsed names to dropdown ids
export function matchName<T extends { name: string }>(list: T[], name: unknown): T | undefined {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return undefined;
  return list.find((x) => x.name.toLowerCase() === n) || list.find((x) => x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
}

// The GHL team member a message or invoice goes out as: the one named in the prompt,
// else the member matching the signed-in email, else an admin, else the first member.
export function defaultSender(users: Meta['users'], named: unknown, myEmail: string) {
  const me = myEmail.toLowerCase();
  return (matchName(users, named) || users.find((u) => me && u.email.toLowerCase() === me)
    || users.find((u) => /admin/i.test(u.role)) || users[0])?.id || '';
}

export function SendAsSelect({ users, value, onChange }: { users: Meta['users']; value: string; onChange: (id: string) => void }) {
  return (
    <Field label="Send as" hint={users.length ? 'The team member this goes out from in GHL.' : 'No team members found in this sub-account.'}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={input} disabled={!users.length}>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.email ? ` · ${u.email}` : ''}</option>)}
      </select>
    </Field>
  );
}
