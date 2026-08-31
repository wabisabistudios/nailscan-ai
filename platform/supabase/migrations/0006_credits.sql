-- =============================================================================
-- 0006 — Credits.
--
-- Improvement reports cost real money per generation, so they are metered. HQ
-- grants credits; the salon spends them. The balance is never a column that
-- gets incremented — it is the sum of an append-only ledger, so a double-spend
-- is impossible to hide and a dispute is answerable by reading rows.
-- =============================================================================

create table public.credit_ledger (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenants(id) on delete restrict,

  -- Positive = granted, negative = spent. No other shape.
  delta          integer not null check (delta <> 0),
  reason         text not null check (reason in (
                   'hq_grant','plan_monthly','topup_purchase','trial',
                   'report_generated','scan_analysis','adjustment','refund','expiry')),

  -- What consumed it, when something did.
  ref_table      text check (length(ref_table) <= 40),
  ref_id         uuid,

  note           text check (length(note) <= 400),
  actor_id       uuid references auth.users(id) on delete set null,

  -- Same key, same row. A retried spend does not spend twice.
  idempotency_key text,

  at             timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

comment on table public.credit_ledger is
  'Append-only credit movements. Balance is a SUM, never a stored counter.';

create unique index credit_ledger_idempotency_uniq
  on public.credit_ledger (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index credit_ledger_tenant_idx on public.credit_ledger (tenant_id, at desc);

create trigger credit_ledger_no_update before update on public.credit_ledger
  for each row execute function public.reject_mutation();
create trigger credit_ledger_no_delete before delete on public.credit_ledger
  for each row execute function public.reject_mutation();

-- Current balance, read by the credit widget in the salon app.
create or replace function public.credit_balance(p_tenant uuid)
returns integer
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(sum(delta), 0)::integer
  from public.credit_ledger
  where tenant_id = p_tenant;
$$;
