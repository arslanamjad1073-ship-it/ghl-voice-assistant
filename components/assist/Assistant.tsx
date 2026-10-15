'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageCard, TagsCard, NoteCard, TaskCard, OpportunityCard, AppointmentCard, InvoiceCard, type Initial } from '@/components/assist/cards';
import ContactPicker from '@/components/assist/ContactPicker';
import { Card, Field, primaryBtn, postJson, type Meta, type Contact } from '@/components/assist/ui';
import { IconSend, IconSparkle, IconMic, IconUsers } from '@/components/Icons';

type Action = 'send_email' | 'send_sms' | 'create_invoice' | 'add_tags' | 'remove_tags' | 'opportunity' | 'book_appointment' | 'add_note' | 'add_task' | 'lead_summary' | 'unknown';
interface Entry { id: number; prompt?: string; status: 'loading' | 'ready' | 'error'; action?: Action; reply?: string; initial?: Initial; error?: string }

const QUICK: { action: Action; label: string; example: string }[] = [
  { action: 'send_email', label: 'Send email', example: 'Send an email to peter@example.com' },
  { action: 'send_sms', label: 'Send SMS', example: 'Text Sara that her order is ready' },
  { action: 'create_invoice', label: 'Create invoice', example: 'Invoice Peter for a consultation, 2000 PKR, due the 15th' },
  { action: 'add_tags', label: 'Add tag', example: 'Add tag VIP to John Smith' },
  { action: 'opportunity', label: 'Opportunity', example: 'Move Peter’s deal to Proposal sent' },
  { action: 'book_appointment', label: 'Book appointment', example: 'Book Peter for a demo next Tuesday afternoon' },
  { action: 'add_task', label: 'Add task', example: 'Remind Ali to call Sara tomorrow at 3pm' },
  { action: 'add_note', label: 'Add note', example: 'Note on Mike: wants a quote for 5 seats' },
  { action: 'lead_summary', label: 'Lead summary', example: 'Summarize my chat with Peter John' }
];

const EMPTY: Initial = { contact: null, candidates: [], query: '', fields: {} };

function SummaryCard({ subaccountId, initial, onClose }: { subaccountId: string; initial: Initial; onClose: () => void }) {
  const [contact, setContact] = useState<Contact | null>(initial.contact);
  return (
    <Card icon={<IconUsers size={19} />} title="Lead summary" subtitle="AI summary, suggested follow-up and questions about the conversation." onClose={onClose}>
      <Field label="Contact"><ContactPicker subaccountId={subaccountId} value={contact} onChange={setContact} initialQuery={initial.query} candidates={initial.candidates} /></Field>
      {contact && <Link href={`/leads?sa=${subaccountId}&contact=${encodeURIComponent(contact.id)}`} className={primaryBtn + ' w-fit'}>Open {contact.name}</Link>}
    </Card>
  );
}

