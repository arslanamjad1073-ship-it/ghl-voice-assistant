-- Nova voice assistant: sub-accounts, call sessions and activity history.
-- All tables have RLS enabled with no policies: only the server (service role key)
-- can read or write them. The browser never queries these tables directly, so the
-- GHL tokens in public.subaccounts are never exposed to it.

create extension if not exists pgcrypto;

-- GHL sub-accounts Nova can work in
create table if not exists public.subaccounts (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  location_id         text not null unique,
  ghl_token           text not null,                 -- GHL Private Integration token for this sub-account
  timezone            text not null default 'UTC',   -- IANA name, e.g. Asia/Karachi
  currency            text not null default 'USD',
  invoice_live_mode   boolean not null default true,
  invoice_sender_name text,
  notify_webhook_url  text,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One row per call started from the web app. The scenario uses the token to load
-- the sub-account settings and to report activity.
create table if not exists public.call_sessions (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,
  user_id       uuid references auth.users (id) on delete set null,
  user_email    text,
  user_name     text,
  subaccount_id uuid references public.subaccounts (id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index if not exists call_sessions_user_idx on public.call_sessions (user_id, created_at desc);

-- Everything Nova did: what, when, who, in which sub-account
create table if not exists public.activities (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  session_id     uuid references public.call_sessions (id) on delete set null,
  subaccount_id  uuid references public.subaccounts (id) on delete set null,
  subaccount_name text,
  user_id        uuid references auth.users (id) on delete set null,
  user_email     text,
  user_name      text,
  action         text not null,          -- tool name, e.g. add_tag
  status         text not null default 'success' check (status in ('success', 'error')),
  message        text not null,          -- e.g. Tag "VIP" added to contact "John Smith"
  contact_id     text,
  contact_name   text,
  details        jsonb
);
create index if not exists activities_created_idx on public.activities (created_at desc);
create index if not exists activities_subaccount_idx on public.activities (subaccount_id, created_at desc);
create index if not exists activities_session_idx on public.activities (session_id);

alter table public.subaccounts   enable row level security;
alter table public.call_sessions enable row level security;
alter table public.activities    enable row level security;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as 'begin new.updated_at = now(); return new; end';

create or replace trigger subaccounts_touch before update on public.subaccounts
  for each row execute function public.touch_updated_at();
