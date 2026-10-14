import 'server-only';
import type { User } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ghl, getContact, toContact, type SubaccountSecret, type Contact } from '@/lib/ghl';
import { displayName } from '@/lib/auth';

const CAL_V = '2021-04-15';

export interface SubaccountFull extends SubaccountSecret {
  currency: string; invoice_live_mode: boolean; invoice_sender_name: string | null; voice_enabled: boolean;
}

export async function getSubaccountFull(id: string): Promise<SubaccountFull | null> {
  const { data } = await supabaseAdmin().from('subaccounts')
    .select('id,name,location_id,ghl_token,timezone,currency,invoice_live_mode,invoice_sender_name,voice_enabled').eq('id', id).maybeSingle();
  return data as SubaccountFull | null;
}

// ---------- time (sub-account timezone) ----------
function offsetMinutes(tz: string, at: Date) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(at)
    .find((x) => x.type === 'timeZoneName')?.value || 'GMT';
  const m = p.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}
const pad = (n: number) => (n < 10 ? '0' : '') + n;

// "2026-10-14" + "15:30" in tz -> { ms, iso: "2026-10-14T15:30:00+04:00" }
export function localToUtc(date: string, time: string, tz: string) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let off = offsetMinutes(tz, new Date(guess));
  const ms = guess - off * 60000;
  off = offsetMinutes(tz, new Date(ms));
  const final = guess - off * 60000;
  const sign = off < 0 ? '-' : '+', a = Math.abs(off);
  return { ms: final, iso: `${date}T${pad(h)}:${pad(mi)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}` };
}
export function utcToLocal(input: string | number, tz: string) {
  const d = new Date(input);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export function todayIn(tz: string) { return utcToLocal(Date.now(), tz).date; }
export function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function prettyWhen(date: string, time: string) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${day}, ${h % 12 || 12}:${pad(mi)} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ---------- account data for dropdowns ----------
export interface Meta {
  pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[];
  calendars: { id: string; name: string; slotMinutes: number }[];
  users: { id: string; name: string; email: string; role: string }[];
  tags: string[];
  timezone: string; currency: string; today: string; invoiceLiveMode: boolean;
}

export async function getMeta(sa: SubaccountFull): Promise<Meta> {
  const loc = encodeURIComponent(sa.location_id);
  const safe = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [pl, cal, us, tg] = await Promise.all([
    safe(ghl<{ pipelines?: { id: string; name: string; stages?: { id: string; name: string }[] }[] }>(sa.ghl_token, '/opportunities/pipelines?locationId=' + loc), {}),
    safe(ghl<{ calendars?: { id: string; name: string; isActive?: boolean; slotDuration?: number; slotDurationUnit?: string }[] }>(sa.ghl_token, '/calendars/?locationId=' + loc, { version: CAL_V }), {}),
    safe(ghl<{ users?: { id: string; name?: string; firstName?: string; lastName?: string; email?: string; deleted?: boolean; roles?: { role?: string } }[] }>(sa.ghl_token, '/users/?locationId=' + loc), {}),
    safe(ghl<{ tags?: { name: string }[] }>(sa.ghl_token, '/locations/' + loc + '/tags'), {})
  ]);
  return {
    pipelines: (pl.pipelines || []).map((p) => ({ id: p.id, name: p.name, stages: (p.stages || []).map((s) => ({ id: s.id, name: s.name })) })),
    calendars: (cal.calendars || []).filter((c) => c.isActive !== false).map((c) => ({
      id: c.id, name: c.name,
      slotMinutes: /hour/i.test(c.slotDurationUnit || '') ? (Number(c.slotDuration) || 1) * 60 : Number(c.slotDuration) || 30
    })),
    users: (us.users || []).filter((u) => !u.deleted).map((u) => ({
      id: u.id, name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || 'User', email: u.email || '', role: u.roles?.role || ''
    })),
    tags: (tg.tags || []).map((t) => t.name).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    timezone: sa.timezone, currency: sa.currency || 'USD', today: todayIn(sa.timezone), invoiceLiveMode: sa.invoice_live_mode
  };
}

// ---------- calendar week: free, booked and blocked ----------
export interface SlotItem { start: string; end: string; kind: 'free' | 'booked' | 'blocked'; title?: string }
export interface SlotDay { date: string; items: SlotItem[] }

export async function getWeek(sa: SubaccountFull, calendarId: string, startDate: string, len = 30, days = 7) {
  const tz = sa.timezone;
  const from = localToUtc(startDate, '00:00', tz).ms;
  const to = localToUtc(addDays(startDate, days), '00:00', tz).ms - 1;
  const loc = encodeURIComponent(sa.location_id), cal = encodeURIComponent(calendarId);
  const range = `startTime=${from}&endTime=${to}`;
  const [free, events, blocked] = await Promise.all([
    ghl<Record<string, { slots?: string[] }>>(sa.ghl_token, `/calendars/${cal}/free-slots?startDate=${from}&endDate=${to}&timezone=${encodeURIComponent(tz)}`, { version: CAL_V }),
    ghl<{ events?: { startTime: string; endTime: string; title?: string; appointmentStatus?: string }[] }>(sa.ghl_token, `/calendars/events?locationId=${loc}&calendarId=${cal}&${range}`, { version: CAL_V }).catch(() => ({ events: [] })),
    ghl<{ events?: { startTime: string; endTime: string; title?: string }[] }>(sa.ghl_token, `/calendars/blocked-slots?locationId=${loc}&calendarId=${cal}&${range}`, { version: CAL_V }).catch(() => ({ events: [] }))
  ]);

  const out: SlotDay[] = Array.from({ length: days }, (_, i) => ({ date: addDays(startDate, i), items: [] }));
  const at = (date: string) => out.find((d) => d.date === date);

  Object.keys(free).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).forEach((day) => {
    for (const s of free[day]?.slots || []) {
      const l = utcToLocal(s, tz), e = utcToLocal(new Date(s).getTime() + len * 60000, tz);
      at(l.date)?.items.push({ start: l.time, end: e.time, kind: 'free' });
    }
  });
  for (const ev of events.events || []) {
    if (/cancel/i.test(ev.appointmentStatus || '')) continue;
    const l = utcToLocal(ev.startTime, tz), e = utcToLocal(ev.endTime, tz);
    at(l.date)?.items.push({ start: l.time, end: e.time, kind: 'booked', title: ev.title || 'Booked' });
  }
  for (const ev of blocked.events || []) {
    const l = utcToLocal(ev.startTime, tz), e = utcToLocal(ev.endTime, tz);
    at(l.date)?.items.push({ start: l.time, end: e.time, kind: 'blocked', title: ev.title || 'Blocked' });
  }
  out.forEach((d) => d.items.sort((a, b) => a.start.localeCompare(b.start)));
  return { days: out, slotMinutes: len, timezone: tz };
}

