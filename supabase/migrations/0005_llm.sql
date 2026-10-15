-- LLM provider keys (one active) and per-call token usage/cost. Server-only (RLS on, no policies).
create table if not exists public.llm_providers (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('gemini','openai','anthropic','openrouter','custom')),
  label text,
  api_key text not null,
  model text not null,
  base_url text,
  price_in_per_m numeric,
  price_out_per_m numeric,
  is_active boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists llm_providers_one_active on public.llm_providers (is_active) where is_active;

create table if not exists public.llm_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  provider text not null,
  model text not null,
  feature text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric,
  user_id uuid references auth.users (id) on delete set null,
  subaccount_id uuid references public.subaccounts (id) on delete set null,
  ok boolean not null default true
);
create index if not exists llm_usage_created_idx on public.llm_usage (created_at desc);

alter table public.llm_providers enable row level security;
alter table public.llm_usage enable row level security;
