import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

const GHL_BASE = 'https://services.leadconnectorhq.com';

export interface SubaccountSecret {
  id: string;
  name: string;
  location_id: string;
  ghl_token: string;
  timezone: string;
}

export async function getSubaccount(id: string): Promise<SubaccountSecret | null> {
  const { data } = await supabaseAdmin().from('subaccounts')
    .select('id,name,location_id,ghl_token,timezone').eq('id', id).maybeSingle();
  return data as SubaccountSecret | null;
}

export async function ghl<T = Record<string, unknown>>(
  token: string, path: string, opts: { method?: string; body?: unknown; version?: string } = {}
): Promise<T> {
  const res = await fetch(GHL_BASE + path, {
    method: opts.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      Version: opts.version || '2021-07-28',
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store'
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = (data as { message?: unknown }).message;
    throw new Error('GHL error ' + res.status + ': ' + (Array.isArray(m) ? m.join('; ') : m || res.statusText));
  }
  return data as T;
}

// ---------- contacts ----------
interface RawContact {
  id: string; firstName?: string; lastName?: string; firstNameLowerCase?: string; lastNameLowerCase?: string;
  contactName?: string; name?: string; email?: string; phone?: string; tags?: string[]; companyName?: string;
  dateAdded?: string; dateUpdated?: string;
}
export interface Contact { id: string; name: string; email: string; phone: string; tags: string[]; company: string; added: string }

export function toContact(c: RawContact): Contact {
  const name = [c.firstName || c.firstNameLowerCase, c.lastName || c.lastNameLowerCase].filter(Boolean).join(' ')
    || c.contactName || c.name || c.email || c.phone || 'Unnamed contact';
  return { id: c.id, name, email: c.email || '', phone: c.phone || '', tags: c.tags || [], company: c.companyName || '', added: c.dateAdded || '' };
}

const looksEmail = (q: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q);
const looksPhone = (q: string) => /^[+()\d\s.\-]{7,}$/.test(q) && q.replace(/\D/g, '').length >= 7;

// Exact match by email or phone (GHL's duplicate lookup handles phone formats)
async function findExact(sa: SubaccountSecret, q: string): Promise<Contact[]> {
  const param = looksEmail(q) ? 'email=' + encodeURIComponent(q.toLowerCase())
    : looksPhone(q) ? 'number=' + encodeURIComponent(q.replace(/[^\d+]/g, '')) : '';
  if (!param) return [];
  try {
    const d = await ghl<{ contact?: RawContact }>(sa.ghl_token,
      '/contacts/search/duplicate?locationId=' + encodeURIComponent(sa.location_id) + '&' + param);
    return d.contact && d.contact.id ? [toContact(d.contact)] : [];
  } catch {
    return [];
  }
}

export async function searchContacts(sa: SubaccountSecret, query: string) {
  if (query) {
    const [exact, fuzzy] = await Promise.all([findExact(sa, query), searchContactsRaw(sa, query).catch(() => [] as Contact[])]);
    const seen = new Set(exact.map((c) => c.id));
    return [...exact, ...fuzzy.filter((c) => !seen.has(c.id))];
  }
  return searchContactsRaw(sa, '');
}

async function searchContactsRaw(sa: SubaccountSecret, query: string) {
  const body: Record<string, unknown> = { locationId: sa.location_id, pageLimit: 25 };
  if (query) body.query = query;
  else body.sort = [{ field: 'dateUpdated', direction: 'desc' }];
  const d = await ghl<{ contacts?: RawContact[] }>(sa.ghl_token, '/contacts/search', { method: 'POST', body })
    .catch(async (e) => {
      // Older search API rejects sort: retry without it
      if (query) throw e;
      return ghl<{ contacts?: RawContact[] }>(sa.ghl_token, '/contacts/search', { method: 'POST', body: { locationId: sa.location_id, pageLimit: 25 } });
    });
  return (d.contacts || []).map(toContact);
}

export async function getContact(sa: SubaccountSecret, contactId: string) {
  const d = await ghl<{ contact?: RawContact }>(sa.ghl_token, '/contacts/' + encodeURIComponent(contactId));
  return toContact((d.contact || d) as RawContact);
}

// ---------- conversation transcript ----------
interface RawMessage {
  id: string; dateAdded: string; direction?: string; messageType?: string; type?: string | number;
  body?: string; subject?: string; callDuration?: number; meta?: { call?: { duration?: number; status?: string }; email?: { subject?: string } };
  attachments?: unknown[];
}
export interface TranscriptMessage { at: string; when: string; day: string; who: 'Lead' | 'Team' | 'System'; channel: string; text: string }

const CHANNELS: Record<string, string> = {
  SMS: 'SMS', EMAIL: 'Email', CALL: 'Call', PHONE: 'Call', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram',
  WHATSAPP: 'WhatsApp', GMB: 'Google', WEBCHAT: 'Web chat', LIVE_CHAT: 'Live chat', CUSTOM_SMS: 'SMS', CUSTOM_EMAIL: 'Email',
  REVIEW: 'Review', CAMPAIGN_SMS: 'SMS', CAMPAIGN_EMAIL: 'Email', IVR_CALL: 'Call', VOICEMAIL: 'Voicemail'
};

function channelOf(m: RawMessage) {
  const raw = String(m.messageType || (typeof m.type === 'string' ? m.type : '') || '').replace(/^TYPE_/, '').toUpperCase();
  if (raw.startsWith('ACTIVITY')) return 'Activity';
  return CHANNELS[raw] || (raw ? raw.charAt(0) + raw.slice(1).toLowerCase().replace(/_/g, ' ') : 'Message');
}

function stripHtml(html?: string) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const CONV_V = '2021-04-15';

// All threads for the contact, every page of messages (capped), oldest first, times in the sub-account timezone
export async function getTranscript(sa: SubaccountSecret, contactId: string, maxMessages = 600) {
  const s = await ghl<{ conversations?: { id: string }[] }>(sa.ghl_token,
    '/conversations/search?locationId=' + encodeURIComponent(sa.location_id) + '&contactId=' + encodeURIComponent(contactId) + '&limit=20',
    { version: CONV_V });
  const convs = (s.conversations || []).slice(0, 10);

  const all: RawMessage[] = [];
  for (const cv of convs) {
    let last = '';
    for (let page = 0; page < 10 && all.length < maxMessages * 2; page++) {
      const q = '?limit=100' + (last ? '&lastMessageId=' + encodeURIComponent(last) : '');
      const d = await ghl<{ messages?: { messages?: RawMessage[]; lastMessageId?: string; nextPage?: boolean } | RawMessage[] }>(
        sa.ghl_token, '/conversations/' + encodeURIComponent(cv.id) + '/messages' + q, { version: CONV_V });
      const box = d.messages;
      const list = Array.isArray(box) ? box : box?.messages || [];
      all.push(...list);
      const next = !Array.isArray(box) && box?.nextPage && box?.lastMessageId;
      if (!next || !list.length) break;
      last = String(box.lastMessageId);
    }
  }

  const seen = new Set<string>();
  const tz = sa.timezone || 'UTC';
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });

  const messages: TranscriptMessage[] = all
    .filter((m) => m && m.id && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => new Date(a.dateAdded).getTime() - new Date(b.dateAdded).getTime())
    .slice(-maxMessages)
    .map((m) => {
      const channel = channelOf(m);
      const d = new Date(m.dateAdded);
      let text = stripHtml(m.body);
      if (channel === 'Email') {
        const subject = m.subject || m.meta?.email?.subject;
        text = (subject ? 'Subject: ' + subject + '\n' : '') + (text || '[email body not available]');
      } else if (channel === 'Call' || channel === 'Voicemail') {
        const secs = m.callDuration || m.meta?.call?.duration;
        text = text || '[' + channel.toLowerCase() + (m.meta?.call?.status ? ', ' + m.meta.call.status : '') + (secs ? ', ' + secs + 's' : '') + ']';
      }
      if (!text) text = '[no text]';
      const files = (m.attachments || []).length;
      if (files) text += ' [' + files + ' attachment' + (files > 1 ? 's' : '') + ']';
      return {
        at: m.dateAdded,
        day: dayFmt.format(d),
        when: dayFmt.format(d) + ', ' + timeFmt.format(d),
        who: channel === 'Activity' ? 'System' : m.direction === 'inbound' ? 'Lead' : 'Team',
        channel,
        text: text.slice(0, 4000)
      };
    });

  return { messages, threads: convs.length };
}

