-- Per-user alert choices: sub-accounts this user does not want alerts (bell + push) for
alter table public.user_state add column if not exists muted_subaccounts uuid[] not null default '{}';
