-- =============================================================================
-- 0100 — Scanner bridge.
--
-- The platform schema in this project was built first and is the one that
-- stays. This migration adds only what the scanner Worker and the salon book
-- need on top of it. It creates nothing that already exists and drops nothing
-- that does.
--
-- Two deliberate exceptions, both on scans, both because the scanner takes a
-- reading BEFORE it knows whose hand it is:
--   * client_id loses NOT NULL — an unclaimed reading is a real state
--   * image_raw_path loses NOT NULL — a demo scan has no stored original
-- =============================================================================

begin;

-- ------------------------------------------------------------------ scans --

alter table public.scans add column if not exists public_id text;
alter table public.scans alter column client_id drop not null;
alter table public.scans alter column image_raw_path drop not null;

create unique index if not exists scans_public_id_key
  on public.scans (public_id) where public_id is not null;

comment on column public.scans.public_id is
  'The id in the link she keeps. Stable for the life of the reading.';

-- ------------------------------------------------------------ scan detail --
--
-- The whole reading lives in scans.analysis, but a JSON blob cannot answer
-- "is this the same problem as last time, and is it getting better" without
-- reading every scan she has ever had. One row per finding can.

create table if not exists public.scan_findings (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  scan_id     uuid not null references public.scans(id) on delete cascade,
  code        text not null,
  fingers     text[] not null default '{}',
  zone        text not null default 'whole',
  severity    text not null default 'mild',
  is_positive boolean not null default false,
  observed_at timestamptz not null default now(),
  unique (scan_id, code, zone)
);
create index if not exists scan_findings_tenant_code_idx
  on public.scan_findings (tenant_id, code, observed_at desc);

create table if not exists public.scan_flags (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  scan_id     uuid not null references public.scans(id) on delete cascade,
  code        text not null,
  observed_at timestamptz not null default now(),
  unique (scan_id, code)
);

create table if not exists public.scan_photos (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  scan_id      uuid not null references public.scans(id) on delete cascade,
  kind         text not null default 'capture',
  storage      text not null default 'r2',
  path         text not null,
  public_url   text,
  content_type text,
  taken_at     timestamptz not null default now(),
  unique (storage, path)
);

create table if not exists public.care_milestones (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  scan_id      uuid not null references public.scans(id) on delete cascade,
  client_id    uuid references public.clients(id) on delete cascade,
  due_on       date not null,
  label        text not null,
  sub          text,
  kind         text not null default 'check',
  service_slug text,
  is_primary   boolean not null default false,
  status       text not null default 'pending'
);
create index if not exists care_milestones_due_idx
  on public.care_milestones (tenant_id, status, due_on);

-- ----------------------------------------------------------- tenant hosts --
--
-- tenants.custom_domain holds one hostname. A salon in practice answers on
-- several — ours, theirs, and whatever they had before — and the hostname a
-- scan arrives on is what decides whose book it lands in, so it needs to be a
-- list with one primary rather than a single column.

create table if not exists public.tenant_hosts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  host        text not null,
  is_primary  boolean not null default false,
  verified_at timestamptz,
  archived_at timestamptz
);
create unique index if not exists tenant_hosts_host_key
  on public.tenant_hosts (lower(host)) where archived_at is null;
create unique index if not exists tenant_hosts_one_primary
  on public.tenant_hosts (tenant_id) where is_primary and archived_at is null;

-- carry over whatever custom_domain already says, once
insert into public.tenant_hosts (tenant_id, host, is_primary, verified_at)
select t.id, lower(t.custom_domain), true, now()
from public.tenants t
where t.custom_domain is not null and t.custom_domain <> ''
  and not exists (select 1 from public.tenant_hosts h
                   where lower(h.host) = lower(t.custom_domain));

commit;
