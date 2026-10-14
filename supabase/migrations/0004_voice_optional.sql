-- Voice (Voximplant) is an optional add-on per sub-account; prompts are the default way to use Nova
alter table public.subaccounts add column if not exists voice_enabled boolean not null default false;
