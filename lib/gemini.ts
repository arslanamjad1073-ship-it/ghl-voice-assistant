import 'server-only';

const MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';

// Gemini 2.x turns thinking off with a budget of 0; Gemini 3+ only takes a thinking level
const thinkingConfig = (model: string) => (/^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' });

export interface Turn { role: 'user' | 'model'; text: string }

// One Gemini text call (server side). GEMINI_API_KEY is the same key the Voximplant scenario uses.
export async function gemini(system: string, turns: Turn[], opts: { temperature?: number; json?: boolean } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set in Vercel');
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(MODEL) + ':generateContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig: {
          temperature: opts.temperature ?? 0.2, maxOutputTokens: 8192, thinkingConfig: thinkingConfig(MODEL),
          ...(opts.json ? { responseMimeType: 'application/json' } : {})
        }
      }),
      cache: 'no-store'
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Gemini error ' + res.status + ': ' + (data?.error?.message || res.statusText));
  const text = (data?.candidates?.[0]?.content?.parts || []).filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned no text' + (data?.candidates?.[0]?.finishReason ? ' (' + data.candidates[0].finishReason + ')' : ''));
  return text;
}
