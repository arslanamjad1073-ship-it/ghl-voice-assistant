'use client';
import { useEffect, useMemo, useState } from 'react';
import ContactPicker from '@/components/assist/ContactPicker';
import AiWrite from '@/components/assist/AiWrite';
import WeekCalendar, { clock } from '@/components/assist/WeekCalendar';
import { Card, Field, Result, input, textarea, primaryBtn, ghostBtn, postJson, ACTION, matchName, type Meta, type Contact } from '@/components/assist/ui';
import { IconMail, IconChat, IconTag, IconNote, IconTask, IconBriefcase, IconCalendar, IconReceipt, IconSend, IconPlus, IconTrash, IconAlert } from '@/components/Icons';
import { renderEmail } from '@/lib/emailTemplate';

export interface Initial { contact: Contact | null; candidates: Contact[]; query: string; fields: Record<string, unknown> }
interface Props { subaccountId: string; meta: Meta; initial: Initial; onDone: () => void; onClose: () => void; senderName: string }

const s = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
type Res = { ok: boolean; text: string } | null;

function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// ---------------- Email / SMS ----------------
export function MessageCard({ kind, subaccountId, initial, onDone, onClose, senderName }: Props & { kind: 'email' | 'sms' }) {
  const isEmail = kind === 'email';
  const [contact, setContact] = useState<Contact | null>(initial.contact);
  const [subject, setSubject] = useState(s(initial.fields.subject));
  const [body, setBody] = useState(s(initial.fields.body));
  const [ai, setAi] = useState(!!initial.fields.ai_written);
  const [preview, setPreview] = useState(false);
  const [branding, setBranding] = useState<unknown>(null);
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Res>(null);

  useEffect(() => {
    if (!isEmail || !preview || branding) return;
    fetch('/api/subaccounts/' + subaccountId + '/branding').then((r) => r.json()).then((d) => setBranding(d.branding || {})).catch(() => setBranding({}));
  }, [isEmail, preview, branding, subaccountId]);

  const html = useMemo(() => (isEmail && preview ? renderEmail({ ...(branding as object || {}) }, { subject, body, senderName, firstName: contact?.name.split(/\s+/)[0] }) : ''),
    [isEmail, preview, branding, subject, body, senderName, contact]);

  async function send(confirm = false) {
    if (!contact) return;
    setBusy(true); setResult(null); setWarning('');
    const { ok, status, data } = await postJson<{ warning?: string }>('/api/leads/send', {
      subaccountId, contactId: contact.id, channel: kind, subject: isEmail ? subject : undefined, body, aiSuggested: ai, edited: true, confirm
    });
    setBusy(false);
    if (status === 409 && data.warning) return setWarning(data.warning);
    if (!ok) return setResult({ ok: false, text: data.error || 'Could not send' });
    setResult({ ok: true, text: `${isEmail ? 'Email' : 'SMS'} sent to ${contact.name}.` });
    onDone();
  }

  const missing = contact && !(isEmail ? contact.email : contact.phone);
  return (
    <Card icon={isEmail ? <IconMail size={19} /> : <IconChat size={19} />} title={isEmail ? 'Send an email' : 'Send an SMS'} onClose={onClose}
      subtitle={isEmail ? 'Sent through GHL with this sub-account’s email branding.' : 'Sent through GHL from this sub-account’s number.'}>
      <Field label="To"><ContactPicker subaccountId={subaccountId} value={contact} onChange={setContact} initialQuery={initial.query} candidates={initial.candidates} need={isEmail ? 'email' : 'phone'} /></Field>
      <AiWrite subaccountId={subaccountId} kind={kind} contactId={contact?.id} onResult={(r) => { if (isEmail && r.subject) setSubject(r.subject); setBody(r.body); setAi(true); }} />
      {isEmail && <Field label="Subject"><input value={subject} onChange={(e) => setSubject(e.target.value)} className={input} placeholder="Subject" /></Field>}
      <Field label="Message" hint={isEmail ? 'Your signature and branding are added automatically.' : `${body.length} characters · ${Math.max(1, Math.ceil(body.length / 160))} SMS segment(s)`}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={isEmail ? 8 : 4} className={textarea} placeholder="Write your message…" />
      </Field>
      {isEmail && <button type="button" onClick={() => setPreview((p) => !p)} className="text-sm text-cyan hover:underline">{preview ? 'Hide preview' : 'Preview email'}</button>}
      {html && <iframe title="Email preview" srcDoc={html} sandbox="" className="h-[440px] w-full rounded-2xl border border-line bg-white" />}
      {warning && (
        <div className="rounded-2xl border border-[#f5b041]/40 bg-[#f5b041]/10 p-4">
          <p className="flex gap-2 text-sm text-[#f8c471]"><IconAlert size={18} className="shrink-0" /> {warning}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => send(true)} disabled={busy} className="h-10 rounded-full bg-[#f5b041] px-5 text-sm font-semibold text-[#2b1d05]">Send anyway</button>
            <button onClick={() => setWarning('')} className="h-10 rounded-full bg-card px-5 text-sm">Cancel</button>
          </div>
        </div>
      )}
      <Result result={result} />
      {!warning && !result?.ok && (
        <button onClick={() => send()} disabled={busy || !contact || !!missing || !body.trim() || (isEmail && !subject.trim())} className={primaryBtn}>
          <IconSend size={17} /> {busy ? 'Sending…' : isEmail ? 'Send email' : 'Send SMS'}
        </button>
      )}
    </Card>
  );
}