// ---------- activity log ----------
export async function logActivity(sa: SubaccountFull, user: User, a: { action: string; ok: boolean; message: string; contact?: Contact | null; details?: object }) {
  await supabaseAdmin().from('activities').insert({
    subaccount_id: sa.id, subaccount_name: sa.name, user_id: user.id, user_email: user.email, user_name: displayName(user),
    action: a.action, status: a.ok ? 'success' : 'error', message: a.message.slice(0, 1000),
    contact_id: a.contact?.id || null, contact_name: a.contact?.name || null, details: { ...(a.details || {}), source: 'prompt' }
  });
}

// ---------- actions ----------
const money = (n: number, cur: string) => cur + ' ' + (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const cc = (c?: string) => (/^[A-Za-z]{2}$/.test(String(c || '').trim()) ? String(c).trim().toUpperCase() : undefined);

function dropEmpty<T>(v: T): T {
  if (Array.isArray(v)) return v.map(dropEmpty) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const y = dropEmpty(x);
      if (y === '' || y === null || y === undefined) continue;
      if (typeof y === 'object' && !Array.isArray(y) && !Object.keys(y as object).length) continue;
      out[k] = y;
    }
    return out as T;
  }
  return v;
}

export async function createContact(sa: SubaccountFull, input: { email?: string; phone?: string; firstName?: string; lastName?: string }) {
  const d = await ghl<{ contact?: Parameters<typeof toContact>[0] }>(sa.ghl_token, '/contacts/upsert', {
    method: 'POST', body: dropEmpty({ locationId: sa.location_id, ...input })
  });
  return toContact(d.contact!);
}

