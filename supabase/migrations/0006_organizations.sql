-- SaaS layer: organizations (the business that bought Nova), members with roles and permissions,
-- per-member sub-account access, and invites. Every data table gets the owning organization.
-- All tables keep RLS on with no policies: only the server (service role) reads them, and the
-- server checks the member's organization, permissions and sub-account access on every request.

create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid references auth.users (id) on delete set null,
  plan       text not null default 'trial',
  active_llm_provider_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  email           text,
  name            text,
  role            text not null check (role in ('owner', 'admin', 'user')),
  permissions     text[] not null default '{}',   -- manage_subaccounts, manage_ai, view_usage, manage_branding, manage_team
  all_subaccounts boolean not null default false, -- true = every sub-account of the organization
  status          text not null default 'active' check (status in ('active', 'disabled')),
  invited_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists memberships_one_org_per_user on public.memberships (user_id);
create unique index if not exists memberships_one_owner on public.memberships (org_id) where role = 'owner';
create index if not exists memberships_org_idx on public.memberships (org_id);

create table if not exists public.member_subaccounts (
  membership_id uuid not null references public.memberships (id) on delete cascade,
  subaccount_id uuid not null references public.subaccounts (id) on delete cascade,
  primary key (membership_id, subaccount_id)
);

create table if not exists public.invites (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id) on delete cascade,
  email           text not null,
  name            text,
  role            text not null check (role in ('admin', 'user')),
  permissions     text[] not null default '{}',
  all_subaccounts boolean not null default false,
  subaccount_ids  uuid[] not null default '{}',
  token           text not null unique,
  invited_by      uuid references auth.users (id) on delete set null,
  invited_by_name text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  revoked_at      timestamptz
);
create index if not exists invites_org_idx on public.invites (org_id, created_at desc);

alter table public.organizations      enable row level security;
alter table public.memberships        enable row level security;
alter table public.member_subaccounts enable row level security;
alter table public.invites            enable row level security;

create or replace trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();
create or replace trigger memberships_touch before update on public.memberships
  for each row execute function public.touch_updated_at();

-- Owning organization on every data table
alter table public.subaccounts   add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.llm_providers add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.llm_usage     add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.activities    add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.followups     add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.notifications add column if not exists org_id uuid references public.organizations (id) on delete cascade;
alter table public.call_sessions add column if not exists org_id uuid references public.organizations (id) on delete cascade;

create index if not exists subaccounts_org_idx   on public.subaccounts (org_id);
create index if not exists llm_providers_org_idx on public.llm_providers (org_id);
create index if not exists llm_usage_org_idx     on public.llm_usage (org_id, created_at desc);
create index if not exists activities_org_idx    on public.activities (org_id, created_at desc);
create index if not exists followups_org_idx     on public.followups (org_id, created_at desc);
create index if not exists notifications_org_idx on public.notifications (org_id, created_at desc);

-- Existing single-team data: becomes the first organization, owned by the earliest user
do $$
declare o uuid; u uuid;
begin
  if exists (select 1 from public.subaccounts where org_id is null) or exists (select 1 from public.llm_providers where org_id is null)
     or exists (select 1 from public.activities where org_id is null) then
    select id into u from auth.users order by created_at limit 1;
    insert into public.organizations (name, owner_id, active_llm_provider_id)
      values ('My organization', u, (select id from public.llm_providers where is_active limit 1)) returning id into o;
    if u is not null then
      insert into public.memberships (org_id, user_id, email, name, role, all_subaccounts)
        select o, au.id, au.email, coalesce(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)), 'owner', true
        from auth.users au where au.id = u
        on conflict do nothing;
    end if;
    update public.subaccounts   set org_id = o where org_id is null;
    update public.llm_providers set org_id = o where org_id is null;
    update public.llm_usage     set org_id = o where org_id is null;
    update public.activities    set org_id = o where org_id is null;
    update public.followups     set org_id = o where org_id is null;
    update public.notifications set org_id = o where org_id is null;
    update public.call_sessions set org_id = o where org_id is null;
  end if;
end $$;

-- The active AI key is now chosen per organization (organizations.active_llm_provider_id);
-- the old global is_active flag is no longer used.
update public.llm_providers set is_active = false where is_active;