// ---------------- Tags ----------------
export function TagsCard({ subaccountId, meta, initial, onDone, onClose, remove: initialRemove }: Props & { remove: boolean }) {
  const [contact, setContact] = useState<Contact | null>(initial.contact);
  const [remove, setRemove] = useState(initialRemove);
  const [tags, setTags] = useState<string[]>(Array.isArray(initial.fields.tags) ? (initial.fields.tags as string[]).map(String) : []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Res>(null);
  const add = (t: string) => { const v = t.trim(); if (v && !tags.some((x) => x.toLowerCase() === v.toLowerCase())) setTags([...tags, v]); setText(''); };

  async function apply() {
    if (!contact) return;
    setBusy(true); setResult(null);
    const { ok, data } = await ACTION(subaccountId, remove ? 'remove_tags' : 'add_tags', contact.id, { tags });
    setBusy(false);
    setResult(ok ? { ok: true, text: data.message || 'Done' } : { ok: false, text: data.error || 'Failed' });
    if (ok) onDone();
  }
  return (
    <Card icon={<IconTag size={19} />} title={remove ? 'Remove tags' : 'Add tags'} onClose={onClose}>
      <Field label="Contact"><ContactPicker subaccountId={subaccountId} value={contact} onChange={setContact} initialQuery={initial.query} candidates={initial.candidates} /></Field>
      <div className="flex gap-1 rounded-xl bg-card p-1 sm:w-fit">
        {[false, true].map((r) => (
          <button key={String(r)} type="button" onClick={() => setRemove(r)} className={`h-9 flex-1 rounded-lg px-4 text-sm ${remove === r ? 'bg-cyan text-cyan-ink' : 'text-muted'}`}>{r ? 'Remove' : 'Add'}</button>
        ))}
      </div>
      {remove && contact && contact.tags.length > 0 && (
        <Field label="Contact’s current tags (tap to select)">
          <div className="flex flex-wrap gap-1.5">
            {contact.tags.map((t) => (
              <button type="button" key={t} onClick={() => add(t)} className="rounded-full bg-card-2 px-3 py-1 text-sm hover:bg-[#383a40]">{t}</button>
            ))}
          </div>
        </Field>
      )}
      <Field label="Tags" hint={meta.tags.length ? 'Pick an existing tag or type a new one, then press Enter.' : 'Type a tag and press Enter.'}>
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-line bg-card p-2">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-full bg-cyan/15 px-3 py-1 text-sm text-cyan">
              {t}<button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={'Remove ' + t} className="ml-0.5 opacity-70 hover:opacity-100">×</button>
            </span>
          ))}
          <input value={text} onChange={(e) => setText(e.target.value)} list="assist-tags" placeholder={tags.length ? '' : 'e.g. VIP'}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); } }} onBlur={() => text && add(text)}
            className="min-w-32 flex-1 bg-transparent px-1 text-[14.5px] outline-none" />
          <datalist id="assist-tags">{meta.tags.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
      </Field>
      <Result result={result} />
      {!result?.ok && <button onClick={apply} disabled={busy || !contact || !tags.length} className={primaryBtn}>{busy ? 'Saving…' : remove ? 'Remove tags' : 'Add tags'}</button>}
    </Card>
  );
}

