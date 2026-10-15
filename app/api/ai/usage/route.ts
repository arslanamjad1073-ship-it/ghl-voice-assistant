import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

interface Row { created_at: string; provider: string; model: string; feature: string | null; input_tokens: number; output_tokens: number; cost_usd: number | string | null; ok: boolean }
interface Agg { requests: number; failed: number; inputTokens: number; outputTokens: number; costUsd: number; unpriced: number }
const empty = (): Agg => ({ requests: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0 });
function add(a: Agg, r: Row) {
  a.requests++; if (!r.ok) a.failed++;
  a.inputTokens += r.input_tokens || 0; a.outputTokens += r.output_tokens || 0;
  if (r.cost_usd === null || r.cost_usd === undefined) { if (r.ok) a.unpriced++; } else a.costUsd += Number(r.cost_usd);
}

// GET ?days=1|7|30|0(all) -> totals, per model, per feature, per day
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const days = Number(new URL(req.url).searchParams.get('days') ?? 30);
  let q = supabaseAdmin().from('llm_usage').select('created_at,provider,model,feature,input_tokens,output_tokens,cost_usd,ok')
    .order('created_at', { ascending: true }).limit(50000);
  if (days > 0) q = q.gte('created_at', new Date(Date.now() - days * 86400000).toISOString());
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const total = empty();
  const byModel: Record<string, Agg & { provider: string; model: string }> = {};
  const byFeature: Record<string, Agg> = {};
  const byDay: Record<string, Agg> = {};
  for (const r of (data || []) as Row[]) {
    add(total, r);
    const mk = r.provider + ':' + r.model;
    add(byModel[mk] ||= { ...empty(), provider: r.provider, model: r.model }, r);
    add(byFeature[r.feature || 'other'] ||= empty(), r);
    add(byDay[r.created_at.slice(0, 10)] ||= empty(), r);
  }
  return NextResponse.json({
    total,
    byModel: Object.values(byModel).sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests),
    byFeature: Object.entries(byFeature).map(([feature, a]) => ({ feature, ...a })).sort((a, b) => b.requests - a.requests),
    byDay: Object.entries(byDay).map(([day, a]) => ({ day, ...a }))
  });
}
