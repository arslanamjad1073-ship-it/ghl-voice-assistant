'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconBack, IconCheck, IconEdit, IconTrash, IconSparkle, IconAlert } from '@/components/Icons';

type Provider = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'custom';
interface Saved { id: number; provider: Provider; label: string | null; model: string; base_url: string | null; price_in_per_m: number | null; price_out_per_m: number | null; is_active: boolean; key_hint: string; updated_at: string }
interface Agg { requests: number; failed: number; inputTokens: number; outputTokens: number; costUsd: number; unpriced: number }
interface Usage { total: Agg; byModel: (Agg & { provider: string; model: string })[]; byFeature: (Agg & { feature: string })[]; byDay: (Agg & { day: string })[] }

const NAMES: Record<Provider, string> = { gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic Claude', openrouter: 'OpenRouter', custom: 'Other (OpenAI-compatible)' };
const MODEL_HINTS: Record<Provider, string[]> = {
  gemini: ['gemini-3.8-flash', 'gemini-3.8-pro'],
  openai: ['gpt-5-mini', 'gpt-5'],
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
  openrouter: ['openrouter/auto'],
  custom: []
};
const KEY_HELP: Record<Provider, string> = {
  gemini: 'aistudio.google.com › Get API key',
  openai: 'platform.openai.com › API keys',
  anthropic: 'platform.claude.com › API keys',
  openrouter: 'openrouter.ai › Keys (cost is reported by OpenRouter itself)',
  custom: 'Any OpenAI-compatible API (Groq, Together, Mistral, Azure, local…)'
};
const FEATURE: Record<string, string> = {
  prompt_parse: 'Understanding prompts', ai_write: 'AI writing (email, SMS, notes)', lead_summary: 'Lead summaries',
  lead_question: 'Questions about leads', followup_draft: 'Follow-up suggestions', other: 'Other'
};

const input = 'h-11 w-full rounded-xl border border-line bg-card px-3.5 text-[14.5px] text-fg placeholder:text-faint outline-none transition focus:border-cyan focus:ring-3 focus:ring-cyan/20';
const fmt = (n: number) => n.toLocaleString('en-US');
const compact = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(n));
const usd = (n: number) => '$' + (n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2));
const BAR = '#1593c7', BAR_HOVER = '#5ad2f4'; // validated on the dark panel

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );
}

