import 'server-only';
import { gemini } from '@/lib/gemini';
import type { Meta } from '@/lib/ghlActions';

export const ACTIONS = ['send_email', 'send_sms', 'create_invoice', 'add_tags', 'remove_tags', 'opportunity', 'book_appointment', 'add_note', 'add_task', 'lead_summary', 'unknown'] as const;
export type Action = (typeof ACTIONS)[number];

export interface Parsed {
  action: Action;
  contact_query: string;
  write_instruction: string;
  reply: string;
  fields: Record<string, unknown>;
}

const PARSE_PROMPT = `You turn a CRM user's request into ONE action with pre-filled fields for a form. The user then reviews and submits it.
Actions:
- send_email: fields {subject, body}
- send_sms: fields {body}
- create_invoice: fields {items:[{name, quantity, unit_price}], due_date (YYYY-MM-DD), currency (3 letters), send_via ("email"|"sms"|"both"|"none"), notes}
- add_tags / remove_tags: fields {tags:[...]}
- opportunity (create a deal, move it to a stage, mark won/lost, change value): fields {name, pipeline, stage, status ("open"|"won"|"lost"|"abandoned"), value}
- book_appointment: fields {calendar, date (YYYY-MM-DD), time (HH:MM 24h), title, notes}
- add_note: fields {body}
- add_task: fields {title, details, due_date (YYYY-MM-DD), due_time (HH:MM), assignee}
- lead_summary: summarize / ask about a contact's conversation. fields {}
- unknown: anything else. Put a short helpful answer in reply.

Return JSON only:
{"action": "...", "contact_query": "...", "write_instruction": "...", "reply": "...", "fields": {...}}
Rules:
- contact_query: the contact's email, phone or name exactly as the user wrote it ("" if none).
- write_instruction: when the user asks you to WRITE content (email, SMS, note) or describes what it should say, put that instruction here
  (e.g. "thank them for the call and offer a time next week"). Leave fields.subject/body empty then. If the user dictated exact text, put it in the fields instead.
- Only fill fields the user actually gave. Use names exactly from the lists below when they match (pipeline, stage, calendar, assignee).
- Convert relative dates ("tomorrow", "next Monday", "the 15th") using today's date below. Never invent prices or amounts.
- reply: one short sentence telling the user what the form is for, e.g. "Here's an email to Peter John. Review and send."`;

export async function parsePrompt(prompt: string, meta: Meta): Promise<Parsed> {
  const context = [
    'Today: ' + meta.today + ' (' + new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: meta.timezone }) + '), timezone ' + meta.timezone,
    'Default currency: ' + meta.currency,
    'Pipelines: ' + (meta.pipelines.map((p) => p.name + ' [' + p.stages.map((s) => s.name).join(', ') + ']').join('; ') || 'none'),
    'Calendars: ' + (meta.calendars.map((c) => c.name).join(', ') || 'none'),
    'Team members: ' + (meta.users.map((u) => u.name).join(', ') || 'none')
  ].join('\n');
  const text = await gemini(PARSE_PROMPT + '\n\n' + context, [{ role: 'user', text: prompt.slice(0, 2000) }], { json: true, temperature: 0.1 });
  let d: Partial<Parsed> = {};
  try { d = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { /* unknown */ }
  const action = (ACTIONS as readonly string[]).includes(String(d.action)) ? (d.action as Action) : 'unknown';
  return {
    action,
    contact_query: String(d.contact_query || '').slice(0, 200),
    write_instruction: String(d.write_instruction || '').slice(0, 1000),
    reply: String(d.reply || '').slice(0, 400),
    fields: d.fields && typeof d.fields === 'object' ? d.fields : {}
  };
}

const WRITE_PROMPT = `You write a message from our team to a contact, following the user's instruction.
Use ONLY facts from the instruction and the recent conversation (if given). Never invent prices, dates, links or promises.
Friendly and professional; match the language of the instruction. Use the contact's first name if known.
Return JSON only.
- kind "email": {"subject": "...", "body": "..."} body is plain text, short paragraphs separated by a blank line, starts with a greeting,
  NO sign-off or signature (added automatically).
- kind "sms": {"body": "..."} under 300 characters, no sign-off.
- kind "note": {"body": "..."} an internal CRM note in clean complete sentences.`;

export async function writeContent(kind: 'email' | 'sms' | 'note', instruction: string, ctx: { contactName?: string; company: string; sender: string; transcript?: string }) {
  const text = await gemini(WRITE_PROMPT, [{
    role: 'user',
    text: `kind: ${kind}\nInstruction: ${instruction}\nContact: ${ctx.contactName || 'unknown'}\nWe are: ${ctx.company} (writer: ${ctx.sender})` +
      (ctx.transcript ? `\n\nRecent conversation (oldest first):\n${ctx.transcript.slice(-12000)}` : '')
  }], { json: true, temperature: 0.5 });
  let d: { subject?: string; body?: string } = {};
  try { d = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { d = { body: text }; }
  return { subject: String(d.subject || '').slice(0, 200), body: String(d.body || '').slice(0, 5000) };
}
