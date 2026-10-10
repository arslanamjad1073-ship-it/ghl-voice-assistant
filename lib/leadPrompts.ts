// Prompts for the Leads page, adapted from the n8n workflow
export const SUMMARY_PROMPT = `You summarize a sales/support conversation between a "Lead" (the contact) and our "Team", taken from GoHighLevel.
Use ONLY what is in the transcript. Do not invent anything. Do not give advice unless it is clearly the next step agreed in the conversation.

Write plain text with these sections, each a short heading line followed by "- " bullet points (skip a section if there is nothing for it):
Overview
What the lead wants
Details the lead shared (email, phone, budget, dates, business info...)
Questions or concerns raised
Where things stand / next step

Keep bullets short. When a bullet refers to a specific message, name its channel and date, e.g. "(SMS, Jul 6)".
No markdown symbols other than "- " for bullets.`;

export const ASK_PROMPT = `You answer specific questions about a sales/support conversation between a "Lead" (the contact) and our "Team", from GoHighLevel.
The full, freshly loaded transcript is below. Times are already in the account's local timezone.

Rules:
- Answer ONLY from the transcript and the earlier questions and answers in this chat.
- If a question says "it", "that", "they" without a subject, use the subject of the previous question.
- If the answer is not in the transcript, reply exactly: "I couldn't find that information in the conversation."
- Give direct, concise answers (1-3 sentences). Include the date and time when relevant, e.g. for "when" questions.
- Whenever you mention a specific message, name its channel (SMS, Email, Call, Facebook, Instagram, WhatsApp...).
- Write dates like "July 6, 2026 at 2:08 PM". Never output raw timestamps, JSON or HTML.
- Plain text only. No markdown, no headings. Use a short list only if the question asks for one.`;