// Plain-text transcript for the model, grouped by day
export function transcriptText(messages: TranscriptMessage[]) {
  let day = '';
  const lines: string[] = [];
  for (const m of messages) {
    if (m.day !== day) { lines.push('', '----- ' + m.day + ' -----'); day = m.day; }
    lines.push(m.who + ' (' + m.channel + ') at ' + m.when.split(', ').pop() + ':', m.text, '');
  }
  return lines.join('\n').trim();
}

// ---------- channels ----------
export type Channel = 'sms' | 'email' | 'facebook' | 'instagram';
export const CHANNEL_LABEL: Record<Channel, string> = { sms: 'SMS', email: 'Email', facebook: 'Facebook', instagram: 'Instagram' };
const GHL_TYPE: Record<Channel, string> = { sms: 'SMS', email: 'Email', facebook: 'FB', instagram: 'IG' };
const DAY = 24 * 3600 * 1000;

export interface ChannelState { available: boolean; reason?: string; closesAt?: string }

// Which channels can be used right now. Facebook/Instagram only within 24h of the lead's last message there.
export function channelStates(contact: Contact, messages: TranscriptMessage[], now = Date.now()): Record<Channel, ChannelState> {
  const lastInbound = (label: string) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].who === 'Lead' && messages[i].channel === label) return new Date(messages[i].at).getTime();
    }
    return 0;
  };
  const social = (label: string): ChannelState => {
    const t = lastInbound(label);
    if (!t) return { available: false, reason: 'The lead has never messaged on ' + label + '.' };
    if (now - t > DAY) return { available: false, reason: label + "'s 24-hour reply window is closed (their last message was more than 24 hours ago)." };
    return { available: true, closesAt: new Date(t + DAY).toISOString() };
  };
  return {
    sms: contact.phone ? { available: true } : { available: false, reason: 'This contact has no phone number.' },
    email: contact.email ? { available: true } : { available: false, reason: 'This contact has no email address.' },
    facebook: social('Facebook'),
    instagram: social('Instagram')
  };
}

// Most recent message our team sent (any channel), from the transcript
export function lastOutbound(messages: TranscriptMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].who === 'Team') return messages[i];
  return null;
}

export async function sendMessage(sa: SubaccountSecret, contactId: string, channel: Channel, text: string, email?: { subject: string; html: string }) {
  const body: Record<string, unknown> = { type: GHL_TYPE[channel], contactId, message: text };
  if (channel === 'email' && email) Object.assign(body, { subject: email.subject, html: email.html });
  const d = await ghl<{ messageId?: string; id?: string; emailMessageId?: string }>(sa.ghl_token, '/conversations/messages', { method: 'POST', body, version: CONV_V });
  return d.messageId || d.emailMessageId || d.id || '';
}
