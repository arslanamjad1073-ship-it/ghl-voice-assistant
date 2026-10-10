import 'server-only';
import { gemini } from '@/lib/gemini';
import { FOLLOWUP_PROMPT } from '@/lib/leadPrompts';
import type { Contact } from '@/lib/ghl';

export interface FollowupDraft { short: string; email_subject: string; email_body: string }

export async function draftFollowup(contact: Contact, transcript: string, ctx: { senderName: string; company: string; timezone: string }): Promise<FollowupDraft> {
  const text = await gemini(FOLLOWUP_PROMPT, [{
    role: 'user',
    text: 'Lead: ' + contact.name + '\nWe are: ' + ctx.company + ' (writer: ' + ctx.senderName + ')\nTimezone: ' + ctx.timezone +
      '\nNow: ' + new Date().toLocaleString('en-US', { timeZone: ctx.timezone }) + '\n\nTranscript:\n' + (transcript || '[no messages yet]')
  }], { json: true, temperature: 0.5 });
  let d: Partial<FollowupDraft> = {};
  try { d = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim()); } catch { /* fall through */ }
  return {
    short: String(d.short || '').slice(0, 600),
    email_subject: String(d.email_subject || 'Following up').slice(0, 150),
    email_body: String(d.email_body || '').slice(0, 4000)
  };
}