// ---------------- Note ----------------
export function NoteCard({ subaccountId, initial, onDone, onClose }: Props) {
  const [contact, setContact] = useState<Contact | null>(initial.contact);
  const [body, setBody] = useState(s(initial.fields.body));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Res>(null);
  async function save() {
    if (!contact) return;
    setBusy(true);
    const { ok, data } = await ACTION(subaccountId, 'add_note', contact.id, { body });
    setBusy(false);
    setResult(ok ? { ok: true, text: data.message || 'Saved' } : { ok: false, text: data.error || 'Failed' });
    if (ok) onDone();
  }
  return (
    <Card icon={<IconNote size={19} />} title="Add a note" onClose={onClose}>
      <Field label="Contact"><ContactPicker subaccountId={subaccountId} value={contact} onChange={setContact} initialQuery={initial.query} candidates={initial.candidates} /></Field>
      <AiWrite subaccountId={subaccountId} kind="note" contactId={contact?.id} onResult={(r) => setBody(r.body)} />
      <Field label="Note"><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className={textarea} /></Field>
      <Result result={result} />
      {!result?.ok && <button onClick={save} disabled={busy || !contact || !body.trim()} className={primaryBtn}>{busy ? 'Saving…' : 'Save note'}</button>}
    </Card>
  );
}

