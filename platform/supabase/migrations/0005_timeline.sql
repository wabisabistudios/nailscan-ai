-- =============================================================================
-- 0005 — Timeline and audit.
--
-- client_events is the one table the client file reads to draw its story. Every
-- other table writes an event when something happens to a client; the file
-- renders events in time order and never has to UNION six tables to do it.
--
-- audit_log is the other half of "enterprise": not what happened to the client,
-- but who looked and who changed it. A salon holding photographs of people's
-- hands should be able to answer that question.
-- =============================================================================

create table public.client_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  client_id   uuid not null references public.clients(id) on delete restrict,

  at          timestamptz not null default now(),
  kind        text not null check (kind in (
                'client_created','client_merged',
                'scan','flag_raised','flag_acknowledged',
                'visit_booked','visit_settled','visit_cancelled','visit_no_show','redo',
                'photo','note','consent',
                'milestone_due','milestone_met','milestone_missed',
                'call','message','portal_login')),

  -- Human-readable, written once, never recomputed. The timeline must still
  -- read correctly in two years when the copy bank has moved on.
  title       text not null check (length(btrim(title)) between 1 and 200),
  detail      text check (length(detail) <= 1000),

  -- What this event points at, so a row can open the thing it describes.
  ref_table   text check (length(ref_table) <= 40),
  ref_id      uuid,

  actor_id    uuid references auth.users(id) on delete set null,
  actor_label text check (length(actor_label) <= 80),   -- 'Maya (AI caller)', 'Front desk'

  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.client_events is
  'Append-only client timeline. The client file is a read of this table, in order.';

create index client_events_client_idx on public.client_events (client_id, at desc);
create index client_events_tenant_idx on public.client_events (tenant_id, at desc);
create index client_events_kind_idx   on public.client_events (tenant_id, kind, at desc);

-- An event that points at a specific row may exist exactly once for that row.
--
-- The Worker retries. A lead POST that times out on the client and is re-sent,
-- or an attach that races its own ingest, must not leave the salon looking at
-- the same reading listed twice on the same day. Free-standing events (a note,
-- a call) carry no ref_id and are not constrained.
create unique index client_events_ref_uniq
  on public.client_events (client_id, kind, ref_table, ref_id)
  where ref_id is not null;

-- Append-only means append-only. No UPDATE, no DELETE, enforced rather than
-- documented.
create or replace function public.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

create trigger client_events_no_update before update on public.client_events
  for each row execute function public.reject_mutation();
create trigger client_events_no_delete before delete on public.client_events
  for each row execute function public.reject_mutation();

create trigger client_consents_no_update before update on public.client_consents
  for each row execute function public.reject_mutation();
create trigger client_consents_no_delete before delete on public.client_consents
  for each row execute function public.reject_mutation();

-- ------------------------------------------------------------- audit log --

create table public.audit_log (
  id          bigint generated always as identity primary key,
  tenant_id   uuid references public.tenants(id) on delete restrict,

  at          timestamptz not null default now(),
  actor_id    uuid references auth.users(id) on delete set null,
  actor_role  text check (length(actor_role) <= 40),

  action      text not null check (action in ('read','create','update','archive','merge','export','login','grant','revoke')),
  entity      text not null check (length(entity) <= 40),
  entity_id   uuid,

  -- Only for the actions where it matters: what changed, not the whole row.
  diff        jsonb,
  ip          inet,
  user_agent  text check (length(user_agent) <= 400),

  created_at  timestamptz not null default now()
);

comment on table public.audit_log is
  'Who read or changed what. Append-only. Photographs of people''s hands deserve this.';

create index audit_log_tenant_idx on public.audit_log (tenant_id, at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);
create index audit_log_actor_idx  on public.audit_log (actor_id, at desc);

create trigger audit_log_no_update before update on public.audit_log
  for each row execute function public.reject_mutation();
create trigger audit_log_no_delete before delete on public.audit_log
  for each row execute function public.reject_mutation();