export default function Assistant({ subaccountId, subaccountName, senderName, userEmail, voiceEnabled, onDone }: {
  subaccountId: string; subaccountName: string; senderName: string; userEmail: string; voiceEnabled: boolean; onDone: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState('');
  const nextId = useRef(1);
  const box = useRef<HTMLTextAreaElement>(null);

  // Account data for the dropdowns (pipelines, calendars, team, tags)
  useEffect(() => {
    setMeta(null); setEntries([]); setMetaError('');
    if (!subaccountId) return;
    fetch('/api/ghl/meta?subaccount=' + subaccountId).then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setMeta(d); })
      .catch((e) => setMetaError(e.message || 'Could not load this sub-account from GHL'));
  }, [subaccountId]);

  const update = (id: number, patch: Partial<Entry>) => setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const close = (id: number) => setEntries((list) => list.filter((e) => e.id !== id));

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || !subaccountId) return;
    const id = nextId.current++;
    setEntries((list) => [{ id, prompt: text, status: 'loading' }, ...list]);
    setPrompt('');
    const { ok, data } = await postJson<{ action: Action; reply: string; fields: Record<string, unknown>; contacts: Contact[]; contact: Contact | null; contact_query: string; meta: Meta }>(
      '/api/assist/parse', { subaccountId, prompt: text });
    if (!ok) return update(id, { status: 'error', error: data.error || 'Something went wrong' });
    if (data.meta) setMeta(data.meta);
    update(id, {
      status: 'ready', action: data.action, reply: data.reply,
      initial: { contact: data.contact, candidates: data.contacts || [], query: data.contact_query || '', fields: data.fields || {} }
    });
  }

  function quick(action: Action) {
    const id = nextId.current++;
    setEntries((list) => [{ id, status: 'ready', action, initial: EMPTY }, ...list]);
  }

  function renderCard(en: Entry) {
    if (!meta || !en.initial || !en.action) return null;
    const props = { subaccountId, meta, initial: en.initial, onDone, onClose: () => close(en.id), senderName, userEmail };
    switch (en.action) {
      case 'send_email': return <MessageCard kind="email" {...props} />;
      case 'send_sms': return <MessageCard kind="sms" {...props} />;
      case 'add_tags': return <TagsCard remove={false} {...props} />;
      case 'remove_tags': return <TagsCard remove {...props} />;
      case 'add_note': return <NoteCard {...props} />;
      case 'add_task': return <TaskCard {...props} />;
      case 'opportunity': return <OpportunityCard {...props} />;
      case 'book_appointment': return <AppointmentCard {...props} />;
      case 'create_invoice': return <InvoiceCard {...props} />;
      case 'lead_summary': return <SummaryCard subaccountId={subaccountId} initial={en.initial} onClose={() => close(en.id)} />;
      default: return null;
    }
  }

  return (
    <section aria-label="Ask Nova" className="min-w-0">
      <form onSubmit={submit} className="rounded-[28px] border border-line bg-panel p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><IconSparkle size={18} className="text-cyan" /> What do you want to do?</h2>
          {voiceEnabled && (
            <Link href="/talk" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-card px-3.5 text-sm text-muted hover:bg-card-2 hover:text-fg"><IconMic size={15} /> Talk instead</Link>
          )}
        </div>
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-card p-2 focus-within:border-cyan focus-within:ring-3 focus-within:ring-cyan/20">
          <textarea ref={box} value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            placeholder={`e.g. “Send an email to peter@example.com thanking him for the call” · ${subaccountName}`}
            className="max-h-48 min-h-12 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-fg placeholder:text-faint outline-none" aria-label="Your request" />
          <button disabled={!prompt.trim() || !subaccountId} aria-label="Send" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-cyan text-cyan-ink hover:bg-[#7ddcf7] disabled:opacity-40">
            <IconSend size={19} />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <button type="button" key={q.action} onClick={() => quick(q.action)} title={q.example} disabled={!meta}
              className="rounded-full bg-card px-3.5 py-1.5 text-sm text-muted transition hover:bg-card-2 hover:text-fg disabled:opacity-50">{q.label}</button>
          ))}
        </div>
        {metaError && <p className="mt-3 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{metaError}</p>}
      </form>

      <div className="mt-4 space-y-4">
        {entries.map((en) => (
          <div key={en.id} className="space-y-3">
            {en.prompt && <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-cyan px-4 py-2.5 text-[15px] text-cyan-ink">{en.prompt}</p>}
            {en.status === 'loading' && (
              <div className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 text-sm text-muted">
                <span className="size-4 animate-spin rounded-full border-2 border-line border-t-cyan" /> Working out what to do…
              </div>
            )}
            {en.status === 'error' && <p className="rounded-2xl bg-bad/10 px-4 py-3 text-sm text-bad">{en.error}</p>}
            {en.status === 'ready' && en.reply && <p className="w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-card px-4 py-2.5 text-[15px]">{en.reply}</p>}
            {en.status === 'ready' && en.action === 'unknown' && !en.reply && (
              <p className="w-fit rounded-2xl bg-card px-4 py-2.5 text-[15px] text-muted">I can send emails and SMS, create invoices, manage tags and opportunities, book appointments, and add notes and tasks. Try one of the buttons above.</p>
            )}
            {en.status === 'ready' && renderCard(en)}
          </div>
        ))}
      </div>
    </section>
  );
}
