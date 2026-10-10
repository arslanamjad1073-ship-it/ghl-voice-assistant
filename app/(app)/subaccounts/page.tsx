'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSubaccounts } from '@/lib/useSubaccounts';
import type { SubaccountPublic } from '@/lib/types';
import { IconBuilding, IconEdit, IconPlus, IconTrash, IconCheck, IconMail, IconBell } from '@/components/Icons';

const SCOPES = [
  'contacts.readonly', 'contacts.write', 'opportunities.readonly', 'opportunities.write',
  'calendars.readonly', 'calendars/events.readonly', 'calendars/events.write',
  'conversations.readonly', 'conversations/message.readonly', 'conversations/message.write',
  'invoices.readonly', 'invoices.write', 'locations.readonly', 'locations/customFields.readonly', 'users.readonly'
];

const input = 'h-12 w-full rounded-2xl border border-line bg-card px-4 text-[15px] text-fg placeholder:text-faint outline-none transition focus:border-cyan focus:ring-3 focus:ring-cyan/20';

interface Form {
  name: string; location_id: string; ghl_token: string; timezone: string; currency: string;
  invoice_live_mode: boolean; invoice_sender_name: string; notify_webhook_url: string;
}
const EMPTY: Form = { name: '', location_id: '', ghl_token: '', timezone: '', currency: 'USD', invoice_live_mode: true, invoice_sender_name: '', notify_webhook_url: '' };

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-muted">{hint}</span>}
    </label>
  );
}

