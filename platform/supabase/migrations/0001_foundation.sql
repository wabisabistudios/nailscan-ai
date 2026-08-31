-- =============================================================================
-- 0001 — Foundation: extensions, tenancy, staff, shared conventions.
--
-- Conventions that hold across every migration in this folder:
--
--   * Money is integer cents. Never float, never numeric-with-scale-drift.
--   * Phone numbers are E.164 and validated by CHECK. There is exactly one
--     format in the database; normalisation happens at the edge, once.
--   * Nothing is hard-deleted. Rows carry archived_at / deleted_at and drop out
--     of the default views. A salon that loses a client's history because a
--     technician mis-tapped is a salon that cannot be trusted with the history.
--   * "Today" is a tenant-timezone question, never the server's. Every table
--     that answers it stores a timestamptz and resolves against tenants.timezone.
--   * Mutations that a flaky iPad connection might send twice carry a
--     client-supplied idempotency key.
-- =============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive email

-- ---------------------------------------------------------------- helpers --

-- Touch updated_at on every UPDATE. Attached per-table at the end of each file.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- E.164, the only phone shape this database accepts.
--   +  country digit (never 0)  then 6..14 more digits
create domain public.phone_e164 as text
  check (value is null or value ~ '^\+[1-9]\d{6,14}$');

-- ---------------------------------------------------------------- tenants --

-- One row per salon. Based Aesthetics is a tenant like any other — the studio
-- runs on the same platform it sells, which is the only way the product stays
-- honest.
create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
                  check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  name          text not null check (length(btrim(name)) between 1 and 120),

  -- Everything time- and format-sensitive resolves against these, never the
  -- server's locale. A salon in Chennai and one in Toronto both get their own
  -- "today", their own currency, and their own default dial code.
  timezone      text not null default 'America/Toronto',
  locale        text not null default 'en-US',
  currency      char(3) not null default 'USD',
  phone_country char(2) not null default 'US',

  -- White-label surface: wordmark, palette, booking links. Read by the salon
  -- app and by the scanner's config endpoint. Never contains secrets.
  brand         jsonb not null default '{}'::jsonb,

  status        text not null default 'active'
                  check (status in ('trial','active','past_due','paused','closed')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

comment on table public.tenants is
  'One salon. Tenant isolation is enforced by RLS on every table that carries tenant_id.';

create index tenants_active_idx on public.tenants (slug) where archived_at is null;

create trigger tenants_touch before update on public.tenants
  for each row execute function public.touch_updated_at();

-- A CHECK cannot call now(), and an unknown timezone would only surface later
-- as a wrong "today" on somebody's dashboard. Validate it at write time against
-- the server's own tz database instead.
create or replace function public.assert_known_timezone()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'unknown timezone %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger tenants_timezone_valid before insert or update of timezone on public.tenants
  for each row execute function public.assert_known_timezone();

-- ------------------------------------------------------------ staff seats --

-- A person who works at a salon. Identity lives in auth.users; this row is the
-- membership and the role. A staff member can hold seats at more than one
-- tenant (a tech who covers two locations) — hence the composite unique.
create table public.tenant_members (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  user_id       uuid not null references auth.users(id) on delete restrict,

  role          text not null default 'tech'
                  check (role in ('owner','manager','tech','front_desk')),
  display_name  text not null check (length(btrim(display_name)) between 1 and 80),

  -- Shown on the visit builder as the technician chip.
  initials      text check (initials ~ '^[A-Z]{1,3}$'),
  color         text check (color ~ '^#[0-9a-fA-F]{6}$'),

  status        text not null default 'active'
                  check (status in ('invited','active','suspended')),

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,

  unique (tenant_id, user_id)
);

comment on table public.tenant_members is
  'Staff seat. Role decides what RLS lets this person see and change inside one tenant.';

create index tenant_members_tenant_idx on public.tenant_members (tenant_id)
  where archived_at is null;
create index tenant_members_user_idx on public.tenant_members (user_id)
  where archived_at is null;

create trigger tenant_members_touch before update on public.tenant_members
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------- platform admins --

-- NailScan HQ. Deliberately its own tiny table rather than a role string on a
-- user: granting HQ access should be a visible, auditable INSERT, not a typo in
-- an enum.
create table public.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete restrict,
  label       text not null default 'HQ',
  created_at  timestamptz not null default now()
);

comment on table public.platform_admins is
  'NailScan HQ operators. Membership here crosses tenant boundaries — keep it short.';