// ---------------- Task ----------------
export function TaskCard({ subaccountId, meta, initial, onDone, onClose }: Props) {
  const f = initial.fields;
  const [contact, setContact] = useState<Contact | null>(initial.contact);
  const [title, setTitle] = useState(s(f.title));
  const [details, setDetails] = useState(s(f.details));
  const [dueDate, setDueDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(s(f.due_date)) ? s(f.due_date) : addDays(meta.today, 1));
  const [dueTime, setDueTime] = useState(/^\d{2}:\d{2}$/.test(s(f.due_time)) ? s(f.due_time) : '10:00');
  const [assignee, setAssignee] = useState(matchName(meta.users, f.assignee)?.id || '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Res>(null);
  async function save() {
    if (!contact) return;
    setBusy(true);
    const { ok, data } = await ACTION(subaccountId, 'add_task', contact.id, {
      title, details, dueDate, dueTime, assignedTo: assignee, assigneeName: meta.users.find((u) => u.id === assignee)?.name || ''
    });
    setBusy(false);
    setResult(ok ? { ok: true, text: data.message || 'Saved' } : { ok: false, text: data.error || 'Failed' });
    if (ok) onDone();
  }
  return (
    <Card icon={<IconTask size={19} />} title="Add a task" onClose={onClose}>
      <Field label="Contact"><ContactPicker subaccountId={subaccountId} value={contact} onChange={setContact} initialQuery={initial.query} candidates={initial.candidates} /></Field>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="Call back about the quote" /></Field>
      <Field label="Details (optional)"><textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={2} className={textarea} /></Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Due date"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input + ' [color-scheme:dark]'} /></Field>
        <Field label="Time"><input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={input + ' [color-scheme:dark]'} /></Field>
        <Field label="Assign to">
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={input}>
            <option value="">Unassigned</option>
            {meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
      </div>
      <Result result={result} />
      {!result?.ok && <button onClick={save} disabled={busy || !contact || !title.trim()} className={primaryBtn}>{busy ? 'Saving…' : 'Add task'}</button>}
    </Card>
  );
}

// ---------------- Opportunity ----------------
interface Opp { id: string; name: string; pipelineId: string; stageId: string; status: string; value: number | null }
export function OpportunityCard({ subaccountId, meta, initial, onDone, onClose }: Props) {
  const f = initial.fields;
  const parsedStage = s(f.stage);
  const initialPipeline = matchName(meta.pipelines, f.pipeline)
    || (parsedStage ? meta.pipelines.find((p) => matchName(p.stages, parsedStage)) : undefined)
    || (meta.pipelines.length === 1 ? meta.pipelines[0] : undefined);
  const [contact, setContact] = useState<Contact | null>(initial.contact);
  const [opps, setOpps] = useState<Opp[] | null>(null);
  const [oppId, setOppId] = useState('');
  const [name, setName] = useState(s(f.name));
  const [pipelineId, setPipelineId] = useState(initialPipeline?.id || '');
  const [stageId, setStageId] = useState(initialPipeline ? matchName(initialPipeline.stages, parsedStage)?.id || initialPipeline.stages[0]?.id || '' : '');
  const [status, setStatus] = useState(['open', 'won', 'lost', 'abandoned'].includes(s(f.status)) ? s(f.status) : 'open');
  const [value, setValue] = useState(f.value === undefined || f.value === null ? '' : s(f.value));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Res>(null);
  const pipeline = meta.pipelines.find((p) => p.id === pipelineId);

  // Load the contact's deals; an update request picks their existing deal
  useEffect(() => {
    if (!contact) { setOpps(null); return; }
    fetch('/api/ghl/opportunities?' + new URLSearchParams({ subaccount: subaccountId, contact: contact.id })).then((r) => r.json()).then((d) => {
      const list: Opp[] = d.items || [];
      setOpps(list);
      const wantsUpdate = !!(parsedStage || f.status || f.value) && !f.name;
      const pick = list.length && wantsUpdate ? (list.find((o) => o.pipelineId === initialPipeline?.id) || list[0]) : null;
      if (pick) choose(pick.id, list);
      else if (!name) setName(contact.name + ' - Opportunity');
    }).catch(() => setOpps([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id]);

  function choose(id: string, list = opps || []) {
    setOppId(id);
    const o = list.find((x) => x.id === id);
    if (!o) { setName(contact ? contact.name + ' - Opportunity' : ''); return; }
    setName(o.name);
    const pl = meta.pipelines.find((p) => p.id === o.pipelineId);
    if (!initialPipeline || initialPipeline.id === o.pipelineId) {
      setPipelineId(o.pipelineId);
      setStageId((pl && matchName(pl.stages, parsedStage)?.id) || o.stageId);
    }
    if (!f.status) setStatus(o.status || 'open');
    if (f.value === undefined || f.value === null) setValue(o.value === null ? '' : String(o.value));
  }

  async function save() {
    if (!contact) return;
    setBusy(true);
    const { ok, data } = await ACTION(subaccountId, 'opportunity', contact.id, {
      opportunityId: oppId, name, pipelineId, stageId, status, value,
      pipelineName: pipeline?.name, stageName: pipeline?.stages.find((x) => x.id === stageId)?.name
    });
    setBusy(false);
    setResult(ok ? { ok: true, text: data.message || 'Saved' } : { ok: false, text: data.error || 'Failed' });
    if (ok) onDone();
  }
  return (
    <Card icon={<IconBriefcase size={19} />} title={oppId ? 'Update opportunity' : 'Create opportunity'} onClose={onClose}>
      <Field label="Contact"><ContactPicker subaccountId={subaccountId} value={contact} onChange={setContact} initialQuery={initial.query} candidates={initial.candidates} /></Field>
      {contact && opps && opps.length > 0 && (
        <Field label="Opportunity">
          <select value={oppId} onChange={(e) => choose(e.target.value)} className={input}>
            <option value="">+ New opportunity</option>
            {opps.map((o) => <option key={o.id} value={o.id}>{o.name} ({meta.pipelines.find((p) => p.id === o.pipelineId)?.name || 'pipeline'}, {o.status})</option>)}
          </select>
        </Field>
      )}
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={input} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pipeline">
          <select value={pipelineId} onChange={(e) => { setPipelineId(e.target.value); setStageId(meta.pipelines.find((p) => p.id === e.target.value)?.stages[0]?.id || ''); }} className={input}>
            <option value="" disabled>Choose a pipeline</option>
            {meta.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Stage">
          <select value={stageId} onChange={(e) => setStageId(e.target.value)} className={input} disabled={!pipeline}>
            {(pipeline?.stages || []).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
            {['open', 'won', 'lost', 'abandoned'].map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
          </select>
        </Field>
        <Field label={`Value (${meta.currency})`}><input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} className={input} placeholder="0" /></Field>
      </div>
      {!meta.pipelines.length && <p className="text-sm text-bad">This sub-account has no pipelines in GHL.</p>}
      <Result result={result} />
      {!result?.ok && <button onClick={save} disabled={busy || !contact || !pipelineId} className={primaryBtn}>{busy ? 'Saving…' : oppId ? 'Update opportunity' : 'Create opportunity'}</button>}
    </Card>
  );
}

// ---------------- Appointment ----------------
export function AppointmentCard({ subaccountId, meta, initial, onDone, onClose }: Props) {
  const f = initial.fields;
  const [contact, setContact] = useState<Contact | null>(initial.contact);
  const [calendarId, setCalendarId] = useState((matchName(meta.calendars, f.calendar) || (meta.calendars.length === 1 ? meta.calendars[0] : undefined))?.id || '');
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(s(f.date)) ? s(f.date) : meta.today;
  const [slot, setSlot] = useState<{ date: string; time: string } | null>(/^\d{2}:\d{2}$/.test(s(f.time)) && f.date ? { date: parsedDate, time: s(f.time) } : null);
  const [title, setTitle] = useState(s(f.title));
  const [notes, setNotes] = useState(s(f.notes));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Res>(null);
  const cal = meta.calendars.find((c) => c.id === calendarId);

  async function book() {
    if (!contact || !slot || !cal) return;
    setBusy(true);
    const { ok, data } = await ACTION(subaccountId, 'book_appointment', contact.id, {
      calendarId, calendarName: cal.name, date: slot.date, time: slot.time, title, notes, slotMinutes: cal.slotMinutes
    });
    setBusy(false);
    setResult(ok ? { ok: true, text: data.message || 'Booked' } : { ok: false, text: data.error || 'Failed' });
    if (ok) onDone();
  }
  return (
    <Card icon={<IconCalendar size={19} />} title="Book an appointment" onClose={onClose}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact"><ContactPicker subaccountId={subaccountId} value={contact} onChange={setContact} initialQuery={initial.query} candidates={initial.candidates} /></Field>
        <Field label="Calendar">
          <select value={calendarId} onChange={(e) => { setCalendarId(e.target.value); setSlot(null); }} className={input}>
            <option value="" disabled>Choose a calendar</option>
            {meta.calendars.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.slotMinutes} min</option>)}
          </select>
        </Field>
      </div>
      {!meta.calendars.length && <p className="text-sm text-bad">This sub-account has no calendars in GHL.</p>}
      {cal && (
        <WeekCalendar subaccountId={subaccountId} calendarId={cal.id} slotMinutes={cal.slotMinutes} today={meta.today} initialStart={parsedDate} value={slot} onChange={setSlot} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title (optional)"><input value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder={contact && cal ? `${contact.name} - ${cal.name}` : ''} /></Field>
        <Field label="Notes (optional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} className={input} /></Field>
      </div>
      <Result result={result} />
      {!result?.ok && (
        <button onClick={book} disabled={busy || !contact || !slot || !cal} className={primaryBtn}>
          {busy ? 'Booking…' : slot ? `Book ${new Date(slot.date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} at ${clock(slot.time)}` : 'Pick a time slot'}
        </button>
      )}
    </Card>
  );
}

// ---------------- Invoice ----------------
interface Line { name: string; quantity: string; unitPrice: string }
export function InvoiceCard({ subaccountId, meta, initial, onDone, onClose }: Props) {
  const f = initial.fields;
  const parsedItems = Array.isArray(f.items) ? (f.items as Record<string, unknown>[]) : [];
  const [contact, setContact] = useState<Contact | null>(initial.contact);
  const [items, setItems] = useState<Line[]>(parsedItems.length
    ? parsedItems.map((i) => ({ name: s(i.name), quantity: s(i.quantity) || '1', unitPrice: s(i.unit_price) }))
    : [{ name: '', quantity: '1', unitPrice: '' }]);
  const [currency, setCurrency] = useState(/^[A-Za-z]{3}$/.test(s(f.currency)) ? s(f.currency).toUpperCase() : meta.currency);
  const [dueDate, setDueDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(s(f.due_date)) ? s(f.due_date) : addDays(meta.today, 7));
  const [sendVia, setSendVia] = useState(['email', 'sms', 'both', 'none'].includes(s(f.send_via)) ? s(f.send_via) : 'email');
  const [notes, setNotes] = useState(s(f.notes));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Res>(null);
  const total = items.reduce((t, i) => t + (Number(i.unitPrice) || 0) * (Number(i.quantity) || 0), 0);
  const set = (idx: number, k: keyof Line, v: string) => setItems(items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));
  const valid = items.some((i) => i.name.trim() && i.unitPrice !== '' && !isNaN(Number(i.unitPrice)));

  async function create() {
    if (!contact) return;
    setBusy(true);
    const { ok, data } = await ACTION(subaccountId, 'create_invoice', contact.id, {
      items: items.filter((i) => i.name.trim()).map((i) => ({ name: i.name, quantity: Number(i.quantity) || 1, unitPrice: Number(i.unitPrice) })),
      currency, dueDate, sendVia, notes
    });
    setBusy(false);
    setResult(ok ? { ok: true, text: data.message || 'Created' } : { ok: false, text: data.error || 'Failed' });
    if (ok) onDone();
  }
  return (
    <Card icon={<IconReceipt size={19} />} title="Create an invoice" onClose={onClose}
      subtitle={meta.invoiceLiveMode ? 'Live mode: the contact can pay it for real.' : 'Test mode: no real payments.'}>
      <Field label="Bill to"><ContactPicker subaccountId={subaccountId} value={contact} onChange={setContact} initialQuery={initial.query} candidates={initial.candidates} /></Field>
      <div>
        <div className="mb-1.5 hidden grid-cols-[1fr_80px_120px_36px] gap-2 text-sm font-medium sm:grid"><span>Item</span><span>Qty</span><span>Unit price</span><span /></div>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_52px_84px_36px] gap-1.5 sm:grid-cols-[1fr_80px_120px_36px] sm:gap-2">
              <input value={it.name} onChange={(e) => set(i, 'name', e.target.value)} placeholder="Consultation" className={input} aria-label="Item name" />
              <input type="number" min="1" value={it.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} className={input} aria-label="Quantity" />
              <input type="number" min="0" step="0.01" value={it.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} placeholder="0.00" className={input} aria-label="Unit price" />
              <button type="button" onClick={() => setItems(items.length > 1 ? items.filter((_, x) => x !== i) : items)} aria-label="Remove item"
                className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-card hover:text-bad"><IconTrash size={16} /></button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setItems([...items, { name: '', quantity: '1', unitPrice: '' }])} className={ghostBtn + ' mt-2'}><IconPlus size={15} /> Add item</button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Currency"><input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} className={input} /></Field>
        <Field label="Due date"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input + ' [color-scheme:dark]'} /></Field>
        <Field label="Send via">
          <select value={sendVia} onChange={(e) => setSendVia(e.target.value)} className={input}>
            <option value="email">Email</option><option value="sms">SMS</option><option value="both">Email + SMS</option><option value="none">Don’t send (draft)</option>
          </select>
        </Field>
      </div>
      <Field label="Note for the customer (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={textarea} /></Field>
      <p className="text-right text-lg font-semibold">Total {currency} {total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</p>
      <Result result={result} />
      {!result?.ok && (
        <button onClick={create} disabled={busy || !contact || !valid} className={primaryBtn}>
          {busy ? 'Creating…' : sendVia === 'none' ? 'Create draft invoice' : 'Create & send invoice'}
        </button>
      )}
    </Card>
  );
}