export default function SubaccountsPage() {
  const sa = useSubaccounts();
  const [editing, setEditing] = useState<SubaccountPublic | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [hookFor, setHookFor] = useState<string | null>(null);
  const [copied, setCopied] = useState('');
  const hookUrl = (key: string) => (typeof window !== 'undefined' ? window.location.origin : '') + '/api/webhooks/ghl/' + key;
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(''), 2000); } catch { /* clipboard blocked */ }
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  function openNew() { setForm(EMPTY); setEditing('new'); setError(''); setNotice(''); }
  function openEdit(s: SubaccountPublic) {
    setForm({
      name: s.name, location_id: s.location_id, ghl_token: '', timezone: s.timezone, currency: s.currency,
      invoice_live_mode: s.invoice_live_mode, invoice_sender_name: s.invoice_sender_name || '', notify_webhook_url: s.notify_webhook_url || ''
    });
    setEditing(s); setError(''); setNotice('');
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const isNew = editing === 'new';
    try {
      const r = await fetch(isNew ? '/api/subaccounts' : '/api/subaccounts/' + (editing as SubaccountPublic).id, {
        method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form)
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save');
      setNotice(`"${d.item.name}" ${isNew ? 'added' : 'updated'}. The token was verified with GHL.`);
      setEditing(null);
      if (isNew) sa.setSelected(d.item.id);
      await sa.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: SubaccountPublic) {
    if (!confirm(`Remove "${s.name}"? Its history is kept, but Nova can no longer work in it.`)) return;
    const r = await fetch('/api/subaccounts/' + s.id, { method: 'DELETE' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error || 'Could not remove');
    setNotice(`"${s.name}" removed.`);
    await sa.reload();
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">Sub-accounts</h1>
          <p className="mt-1 text-[15px] text-muted">The GHL sub-accounts Nova can work in.</p>
        </div>
        {sa.canManage && !editing && (
          <button onClick={openNew} className="inline-flex h-12 items-center gap-2 rounded-full bg-cyan px-5 font-semibold text-cyan-ink hover:bg-[#7ddcf7]">
            <IconPlus size={18} /> Add sub-account
          </button>
        )}
      </div>

      {notice && <p className="mt-5 flex items-center gap-2 rounded-2xl bg-cyan/10 px-4 py-3 text-sm text-cyan"><IconCheck size={18} />{notice}</p>}
      {error && !editing && <p className="mt-5 rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>}

      {editing && (
        <form onSubmit={save} className="mt-6 grid gap-6 rounded-[28px] border border-line bg-panel p-5 sm:p-7 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            <h2 className="text-xl font-semibold">{editing === 'new' ? 'Add a sub-account' : 'Edit ' + editing.name}</h2>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Location ID *" hint="GHL › Settings › Business Profile, or the ID in the URL after /location/.">
                <input className={input} value={form.location_id} onChange={(e) => set('location_id', e.target.value)} required placeholder="41rKO5avlbp10R9mXruI" autoComplete="off" />
              </Field>
              <Field label="Name" hint="Leave blank to use the name from GHL.">
                <input className={input} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Acme Dental" />
              </Field>
            </div>

            <Field label={editing === 'new' ? 'Private Integration token *' : 'Private Integration token'}
              hint={editing === 'new' ? 'GHL sub-account › Settings › Private Integrations › Create. Stored server-side, never shown again.'
                : `Current token ${editing.token_hint}. Leave blank to keep it.`}>
              <input className={input} type="password" value={form.ghl_token} onChange={(e) => set('ghl_token', e.target.value)}
                required={editing === 'new'} placeholder="pit-xxxxxxxx-xxxx-…" autoComplete="new-password" />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Timezone" hint="IANA name, e.g. Asia/Karachi or America/New_York. Blank = from GHL.">
                <input className={input} value={form.timezone} onChange={(e) => set('timezone', e.target.value)} placeholder="Asia/Karachi" list="tz-list" />
              </Field>
              <Field label="Invoice currency">
                <input className={input} value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} maxLength={3} placeholder="USD" />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Invoice sender" hint="Team member invoices are sent from. Blank = first admin.">
                <input className={input} value={form.invoice_sender_name} onChange={(e) => set('invoice_sender_name', e.target.value)} placeholder="Ali Behraz" />
              </Field>
              <Field label="Invoice mode">
                <button type="button" onClick={() => set('invoice_live_mode', !form.invoice_live_mode)} aria-pressed={form.invoice_live_mode}
                  className="flex h-12 w-full items-center justify-between rounded-2xl border border-line bg-card px-4 text-[15px]">
                  {form.invoice_live_mode ? 'Live (real payments)' : 'Test mode'}
                  <span className={`relative h-6 w-11 rounded-full transition ${form.invoice_live_mode ? 'bg-cyan' : 'bg-card-2'}`}>
                    <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${form.invoice_live_mode ? 'left-[22px]' : 'left-0.5'}`} />
                  </span>
                </button>
              </Field>
            </div>

            <Field label="Team notification webhook URL" hint="Inbound Webhook trigger of a GHL workflow that sends internal notifications. Optional.">
              <input className={input} type="url" value={form.notify_webhook_url} onChange={(e) => set('notify_webhook_url', e.target.value)} placeholder="https://services.leadconnectorhq.com/hooks/…" />
            </Field>

            {error && <p className="rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">{error}</p>}

            <div className="flex gap-3">
              <button disabled={busy} className="h-12 rounded-full bg-cyan px-6 font-semibold text-cyan-ink hover:bg-[#7ddcf7] disabled:cursor-wait disabled:opacity-60">
                {busy ? 'Checking with GHL…' : editing === 'new' ? 'Verify & add' : 'Save changes'}
              </button>
              <button type="button" onClick={() => setEditing(null)} className="h-12 rounded-full bg-card px-6 font-medium hover:bg-card-2">Cancel</button>
            </div>
          </div>

          <aside className="rounded-2xl bg-card p-5 text-sm">
            <h3 className="font-semibold">Token scopes Nova needs</h3>
            <p className="mt-1 text-muted">Tick these when you create the Private Integration:</p>
            <ul className="mt-3 space-y-1.5 font-mono text-[12.5px] text-muted">
              {SCOPES.map((s) => <li key={s} className="flex gap-2"><span className="text-cyan">✓</span>{s}</li>)}
            </ul>
            <p className="mt-4 text-xs text-muted">Voximplant settings are shared by all sub-accounts and live in the app&apos;s environment variables, so nothing else is needed here.</p>
          </aside>

          <datalist id="tz-list">
            {['Asia/Karachi', 'Asia/Dubai', 'Asia/Kolkata', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'Australia/Sydney', 'UTC']
              .map((t) => <option key={t} value={t} />)}
          </datalist>
        </form>
      )}

      <ul className="mt-6 grid gap-3 md:grid-cols-2">
        {sa.loading && [0, 1].map((i) => <li key={i} className="h-28 animate-pulse rounded-[24px] bg-card" />)}
        {sa.items.map((s) => (
          <li key={s.id} className="flex gap-4 rounded-[24px] bg-card p-5">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-cyan/12 text-cyan"><IconBuilding size={22} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h3 className="truncate text-[17px] font-semibold">{s.name}</h3>
                {s.id === sa.selected && <span className="shrink-0 rounded-full bg-cyan/15 px-2.5 py-0.5 text-xs font-medium text-cyan">Active</span>}
              </div>
              <p className="mt-0.5 truncate font-mono text-xs text-muted">{s.location_id}</p>
              <p className="mt-2 text-sm text-muted">{s.timezone} · {s.currency} · {s.invoice_live_mode ? 'Live invoices' : 'Test invoices'}{s.notify_webhook_url ? ' · Notifications on' : ''}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {s.id !== sa.selected && (
                  <button onClick={() => sa.setSelected(s.id)} className="h-9 rounded-full bg-card-2 px-4 text-sm hover:bg-[#383a40]">Use this one</button>
                )}
                <Link href={`/subaccounts/${s.id}/branding`} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card-2 px-4 text-sm hover:bg-[#383a40]"><IconMail size={15} /> Email branding</Link>
                <button onClick={() => setHookFor(hookFor === s.id ? null : s.id)} aria-expanded={hookFor === s.id}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card-2 px-4 text-sm hover:bg-[#383a40]"><IconBell size={15} /> Message alerts</button>
                {sa.canManage && (
                  <>
                    <button onClick={() => openEdit(s)} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card-2 px-4 text-sm hover:bg-[#383a40]"><IconEdit size={15} /> Edit</button>
                    <button onClick={() => remove(s)} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-bad hover:bg-bad/10"><IconTrash size={15} /> Remove</button>
                  </>
                )}
              </div>
              {hookFor === s.id && (
                <div className="mt-4 rounded-2xl bg-ink/60 p-4 text-sm">
                  <p className="font-medium">Get notified when a contact messages</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted">
                    <li>In this GHL sub-account open <b className="text-fg">Automation › Workflows</b> and create a workflow.</li>
                    <li>Trigger: <b className="text-fg">Customer Replied</b> (any channel).</li>
                    <li>Action: <b className="text-fg">Webhook</b>, method POST, URL below. Publish the workflow.</li>
                  </ol>
                  <div className="mt-3 flex gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-xl bg-card px-3 py-2.5 font-mono text-xs text-fg">{hookUrl(s.webhook_key)}</code>
                    <button onClick={() => copy(hookUrl(s.webhook_key))} className="shrink-0 rounded-xl bg-cyan px-3.5 text-xs font-semibold text-cyan-ink">
                      {copied === hookUrl(s.webhook_key) ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-faint">Then turn on push notifications from the bell at the top of the app.</p>
                </div>
              )}
            </div>
          </li>
        ))}
        {!sa.loading && !sa.items.length && !editing && (
          <li className="rounded-[24px] border border-dashed border-line p-8 text-center text-muted md:col-span-2">
            No sub-accounts yet.{sa.canManage ? ' Add one to start talking to Nova.' : ' Ask an admin to add one.'}
          </li>
        )}
      </ul>
    </div>
  );
}