export async function setTags(sa: SubaccountFull, contactId: string, tags: string[], remove: boolean) {
  await ghl(sa.ghl_token, '/contacts/' + encodeURIComponent(contactId) + '/tags', { method: remove ? 'DELETE' : 'POST', body: { tags } });
}

export async function addNote(sa: SubaccountFull, contactId: string, body: string) {
  await ghl(sa.ghl_token, '/contacts/' + encodeURIComponent(contactId) + '/notes', { method: 'POST', body: { body } });
}

export async function addTask(sa: SubaccountFull, contactId: string, t: { title: string; body?: string; dueDate: string; dueTime?: string; assignedTo?: string }) {
  const due = new Date(localToUtc(t.dueDate, t.dueTime || '10:00', sa.timezone).ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  await ghl(sa.ghl_token, '/contacts/' + encodeURIComponent(contactId) + '/tasks', {
    method: 'POST', body: dropEmpty({ title: t.title, body: t.body, dueDate: due, completed: false, assignedTo: t.assignedTo })
  });
}

export interface OppInput { opportunityId?: string; name?: string; pipelineId: string; stageId?: string; status?: string; value?: number | null }
export async function contactOpportunities(sa: SubaccountFull, contactId: string) {
  const d = await ghl<{ opportunities?: { id: string; name: string; pipelineId: string; pipelineStageId: string; status: string; monetaryValue?: number }[] }>(sa.ghl_token,
    '/opportunities/search?location_id=' + encodeURIComponent(sa.location_id) + '&contact_id=' + encodeURIComponent(contactId) + '&limit=20');
  return (d.opportunities || []).map((o) => ({ id: o.id, name: o.name, pipelineId: o.pipelineId, stageId: o.pipelineStageId, status: o.status, value: o.monetaryValue ?? null }));
}
export async function saveOpportunity(sa: SubaccountFull, contactId: string, o: OppInput) {
  const body = dropEmpty({
    pipelineId: o.pipelineId, pipelineStageId: o.stageId, status: o.status || 'open', name: o.name,
    monetaryValue: o.value === null || o.value === undefined || isNaN(Number(o.value)) ? undefined : Number(o.value)
  });
  if (o.opportunityId) {
    await ghl(sa.ghl_token, '/opportunities/' + encodeURIComponent(o.opportunityId), { method: 'PUT', body });
    return o.opportunityId;
  }
  const d = await ghl<{ opportunity?: { id: string } }>(sa.ghl_token, '/opportunities/', {
    method: 'POST', body: { ...body, locationId: sa.location_id, contactId, name: o.name || 'New opportunity' }
  });
  return d.opportunity?.id || '';
}

export async function bookAppointment(sa: SubaccountFull, contactId: string, a: { calendarId: string; date: string; time: string; title?: string; notes?: string; slotMinutes: number }) {
  const start = localToUtc(a.date, a.time, sa.timezone);
  const end = localToUtc(utcToLocal(start.ms + a.slotMinutes * 60000, sa.timezone).date, utcToLocal(start.ms + a.slotMinutes * 60000, sa.timezone).time, sa.timezone);
  if (start.ms < Date.now()) throw new Error('That time is in the past.');
  const d = await ghl<{ id?: string }>(sa.ghl_token, '/calendars/events/appointments', {
    method: 'POST', version: CAL_V,
    body: dropEmpty({ calendarId: a.calendarId, locationId: sa.location_id, contactId, startTime: start.iso, endTime: end.iso, title: a.title, notes: a.notes, appointmentStatus: 'confirmed', toNotify: true })
  });
  return d.id || '';
}

export interface InvoiceInput {
  items: { name: string; quantity: number; unitPrice: number; description?: string }[];
  currency: string; dueDate: string; title?: string; notes?: string; sendVia: 'email' | 'sms' | 'both' | 'none'; liveMode: boolean;
}
export async function createInvoice(sa: SubaccountFull, contactId: string, inv: InvoiceInput, meta: Meta) {
  const c = await ghl<{ contact?: Record<string, string> }>(sa.ghl_token, '/contacts/' + encodeURIComponent(contactId)).then((d) => (d.contact || d) as Record<string, string>);
  const loc = await ghl<{ location?: Record<string, string> }>(sa.ghl_token, '/locations/' + encodeURIComponent(sa.location_id)).then((d) => (d.location || d) as Record<string, string>);
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.contactName || c.email || 'Customer';
  if ((inv.sendVia === 'email' || inv.sendVia === 'both') && !c.email) throw new Error('This contact has no email address.');
  if ((inv.sendVia === 'sms' || inv.sendVia === 'both') && !c.phone) throw new Error('This contact has no phone number.');
  const cur = (inv.currency || sa.currency || 'USD').toUpperCase();
  const items = inv.items.filter((i) => i.name && i.unitPrice >= 0);
  if (!items.length) throw new Error('Add at least one item with a price.');

  const body = dropEmpty({
    altId: sa.location_id, altType: 'location', name: inv.title || 'Invoice for ' + name, title: 'INVOICE', currency: cur,
    businessDetails: {
      name: loc.name || sa.name, phoneNo: loc.phone, website: loc.website, logoUrl: loc.logoUrl,
      address: { addressLine1: loc.address, city: loc.city, state: loc.state, countryCode: cc(loc.country), postalCode: loc.postalCode }
    },
    items: items.map((i) => ({ name: i.name, description: i.description, currency: cur, amount: Number(i.unitPrice), qty: Number(i.quantity) || 1, type: 'one_time' })),
    discount: { value: 0, type: 'percentage' },
    contactDetails: {
      id: contactId, name, email: c.email, phoneNo: c.phone, companyName: c.companyName,
      address: { addressLine1: c.address1, city: c.city, state: c.state, countryCode: cc(c.country), postalCode: c.postalCode }
    },
    issueDate: todayIn(sa.timezone), dueDate: inv.dueDate,
    termsNotes: inv.notes ? '<p>' + inv.notes.replace(/</g, '&lt;') + '</p>' : undefined,
    sentTo: { email: c.email ? [c.email] : [], phoneNo: c.phone ? [c.phone] : [] },
    liveMode: inv.liveMode
  });
  const created = await ghl<{ invoice?: { _id?: string; invoiceNumber?: string }; _id?: string; invoiceNumber?: string }>(sa.ghl_token, '/invoices/', { method: 'POST', body });
  const id = created.invoice?._id || created._id || '';
  const number = created.invoice?.invoiceNumber || created.invoiceNumber || '';
  const total = items.reduce((s, i) => s + i.unitPrice * (i.quantity || 1), 0);
  let sent = false, sendError = '';
  if (inv.sendVia !== 'none' && id) {
    const sender = (sa.invoice_sender_name && meta.users.find((u) => u.name.toLowerCase() === sa.invoice_sender_name!.toLowerCase()))
      || meta.users.find((u) => /admin/i.test(u.role)) || meta.users[0];
    try {
      if (!sender) throw new Error('no team member to send it from');
      await ghl(sa.ghl_token, '/invoices/' + encodeURIComponent(id) + '/send', {
        method: 'POST', body: { altId: sa.location_id, altType: 'location', userId: sender.id, action: inv.sendVia === 'both' ? 'sms_and_email' : inv.sendVia, liveMode: inv.liveMode }
      });
      sent = true;
    } catch (e) { sendError = (e as Error).message; }
  }
  return { id, number, total: money(total, cur), contactName: name, sent, sendError };
}

export { getContact };
