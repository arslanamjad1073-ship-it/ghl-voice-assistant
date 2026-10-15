import { NextResponse } from 'next/server';
import { requireUser, isAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { callProvider, clearProviderCache, DEFAULT_MODELS, KNOWN_PRICES, type Provider, type ProviderConfig } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROVIDERS: Provider[] = ['gemini', 'openai', 'anthropic', 'openrouter', 'custom'];
const COLS = 'id,provider,label,api_key,model,base_url,price_in_per_m,price_out_per_m,is_active,updated_at';
const hint = (k: string) => (k ? '••••' + k.slice(-4) : '');
const num = (v: unknown) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));

function toPublic(r: Record<string, unknown>) {
  const { api_key, ...rest } = r;
  return { ...rest, key_hint: hint(String(api_key || '')) };
}

// GET -> saved providers (keys masked), whether the env Gemini key is the fallback, known prices
export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const { data } = await supabaseAdmin().from('llm_providers').select(COLS).order('created_at');
  return NextResponse.json({
    items: (data || []).map(toPublic),
    envFallback: !!process.env.GEMINI_API_KEY,
    canManage: isAdmin(auth.user.email),
    defaults: DEFAULT_MODELS,
    knownPrices: KNOWN_PRICES
  });
}

// POST { id?, provider, label?, apiKey?, model, baseUrl?, priceIn?, priceOut?, activate? }
// Tests the key with a tiny request, then saves it (and makes it active when asked).
export async function POST(req: Request) {
  const auth = await requireUser({ admin: true });
  if (auth.error) return auth.error;
  const b = await req.json().catch(() => ({}));
  const db = supabaseAdmin();
  const provider = String(b.provider || '') as Provider;
  if (!PROVIDERS.includes(provider)) return NextResponse.json({ error: 'Choose a provider' }, { status: 400 });
  const model = String(b.model || '').trim();
  if (!model) return NextResponse.json({ error: 'Enter a model name' }, { status: 400 });
  const baseUrl = String(b.baseUrl || '').trim();
  if (provider === 'custom' && !/^https?:\/\//.test(baseUrl)) return NextResponse.json({ error: 'Enter the base URL, e.g. https://api.example.com/v1' }, { status: 400 });

  let apiKey = String(b.apiKey || '').trim();
  if (!apiKey && b.id) {
    const { data } = await db.from('llm_providers').select('api_key').eq('id', b.id).maybeSingle();
    apiKey = data?.api_key || '';
  }
  if (!apiKey) return NextResponse.json({ error: 'Paste the API key' }, { status: 400 });

  const cfg: ProviderConfig = { provider, apiKey, model, baseUrl };
  try {
    await callProvider(cfg, 'You are a connection test.', [{ role: 'user', text: 'Reply with the word OK.' }], { temperature: 0 });
  } catch (e) {
    return NextResponse.json({ error: 'The key did not work: ' + (e as Error).message }, { status: 400 });
  }

  const row = {
    provider, model, api_key: apiKey, base_url: provider === 'custom' ? baseUrl : null, label: String(b.label || '').trim() || null,
    price_in_per_m: num(b.priceIn), price_out_per_m: num(b.priceOut), updated_by: auth.user.id, updated_at: new Date().toISOString()
  };
  let id = Number(b.id) || 0;
  if (id) {
    const { error } = await db.from('llm_providers').update(row).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { data, error } = await db.from('llm_providers').insert(row).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    id = data.id;
  }
  if (b.activate !== false) {
    await db.from('llm_providers').update({ is_active: false }).eq('is_active', true).neq('id', id);
    await db.from('llm_providers').update({ is_active: true }).eq('id', id);
  }
  clearProviderCache();
  return NextResponse.json({ ok: true, id });
}

// PATCH { id, activate: true } -> switch the active provider
export async function PATCH(req: Request) {
  const auth = await requireUser({ admin: true });
  if (auth.error) return auth.error;
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const db = supabaseAdmin();
  await db.from('llm_providers').update({ is_active: false }).eq('is_active', true).neq('id', id);
  const { error } = await db.from('llm_providers').update({ is_active: true }).eq('id', id);
  clearProviderCache();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE ?id=
export async function DELETE(req: Request) {
  const auth = await requireUser({ admin: true });
  if (auth.error) return auth.error;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  await supabaseAdmin().from('llm_providers').delete().eq('id', id);
  clearProviderCache();
  return NextResponse.json({ ok: true });
}
