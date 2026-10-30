import { NextResponse } from 'next/server';
import { requireAccess, can } from '@/lib/access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { callProvider, assertPublicUrl, clearProviderCache, DEFAULT_MODELS, KNOWN_PRICES, type Provider, type ProviderConfig } from '@/lib/llm';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROVIDERS: Provider[] = ['gemini', 'openai', 'anthropic', 'openrouter', 'custom'];
const COLS = 'id,provider,label,api_key,model,base_url,price_in_per_m,price_out_per_m,updated_at';
const hint = (k: string) => (k ? '••••' + k.slice(-4) : '');
const num = (v: unknown) => (v === '' || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v));

function toPublic(r: Record<string, unknown>, activeId: number | null) {
  const { api_key, ...rest } = r;
  return { ...rest, is_active: r.id === activeId, key_hint: hint(String(api_key || '')) };
}

async function activeId(orgId: string) {
  const { data } = await supabaseAdmin().from('organizations').select('active_llm_provider_id').eq('id', orgId).maybeSingle();
  return (data?.active_llm_provider_id as number | null) ?? null;
}
async function sharedKeyAllowed(orgId: string) {
  if (!process.env.GEMINI_API_KEY) return false;
  const { data } = await supabaseAdmin().from('organizations').select('plan').eq('id', orgId).maybeSingle();
  return data?.plan === 'internal';
}
async function setActive(orgId: string, id: number | null) {
  await supabaseAdmin().from('organizations').update({ active_llm_provider_id: id }).eq('id', orgId);
  clearProviderCache(orgId);
}

// GET -> this organization's saved providers (keys masked). Members without the AI keys permission
// only see which AI is active.
export async function GET() {
  const auth = await requireAccess();
  if (auth.error) return auth.error;
  const { access } = auth;
  const canManage = can(access, 'manage_ai');
  if (!canManage && !can(access, 'view_usage')) return NextResponse.json({ error: 'You do not have permission for this. Ask the owner.' }, { status: 403 });
  const act = await activeId(access.orgId);
  const { data } = await supabaseAdmin().from('llm_providers').select(COLS).eq('org_id', access.orgId).order('created_at');
  const items = (data || []).map((r) => toPublic(r, act));
  return NextResponse.json({
    items: canManage ? items : items.filter((i) => i.is_active).map(({ key_hint: _k, ...i }) => ({ ...i, key_hint: '' })),
    envFallback: await sharedKeyAllowed(access.orgId),
    canManage,
    canViewUsage: can(access, 'view_usage'),
    defaults: DEFAULT_MODELS,
    knownPrices: KNOWN_PRICES
  });
}

// POST { id?, provider, label?, apiKey?, model, baseUrl?, priceIn?, priceOut?, activate? }
// Tests the key with a tiny request, then saves it (and makes it active when asked).
export async function POST(req: Request) {
  const auth = await requireAccess({ perm: 'manage_ai' });
  if (auth.error) return auth.error;
  const { access } = auth;
  const b = await req.json().catch(() => ({}));
  const db = supabaseAdmin();
  const provider = String(b.provider || '') as Provider;
  if (!PROVIDERS.includes(provider)) return NextResponse.json({ error: 'Choose a provider' }, { status: 400 });
  const model = String(b.model || '').trim();
  if (!model) return NextResponse.json({ error: 'Enter a model name' }, { status: 400 });
  const baseUrl = String(b.baseUrl || '').trim();
  if (provider === 'custom') {
    try { await assertPublicUrl(baseUrl); } catch (e) { return NextResponse.json({ error: (e as Error).message + ', e.g. https://api.example.com/v1' }, { status: 400 }); }
  }

  let apiKey = String(b.apiKey || '').trim();
  if (!apiKey && b.id) {
    const { data } = await db.from('llm_providers').select('api_key').eq('id', b.id).eq('org_id', access.orgId).maybeSingle();
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
    price_in_per_m: num(b.priceIn), price_out_per_m: num(b.priceOut), updated_by: access.user.id, updated_at: new Date().toISOString()
  };
  let id = Number(b.id) || 0;
  if (id) {
    const { data, error } = await db.from('llm_providers').update(row).eq('id', id).eq('org_id', access.orgId).select('id');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) return NextResponse.json({ error: 'Key not found' }, { status: 404 });
  } else {
    const { data, error } = await db.from('llm_providers').insert({ ...row, org_id: access.orgId }).select('id').single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    id = data.id;
  }
  if (b.activate !== false) await setActive(access.orgId, id);
  clearProviderCache(access.orgId);
  return NextResponse.json({ ok: true, id });
}

// PATCH { id, activate: true } -> switch the active provider
export async function PATCH(req: Request) {
  const auth = await requireAccess({ perm: 'manage_ai' });
  if (auth.error) return auth.error;
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const { data } = await supabaseAdmin().from('llm_providers').select('id').eq('id', id).eq('org_id', auth.access.orgId).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Key not found' }, { status: 404 });
  await setActive(auth.access.orgId, data.id);
  return NextResponse.json({ ok: true });
}

// DELETE ?id=
export async function DELETE(req: Request) {
  const auth = await requireAccess({ perm: 'manage_ai' });
  if (auth.error) return auth.error;
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if ((await activeId(auth.access.orgId)) === id) await setActive(auth.access.orgId, null);
  await supabaseAdmin().from('llm_providers').delete().eq('id', id).eq('org_id', auth.access.orgId);
  clearProviderCache(auth.access.orgId);
  return NextResponse.json({ ok: true });
}
