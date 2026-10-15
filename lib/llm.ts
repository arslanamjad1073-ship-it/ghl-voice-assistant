import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseAdmin } from '@/lib/supabase/admin';

// One entry point for every AI feature. The active provider/key comes from the AI settings page
// (llm_providers table); without one, GEMINI_API_KEY from the environment is used.
// Every call records its token usage and cost in llm_usage.

export type Provider = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'custom';
export interface Turn { role: 'user' | 'model'; text: string }
export interface Track { feature: string; userId?: string; subaccountId?: string }
export interface ProviderConfig {
  id?: number; provider: Provider; apiKey: string; model: string; baseUrl?: string | null;
  priceIn?: number | null; priceOut?: number | null;
}
interface Result { text: string; inputTokens: number; outputTokens: number; costUsd?: number | null }

// Known list prices (USD per 1M tokens) used when the settings page leaves the price empty.
// Claude prices are Anthropic's first-party rates; other providers change often, so enter them on the settings page.
export const KNOWN_PRICES: Record<string, { in: number; out: number }> = {
  'claude-fable-5-1': { in: 10, out: 50 },
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 }
};

export const DEFAULT_MODELS: Record<Provider, string> = {
  gemini: 'gemini-3.8-flash',
  openai: 'gpt-5-mini',
  anthropic: 'claude-opus-5-5',
  openrouter: 'openrouter/auto',
  custom: ''
};

let cached: { at: number; cfg: ProviderConfig | null } | null = null;
export function clearProviderCache() { cached = null; }

export async function activeProvider(): Promise<ProviderConfig | null> {
  if (cached && Date.now() - cached.at < 30000) return cached.cfg;
  const { data } = await supabaseAdmin().from('llm_providers')
    .select('id,provider,api_key,model,base_url,price_in_per_m,price_out_per_m').eq('is_active', true).maybeSingle();
  let cfg: ProviderConfig | null = data ? {
    id: data.id, provider: data.provider as Provider, apiKey: data.api_key, model: data.model, baseUrl: data.base_url,
    priceIn: data.price_in_per_m === null ? null : Number(data.price_in_per_m), priceOut: data.price_out_per_m === null ? null : Number(data.price_out_per_m)
  } : null;
  if (!cfg && process.env.GEMINI_API_KEY) {
    cfg = { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_TEXT_MODEL || DEFAULT_MODELS.gemini };
  }
  cached = { at: Date.now(), cfg };
  return cfg;
}

const JSON_RULE = '\n\nRespond with a single valid JSON object only. No markdown, no code fences, no text before or after it.';

// ---------- adapters ----------
async function callGemini(c: ProviderConfig, system: string, turns: Turn[], json: boolean, temperature: number): Promise<Result> {
  const thinking = /^gemini-2\./.test(c.model) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' };
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(c.model) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      generationConfig: { temperature, maxOutputTokens: 8192, thinkingConfig: thinking, ...(json ? { responseMimeType: 'application/json' } : {}) }
    }),
    cache: 'no-store'
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Gemini error ' + res.status + ': ' + (d?.error?.message || res.statusText));
  const parts = d?.candidates?.[0]?.content?.parts || [];
  const u = d?.usageMetadata || {};
  return {
    text: parts.filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || '').join('').trim(),
    inputTokens: Number(u.promptTokenCount) || 0,
    outputTokens: (Number(u.candidatesTokenCount) || 0) + (Number(u.thoughtsTokenCount) || 0)
  };
}