function DailyChart({ days, metric }: { days: (Agg & { day: string })[]; metric: 'tokens' | 'cost' }) {
  const [hover, setHover] = useState<number | null>(null);
  const val = (d: Agg) => (metric === 'cost' ? d.costUsd : d.inputTokens + d.outputTokens);
  const max = Math.max(...days.map(val), 0) || 1;
  const label = (day: string) => new Date(day + 'T00:00:00Z').toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const h = hover !== null ? days[hover] : null;
  return (
    <div className="relative">
      <div className="mb-1 flex justify-between text-xs text-muted"><span>{metric === 'cost' ? usd(max) : compact(max)}</span></div>
      <div className="relative flex h-40 items-end gap-[2px] border-b border-line" onMouseLeave={() => setHover(null)}>
        {days.map((d, i) => (
          <div key={d.day} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
            aria-label={`${label(d.day)}: ${metric === 'cost' ? usd(d.costUsd) : fmt(d.inputTokens + d.outputTokens) + ' tokens'}`}>
            <div className="w-full rounded-t-[4px] transition-colors"
              style={{ height: val(d) ? Math.max(2, (val(d) / max) * 100) + '%' : '0', background: hover === i ? BAR_HOVER : BAR }} />
          </div>
        ))}
        {h && (
          <div className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-xl border border-line bg-panel px-3 py-2 text-xs shadow-xl"
            style={{ left: `${((hover! + 0.5) / days.length) * 100}%` }}>
            <p className="font-semibold text-fg">{label(h.day)}</p>
            <p className="text-muted">{fmt(h.requests)} requests</p>
            <p className="text-muted">{fmt(h.inputTokens)} in · {fmt(h.outputTokens)} out</p>
            <p className="text-fg">{usd(h.costUsd)}{h.unpriced ? ` (+${h.unpriced} unpriced)` : ''}</p>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>{days[0] && label(days[0].day)}</span><span>{days.length > 2 && label(days[Math.floor(days.length / 2)].day)}</span><span>{days.length > 1 && label(days[days.length - 1].day)}</span>
      </div>
    </div>
  );
}

export default function AiSettingsPage() {
  const [items, setItems] = useState<Saved[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [envFallback, setEnvFallback] = useState(false);
  const [known, setKnown] = useState<Record<string, { in: number; out: number }>>({});
  const [form, setForm] = useState<{ id?: number; provider: Provider; label: string; apiKey: string; model: string; baseUrl: string; priceIn: string; priceOut: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [metric, setMetric] = useState<'tokens' | 'cost'>('cost');
  const [table, setTable] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch('/api/ai/providers', { cache: 'no-store' }).then((r) => r.json());
    setItems(d.items || []); setCanManage(!!d.canManage); setEnvFallback(!!d.envFallback); setKnown(d.knownPrices || {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setUsage(null);
    fetch('/api/ai/usage?days=' + days, { cache: 'no-store' }).then((r) => r.json()).then(setUsage).catch(() => setUsage(null));
  }, [days]);

  const active = items.find((i) => i.is_active);
  const startNew = (p: Provider = 'gemini') => { setForm({ provider: p, label: '', apiKey: '', model: MODEL_HINTS[p][0] || '', baseUrl: '', priceIn: '', priceOut: '' }); setMsg(null); };
  const edit = (s: Saved) => {
    setForm({ id: s.id, provider: s.provider, label: s.label || '', apiKey: '', model: s.model, baseUrl: s.base_url || '', priceIn: s.price_in_per_m?.toString() || '', priceOut: s.price_out_per_m?.toString() || '' });
    setMsg(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setMsg(null);
    const r = await fetch('/api/ai/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, activate: true }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: d.error || 'Could not save' });
    setMsg({ ok: true, text: `${NAMES[form.provider]} (${form.model}) works and is now the active AI.` });
    setForm(null); load();
  }
  async function activate(id: number) {
    await fetch('/api/ai/providers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    load();
  }
  async function remove(s: Saved) {
    if (!confirm(`Remove ${NAMES[s.provider]} (${s.model})?`)) return;
    await fetch('/api/ai/providers?id=' + s.id, { method: 'DELETE' });
    load();
  }

  // Fill every day in the range so gaps show as empty days
  const series = useMemo(() => {
    if (!usage) return [];
    const map = new Map(usage.byDay.map((d) => [d.day, d]));
    const n = days > 0 ? days : Math.max(usage.byDay.length, 1);
    const end = new Date(); const out: (Agg & { day: string })[] = [];
    const first = days > 0 ? new Date(end.getTime() - (n - 1) * 86400000) : new Date((usage.byDay[0]?.day || end.toISOString().slice(0, 10)) + 'T00:00:00Z');
    for (let t = new Date(first.toISOString().slice(0, 10) + 'T00:00:00Z'); t <= end; t = new Date(t.getTime() + 86400000)) {
      const day = t.toISOString().slice(0, 10);
      out.push(map.get(day) || { day, requests: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0 });
    }
    return out;
  }, [usage, days]);
  const knownPrice = form ? known[form.model] : undefined;

  return (
    <div>
      <div className="flex items-center gap-3">
        <Link href="/" aria-label="Back" className="flex size-11 items-center justify-center rounded-full bg-card hover:bg-card-2"><IconBack size={20} /></Link>
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">AI settings</h1>
          <p className="text-sm text-muted">Which AI powers prompts, writing and lead summaries, and what it costs.</p>
        </div>
      </div>

      {msg && <p className={`mt-4 flex items-center gap-2 rounded-2xl px-4 py-3 text-sm ${msg.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>{msg.ok ? <IconCheck size={18} /> : <IconAlert size={18} />}{msg.text}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        {/* Providers */}
        <section className="space-y-4">
          <div className="rounded-[24px] border border-line bg-panel p-5">
            <p className="text-xs uppercase tracking-wide text-muted">Active AI</p>
            {active ? (
              <p className="mt-1 text-lg font-semibold">{NAMES[active.provider]} · <span className="font-mono text-base">{active.model}</span></p>
            ) : envFallback ? (
              <p className="mt-1 text-lg font-semibold">Google Gemini <span className="text-sm font-normal text-muted">(GEMINI_API_KEY from Vercel)</span></p>
            ) : (
              <p className="mt-1 flex items-center gap-2 text-bad"><IconAlert size={18} /> No AI set up yet. Add a key below.</p>
            )}
          </div>

          <div className="rounded-[24px] border border-line bg-panel p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Saved keys</h2>
              {canManage && !form && <button onClick={() => startNew()} className="h-9 rounded-full bg-cyan px-4 text-sm font-semibold text-cyan-ink">Add a key</button>}
            </div>
            <ul className="space-y-2">
              {items.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-card p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-cyan/12 text-cyan"><IconSparkle size={16} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.label || NAMES[s.provider]} {s.is_active && <span className="ml-1 rounded-full bg-cyan/15 px-2 py-0.5 text-[11px] text-cyan">Active</span>}</span>
                    <span className="block truncate font-mono text-xs text-muted">{s.model} · {s.key_hint}</span>
                  </span>
                  {canManage && (
                    <span className="flex shrink-0 gap-1">
                      {!s.is_active && <button onClick={() => activate(s.id)} className="h-8 rounded-full bg-card-2 px-3 text-xs hover:bg-[#383a40]">Use</button>}
                      <button onClick={() => edit(s)} aria-label="Edit" className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-card-2 hover:text-fg"><IconEdit size={15} /></button>
                      <button onClick={() => remove(s)} aria-label="Remove" className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-bad/10 hover:text-bad"><IconTrash size={15} /></button>
                    </span>
                  )}
                </li>
              ))}
              {!items.length && <li className="text-sm text-muted">No keys saved{envFallback ? '. Using GEMINI_API_KEY from Vercel.' : '.'}</li>}
            </ul>
            {!canManage && <p className="mt-3 text-xs text-muted">Only admins can change AI keys.</p>}
          </div>

          {form && (
            <form onSubmit={save} className="space-y-4 rounded-[24px] border border-line bg-panel p-5">
              <h2 className="font-semibold">{form.id ? 'Edit key' : 'Add a key'}</h2>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(NAMES) as Provider[]).map((p) => (
                  <button type="button" key={p} onClick={() => setForm({ ...form, provider: p, model: form.id ? form.model : MODEL_HINTS[p][0] || '' })}
                    className={`h-9 rounded-full px-3.5 text-sm ${form.provider === p ? 'bg-cyan text-cyan-ink' : 'bg-card text-muted hover:text-fg'}`}>{NAMES[p]}</button>
                ))}
              </div>
              <p className="text-xs text-muted">Get a key: {KEY_HELP[form.provider]}</p>
              <label className="block"><span className="mb-1.5 block text-sm font-medium">API key</span>
                <input type="password" autoComplete="off" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} className={input}
                  placeholder={form.id ? 'Leave blank to keep the saved key' : 'Paste the key'} required={!form.id} /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-medium">Model</span>
                <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={input + ' font-mono'} list="model-hints" required />
                <datalist id="model-hints">{MODEL_HINTS[form.provider].map((m) => <option key={m} value={m} />)}</datalist></label>
              {form.provider === 'custom' && (
                <label className="block"><span className="mb-1.5 block text-sm font-medium">Base URL</span>
                  <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className={input} placeholder="https://api.example.com/v1" /></label>
              )}
              {form.provider !== 'openrouter' && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="mb-1.5 block text-sm font-medium">Input $ / 1M tokens</span>
                    <input type="number" min="0" step="any" value={form.priceIn} onChange={(e) => setForm({ ...form, priceIn: e.target.value })} className={input} placeholder={knownPrice ? String(knownPrice.in) : 'e.g. 0.30'} /></label>
                  <label className="block"><span className="mb-1.5 block text-sm font-medium">Output $ / 1M tokens</span>
                    <input type="number" min="0" step="any" value={form.priceOut} onChange={(e) => setForm({ ...form, priceOut: e.target.value })} className={input} placeholder={knownPrice ? String(knownPrice.out) : 'e.g. 2.50'} /></label>
                  <p className="col-span-2 -mt-1 text-xs text-muted">{knownPrice ? 'Leave blank to use the list price shown.' : 'Copy these from the provider’s pricing page so Nova can work out the cost. Tokens are counted either way.'}</p>
                </div>
              )}
              <label className="block"><span className="mb-1.5 block text-sm font-medium">Name (optional)</span>
                <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={input} placeholder="e.g. Company Gemini key" /></label>
              <div className="flex gap-2">
                <button disabled={busy} className="h-11 rounded-full bg-cyan px-6 font-semibold text-cyan-ink disabled:opacity-60">{busy ? 'Testing the key…' : 'Test & use this AI'}</button>
                <button type="button" onClick={() => setForm(null)} className="h-11 rounded-full bg-card px-5 hover:bg-card-2">Cancel</button>
              </div>
            </form>
          )}
        </section>

        {/* Usage */}
        <section className="rounded-[24px] border border-line bg-panel p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Usage & cost</h2>
            <div className="flex gap-1 rounded-full bg-card p-1 text-sm" role="tablist" aria-label="Period">
              {[[1, 'Today'], [7, '7 days'], [30, '30 days'], [0, 'All']].map(([d, l]) => (
                <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d as number)}
                  className={`rounded-full px-3 py-1 ${days === d ? 'bg-cyan text-cyan-ink' : 'text-muted hover:text-fg'}`}>{l}</button>
              ))}
            </div>
          </div>

          {!usage ? <div className="h-64 animate-pulse rounded-2xl bg-card" /> : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label="Cost" value={usd(usage.total.costUsd)} note={usage.total.unpriced ? `${usage.total.unpriced} calls have no price set` : 'estimated from token prices'} />
                <Tile label="Requests" value={fmt(usage.total.requests)} note={usage.total.failed ? `${usage.total.failed} failed` : undefined} />
                <Tile label="Input tokens" value={compact(usage.total.inputTokens)} />
                <Tile label="Output tokens" value={compact(usage.total.outputTokens)} />
              </div>

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{metric === 'cost' ? 'Cost per day (USD)' : 'Tokens per day'}</h3>
                  <div className="flex gap-3 text-xs">
                    <button onClick={() => setMetric(metric === 'cost' ? 'tokens' : 'cost')} className="text-cyan hover:underline">Show {metric === 'cost' ? 'tokens' : 'cost'}</button>
                    <button onClick={() => setTable((t) => !t)} className="text-muted hover:text-fg">{table ? 'Show chart' : 'Show table'}</button>
                  </div>
                </div>
                {table ? (
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-medium">Day</th><th className="font-medium">Requests</th><th className="font-medium">Tokens</th><th className="text-right font-medium">Cost</th></tr></thead>
                      <tbody>{[...series].reverse().map((d) => (
                        <tr key={d.day} className="border-t border-line"><td className="py-1.5">{d.day}</td><td className="tabular-nums">{fmt(d.requests)}</td><td className="tabular-nums">{fmt(d.inputTokens + d.outputTokens)}</td><td className="text-right tabular-nums">{usd(d.costUsd)}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : <DailyChart days={series} metric={metric} />}
              </div>

              <div className="mt-6 grid gap-5 xl:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">By model</h3>
                  <table className="w-full text-sm">
                    <tbody>{usage.byModel.map((m) => (
                      <tr key={m.provider + m.model} className="border-t border-line">
                        <td className="py-2"><span className="block font-mono text-xs">{m.model}</span><span className="text-xs text-muted">{NAMES[m.provider as Provider] || m.provider} · {fmt(m.requests)} calls</span></td>
                        <td className="text-right text-xs tabular-nums text-muted">{compact(m.inputTokens + m.outputTokens)} tok</td>
                        <td className="w-20 text-right tabular-nums">{usd(m.costUsd)}</td>
                      </tr>
                    ))}{!usage.byModel.length && <tr><td className="py-2 text-sm text-muted">No AI calls in this period.</td></tr>}</tbody>
                  </table>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">By feature</h3>
                  <table className="w-full text-sm">
                    <tbody>{usage.byFeature.map((f) => (
                      <tr key={f.feature} className="border-t border-line">
                        <td className="py-2"><span className="block text-sm">{FEATURE[f.feature] || f.feature}</span><span className="text-xs text-muted">{fmt(f.requests)} calls</span></td>
                        <td className="text-right text-xs tabular-nums text-muted">{compact(f.inputTokens + f.outputTokens)} tok</td>
                        <td className="w-20 text-right tabular-nums">{usd(f.costUsd)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted">Tokens come from each AI provider’s response. Cost = tokens × the prices on your key (OpenRouter reports its own cost). Voice calls (Gemini Live in Voximplant) are not included.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
