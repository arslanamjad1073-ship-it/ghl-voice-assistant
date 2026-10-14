import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getContact, type Contact } from '@/lib/ghl';
import {
  getSubaccountFull, getMeta, logActivity, createContact, setTags, addNote, addTask, saveOpportunity,
  bookAppointment, createInvoice, prettyWhen, type InvoiceInput
} from '@/lib/ghlActions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const str = (v: unknown, max = 5000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// POST { subaccountId, action, contactId?, data } -> runs one CRM action through the GHL API and logs it to History
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const b = await req.json().catch(() => ({}));
  const sa = await getSubaccountFull(str(b.subaccountId, 100));
  if (!sa) return NextResponse.json({ error: 'Choose a sub-account first' }, { status: 400 });
  const d = (b.data && typeof b.data === 'object' ? b.data : {}) as Record<string, unknown>;
  const action = str(b.action, 40);

  // Creating a contact needs no existing contact
  if (action === 'create_contact') {
    const email = str(d.email, 200), phone = str(d.phone, 40);
    if (!email && !phone) return NextResponse.json({ error: 'Enter an email or phone number' }, { status: 400 });
    try {
      const [firstName, ...rest] = str(d.name, 120).split(/\s+/);
      const c = await createContact(sa, { email, phone, firstName, lastName: rest.join(' ') });
      await logActivity(sa, auth.user, { action: 'create_contact', ok: true, message: `Contact "${c.name}" created`, contact: c });
      return NextResponse.json({ ok: true, contact: c });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  const contactId = str(b.contactId, 100);
  if (!contactId) return NextResponse.json({ error: 'Choose a contact' }, { status: 400 });
  let contact: Contact | null = null;
  try { contact = await getContact(sa, contactId); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
  const who = contact.name;

  const run = async (label: string, fn: () => Promise<{ message: string; result?: object }>) => {
    try {
      const r = await fn();
      await logActivity(sa, auth.user, { action, ok: true, message: r.message, contact, details: { data: d } });
      return NextResponse.json({ ok: true, message: r.message, ...(r.result || {}) });
    } catch (e) {
      const msg = (e as Error).message;
      await logActivity(sa, auth.user, { action, ok: false, message: `${label} for "${who}" failed: ${msg}`, contact, details: { data: d } });
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  };

  switch (action) {
    case 'add_tags':
    case 'remove_tags': {
      const tags = (Array.isArray(d.tags) ? d.tags : []).map((t) => str(t, 80)).filter(Boolean);
      if (!tags.length) return NextResponse.json({ error: 'Add at least one tag' }, { status: 400 });
      const remove = action === 'remove_tags';
      const list = tags.map((t) => `"${t}"`).join(', ');
      return run(remove ? 'Removing tags' : 'Adding tags', async () => {
        await setTags(sa, contactId, tags, remove);
        return { message: `Tag${tags.length > 1 ? 's' : ''} ${list} ${remove ? 'removed from' : 'added to'} contact "${who}"` };
      });
    }
    case 'add_note': {
      const body = str(d.body);
      if (!body) return NextResponse.json({ error: 'The note is empty' }, { status: 400 });
      return run('Adding note', async () => { await addNote(sa, contactId, body); return { message: `Note added to contact "${who}"` }; });
    }
    case 'add_task': {
      const title = str(d.title, 200), dueDate = str(d.dueDate, 10);
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return NextResponse.json({ error: 'A title and due date are required' }, { status: 400 });
      const assignee = str(d.assigneeName, 120);
      return run('Adding task', async () => {
        await addTask(sa, contactId, { title, body: str(d.details), dueDate, dueTime: str(d.dueTime, 5) || '10:00', assignedTo: str(d.assignedTo, 100) || undefined });
        return { message: `Task "${title}" added for "${who}", due ${prettyWhen(dueDate, str(d.dueTime, 5) || '10:00')}${assignee ? `, assigned to "${assignee}"` : ''}` };
      });
    }
    case 'opportunity': {
      const pipelineId = str(d.pipelineId, 100);
      if (!pipelineId) return NextResponse.json({ error: 'Choose a pipeline' }, { status: 400 });
      const status = ['open', 'won', 'lost', 'abandoned'].includes(str(d.status)) ? str(d.status) : 'open';
      const value = d.value === '' || d.value === null || d.value === undefined ? null : Number(d.value);
      const isNew = !str(d.opportunityId, 100);
      return run(isNew ? 'Creating opportunity' : 'Updating opportunity', async () => {
        await saveOpportunity(sa, contactId, { opportunityId: str(d.opportunityId, 100) || undefined, name: str(d.name, 200), pipelineId, stageId: str(d.stageId, 100) || undefined, status, value });
        const where = [str(d.pipelineName, 100), str(d.stageName, 100)].filter(Boolean).join(' › ');
        const val = value !== null && !isNaN(value) ? `, value ${sa.currency} ${value.toLocaleString('en-US')}` : '';
        return {
          message: isNew
            ? `Opportunity "${str(d.name, 200) || 'New opportunity'}" created for "${who}" in ${where}${val}`
            : `Opportunity "${str(d.name, 200)}" for "${who}" updated: ${where}, ${status}${val}`
        };
      });
    }
    case 'book_appointment': {
      const calendarId = str(d.calendarId, 100), date = str(d.date, 10), time = str(d.time, 5);
      if (!calendarId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: 'Pick a calendar and a time slot' }, { status: 400 });
      return run('Booking appointment', async () => {
        await bookAppointment(sa, contactId, { calendarId, date, time, title: str(d.title, 200) || `${who} - ${str(d.calendarName, 100)}`, notes: str(d.notes), slotMinutes: Number(d.slotMinutes) || 30 });
        return { message: `Appointment booked for "${who}" on ${prettyWhen(date, time)}${str(d.calendarName, 100) ? ` (${str(d.calendarName, 100)})` : ''}` };
      });
    }
    case 'create_invoice': {
      const items = (Array.isArray(d.items) ? d.items : []).map((i: Record<string, unknown>) => ({
        name: str(i?.name, 200), description: str(i?.description, 500), quantity: Number(i?.quantity) || 1, unitPrice: Number(i?.unitPrice)
      })).filter((i) => i.name && !isNaN(i.unitPrice));
      const inv: InvoiceInput = {
        items, currency: str(d.currency, 3) || sa.currency, dueDate: str(d.dueDate, 10), title: str(d.title, 200), notes: str(d.notes, 2000),
        sendVia: (['email', 'sms', 'both', 'none'].includes(str(d.sendVia)) ? str(d.sendVia) : 'none') as InvoiceInput['sendVia'], liveMode: sa.invoice_live_mode
      };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(inv.dueDate)) return NextResponse.json({ error: 'Choose a due date' }, { status: 400 });
      return run('Creating invoice', async () => {
        const r = await createInvoice(sa, contactId, inv, await getMeta(sa));
        const via = inv.sendVia === 'both' ? 'email and SMS' : inv.sendVia;
        const message = r.sent
          ? `Invoice ${r.number ? '#' + r.number + ' ' : ''}for ${r.total} sent to "${who}" by ${via}`
          : `Invoice ${r.number ? '#' + r.number + ' ' : ''}for ${r.total} saved as a draft for "${who}"` + (r.sendError ? ` (sending failed: ${r.sendError})` : '');
        return { message, result: { invoice: r } };
      });
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}
