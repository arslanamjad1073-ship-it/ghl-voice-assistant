-- Follow-ups, inbound-message notifications (in-app + web push) and per-sub-account email branding.
-- Same model as 0001: RLS on, no policies, only the server (service role) touches these tables.

-- Email branding settings and the key used in the GHL "Customer Replied" webhook URL
alter table public.subaccounts add column if not exists email_branding jsonb not null default '{}'::jsonb;
alter table public.subaccounts add column if not exists webhook_key text not null default replace(gen_random_uuid()::text, '-', '');
create unique index if not exists subaccounts_webhook_key_idx on public.subaccounts (webhook_key);

-- Follow-up messages sent from the Leads page
create table if not exists public.followups (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  subaccount_id  uuid references public.subaccounts (id) on delete set null,
  subaccount_name text,
  contact_id     text not null,
  contact_name   text,
  channel        text not null check (channel in ('sms', 'email', 'facebook', 'instagram')),
  subject        text,
  body           text not null,
  ai_suggested   boolean not null default false,
  edited         boolean not null default false,
  status         text not null default 'sent' check (status in ('sent', 'failed')),
  error          text,
  ghl_message_id text,
  user_id        uuid references auth.users (id) on delete set null,
  user_email     text,
  user_name      text
);
create index if not exists followups_contact_idx on public.followups (subaccount_id, contact_id, created_at desc);

-- One row per inbound message reported by a GHL workflow webhook
create table if not exists public.notifications (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  subaccount_id  uuid references public.subaccounts (id) on delete cascade,
  subaccount_name text,
  contact_id     text,
  contact_name   text,
  channel        text,
  preview        text,
  dedupe_key     text unique
);
create index if not exists notifications_created_idx on public.notifications (created_at desc);

-- Browser push subscriptions (one per device/browser per user)
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text
);

-- Per-user "notifications read up to" marker
create table if not exists public.user_state (
  user_id               uuid primary key references auth.users (id) on delete cascade,
  notifications_read_at timestamptz not null default to_timestamp(0)
);

alter table public.followups          enable row level security;
alter table public.notifications      enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.user_state         enable row level security;