async function callOpenAICompatible(c: ProviderConfig, system: string, turns: Turn[], json: boolean, temperature: number): Promise<Result> {
  const base = (c.provider === 'openai' ? 'https://api.openai.com/v1' : c.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : (c.baseUrl || '')).replace(/\/+$/, '');
  if (!base) throw new Error('Set the base URL for the custom provider');
  const body: Record<string, unknown> = {
    model: c.model,
    messages: [{ role: 'system', content: system + (json ? JSON_RULE : '') }, ...turns.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text }))],
    temperature
  };
  if (json) body.response_format = { type: 'json_object' };
  if (c.provider === 'openrouter') body.usage = { include: true };
  const send = async (b: Record<string, unknown>) => {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey }, body: JSON.stringify(b), cache: 'no-store'
    });
    return { r, d: await r.json().catch(() => ({})) };
  };
  let { r, d } = await send(body);
  // Some models only accept the default temperature or no response_format: retry once without them
  if (!r.ok && r.status === 400 && /temperature|response_format/i.test(JSON.stringify(d))) {
    const { temperature: _t, response_format: _f, ...rest } = body;
    ({ r, d } = await send(rest));
  }
  if (!r.ok) throw new Error(`${c.provider} error ${r.status}: ${d?.error?.message || r.statusText}`);
  const u = d?.usage || {};
  return {
    text: String(d?.choices?.[0]?.message?.content || '').trim(),
    inputTokens: Number(u.prompt_tokens) || 0,
    outputTokens: Number(u.completion_tokens) || 0,
    costUsd: typeof u.cost === 'number' ? u.cost : null
  };
}

// Claude: no temperature (current models reject sampling parameters); thinking is adaptive by default,
// so effort keeps these short tasks fast. Models that support it get server-side refusal fallback.
async function callAnthropic(c: ProviderConfig, system: string, turns: Turn[], json: boolean): Promise<Result> {
  const client = new Anthropic({ apiKey: c.apiKey });
  const current = /^claude-(fable|opus|sonnet|haiku)-5/.test(c.model);
  const fallbackOk = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/.test(c.model);
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text }));
  try {
    const r = await client.beta.messages.create({
      model: c.model,
      max_tokens: 16000,
      system: system + (json ? JSON_RULE : ''),
      messages,
      ...(current ? { output_config: { effort: 'low' as const } } : {}),
      ...(fallbackOk ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
    });
    if (r.stop_reason === 'refusal') throw new Error('Claude declined this request' + (r.stop_details?.category ? ` (${r.stop_details.category})` : ''));
    const text = r.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('').trim();
    return { text, inputTokens: r.usage.input_tokens || 0, outputTokens: r.usage.output_tokens || 0 };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude rejected the API key');
    if (e instanceof Anthropic.NotFoundError) throw new Error(`Claude model "${c.model}" not found`);
    if (e instanceof Anthropic.RateLimitError) throw new Error('Claude rate limit reached, try again shortly');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude error ${e.status}: ${e.message}`);
    throw e;
  }
}

export async function callProvider(c: ProviderConfig, system: string, turns: Turn[], opts: { json?: boolean; temperature?: number } = {}) {
  const t = opts.temperature ?? 0.2;
  if (c.provider === 'gemini') return callGemini(c, system, turns, !!opts.json, t);
  if (c.provider === 'anthropic') return callAnthropic(c, system, turns, !!opts.json);
  return callOpenAICompatible(c, system, turns, !!opts.json, t);
}

export function costOf(c: ProviderConfig, inTok: number, outTok: number, reported?: number | null) {
  if (typeof reported === 'number') return reported;
  const known = KNOWN_PRICES[c.model];
  const pin = c.priceIn ?? known?.in, pout = c.priceOut ?? known?.out;
  if (pin === undefined || pin === null || pout === undefined || pout === null) return null;
  return (inTok / 1e6) * pin + (outTok / 1e6) * pout;
}

// The function every feature calls
export async function llm(system: string, turns: Turn[], opts: { json?: boolean; temperature?: number; track?: Track } = {}) {
  const c = await activeProvider();
  if (!c) throw new Error('No AI provider is set up. Add an API key on the AI settings page.');
  let r: Result | null = null, err: unknown = null;
  try { r = await callProvider(c, system, turns, opts); } catch (e) { err = e; }
  // Usage log never blocks or breaks the feature
  try {
    await supabaseAdmin().from('llm_usage').insert({
    provider: c.provider, model: c.model, feature: opts.track?.feature || 'other',
    input_tokens: r?.inputTokens || 0, output_tokens: r?.outputTokens || 0,
    cost_usd: r ? costOf(c, r.inputTokens, r.outputTokens, r.costUsd) : null,
    user_id: opts.track?.userId || null, subaccount_id: opts.track?.subaccountId || null, ok: !err
    });
  } catch { /* logging must not break the feature */ }
  if (err) throw err;
  if (!r!.text) throw new Error('The AI returned an empty answer');
  return r!.text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
}
