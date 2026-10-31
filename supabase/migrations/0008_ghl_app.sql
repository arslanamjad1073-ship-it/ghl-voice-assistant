-- Nova's GHL Marketplace app: one row per installed location. Installing the app is what turns on
-- message alerts (GHL sends InboundMessage events to /api/webhooks/ghl-app). Tokens are kept for
-- future use of the app instead of Private Integration tokens; server only.
create table if not exists public.ghl_app_installs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  subaccount_id uuid not null references public.subaccounts (id) on delete cascade,
  location_id   text not null unique,
  company_id    text,
  user_type     text,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  scopes        text,
  status        text not null default 'active' check (status in ('active', 'disconnected', 'uninstalled')),
  installed_by  uuid references auth.users (id) on delete set null,
  last_event_at timestamptz,
  checked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ghl_app_installs_org_idx on public.ghl_app_installs (org_id);
alter table public.ghl_app_installs enable row level security;

create or replace trigger ghl_app_installs_touch before update on public.ghl_app_installs
  for each row execute function public.touch_updated_at();
