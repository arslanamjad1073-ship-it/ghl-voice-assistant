-- Every data row must belong to an organization (a missing org_id now fails instead of creating an invisible row)
alter table public.subaccounts   alter column org_id set not null;
alter table public.llm_providers alter column org_id set not null;
alter table public.llm_usage     alter column org_id set not null;
alter table public.activities    alter column org_id set not null;
alter table public.followups     alter column org_id set not null;
alter table public.notifications alter column org_id set not null;
alter table public.call_sessions alter column org_id set not null;

-- plan 'internal' = may use the server's own GEMINI_API_KEY when no key is saved (the app owner's organization)
comment on column public.organizations.plan is 'trial | internal | paid plans later. internal may use the server GEMINI_API_KEY fallback';
