-- =============================================================================
-- 0011 — Who a hostname belongs to, and what that salon has configured.
--
-- Until now one deployment served one salon, because TENANT_SLUG was a single
-- environment variable. This is what lets one deployment serve all of them:
-- the request's hostname decides whose book a scan lands in.
--
-- Two rules, and the whole security of multi-tenancy rests on them:
--
--   1. The tenant is resolved from the HOSTNAME, server-side, and never from
--      anything the caller sends. The Worker holds a service key that bypasses
--      row-level security, so a tenant taken from a request body would let a
--      crafted call write into another salon's book. There is no code path in
--      this schema that accepts one.
--
--   2. A host belongs to exactly one salon, enforced by a unique index rather
--      than by application care.
--
-- Nothing here is required. A deployment that never inserts a domain row keeps
-- behaving exactly as it does today.
-- =============================================================================

-- ------------------------------------------------------------- domains --
--
-- A salon may hold several: the subdomain we start them on, and their own
-- domain once they move to it. Both keep resolving, which is the point — the
-- report links their clients already hold must never break, including after
-- the salon leaves us.

create table public.tenant_domains (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,

  -- Lowercase, no port, no scheme. The Worker normalises before it looks up.
  host        text not null
                check (host = lower(host) and host ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),

  -- The one that mints report_url. Her saved links are built from this, so
  -- moving it is a decision, not a toggle.
  is_primary  boolean not null default false,

  -- Set once DNS actually points here. Unverified rows still resolve — the
  -- flag is for the HQ screen to show, not a gate.
  verified_at timestamptz,

  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

comment on table public.tenant_domains is
  'Hostname to salon. The only thing a scanner request is allowed to resolve a tenant from.';

create unique index tenant_domains_host_uniq
  on public.tenant_domains (host) where archived_at is null;

-- Exactly one primary per salon, enforced rather than hoped for.
create unique index tenant_domains_one_primary
  on public.tenant_domains (tenant_id) where is_primary and archived_at is null;

create index tenant_domains_tenant_idx on public.tenant_domains (tenant_id) where archived_at is null;

-- ------------------------------------------------------------ settings --
--
-- The salon's own plumbing: where their leads go, where their clients book.
-- Separate from tenants.brand because brand is cosmetic and this is not.

create table public.tenant_settings (
  tenant_id        uuid primary key references public.tenants(id) on delete restrict,

  -- Their CRM, not ours. A salon that wants leads in their own GoHighLevel
  -- gets that; unset, the Worker's own webhook is used.
  ghl_webhook_url  text check (ghl_webhook_url is null or ghl_webhook_url ~ '^https://'),

  booking_url      text check (booking_url is null or booking_url ~ '^https://'),
  cross_link_url   text check (cross_link_url is null or cross_link_url ~ '^https://'),
  cross_link_label text check (length(cross_link_label) <= 60),
  support_email    citext,

  -- Free-shaped, for the things a salon tunes that do not deserve a column
  -- yet: lighting-gate thresholds, capture size, event lead days.
  overrides        jsonb not null default '{}'::jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.tenant_settings is
  'Per-salon plumbing: their CRM destination and booking links. Owner-editable, HQ-visible.';

create trigger tenant_settings_touch before update on public.tenant_settings
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------ RLS --

alter table public.tenant_domains  enable row level security;
alter table public.tenant_settings enable row level security;

create policy domains_read on public.tenant_domains for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());
-- Pointing a hostname at a salon is an HQ act: it decides whose data a scan
-- writes into, so it is not a thing a salon can do to itself.
create policy domains_insert_hq on public.tenant_domains for insert to authenticated
  with check (public.auth_is_platform_admin());
create policy domains_update_hq on public.tenant_domains for update to authenticated
  using (public.auth_is_platform_admin()) with check (public.auth_is_platform_admin());

create policy settings_read on public.tenant_settings for select to authenticated
  using (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin());
create policy settings_write on public.tenant_settings for insert to authenticated
  with check (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin());
create policy settings_update on public.tenant_settings for update to authenticated
  using (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin())
  with check (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin());

-- HQ needs to see and edit every salon's brand, which the existing tenants
-- policies already allow for platform admins.

-- --------------------------------------------------- resolve_tenant_by_host --
--
-- The Worker's only way in. Returns everything one scanner request needs, in
-- one round trip, so a page load is not four queries deep.
--
-- Deliberately returns NULL rather than raising for an unknown host: an
-- unmapped hostname is the normal state during setup, and the Worker falls
-- back to its shipped configuration. A database problem must degrade to
-- today's behaviour, never to a failed scan.

create or replace function public.resolve_tenant_by_host(p_host text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant public.tenants%rowtype;
  v_set    public.tenant_settings%rowtype;
  v_primary text;
begin
  select t.* into v_tenant
    from public.tenant_domains d
    join public.tenants t on t.id = d.tenant_id
   where d.host = lower(btrim(coalesce(p_host, '')))
     and d.archived_at is null
     and t.archived_at is null
   limit 1;

  if not found then
    return null;
  end if;

  select * into v_set from public.tenant_settings where tenant_id = v_tenant.id;

  select host into v_primary from public.tenant_domains
   where tenant_id = v_tenant.id and is_primary and archived_at is null limit 1;

  return jsonb_build_object(
    'tenant_id',   v_tenant.id,
    'slug',        v_tenant.slug,
    'name',        v_tenant.name,
    'status',      v_tenant.status,
    'timezone',    v_tenant.timezone,
    'locale',      v_tenant.locale,
    'currency',    v_tenant.currency,
    'phone_country', v_tenant.phone_country,
    'brand',       coalesce(v_tenant.brand, '{}'::jsonb),
    -- The address her saved links are built from. Falls back to the host that
    -- asked, so a salon with no primary set still produces working links.
    'primary_host', coalesce(v_primary, lower(btrim(p_host))),
    'settings', jsonb_build_object(
      'ghl_webhook_url',  v_set.ghl_webhook_url,
      'booking_url',      v_set.booking_url,
      'cross_link_url',   v_set.cross_link_url,
      'cross_link_label', v_set.cross_link_label,
      'support_email',    v_set.support_email,
      'overrides',        coalesce(v_set.overrides, '{}'::jsonb))
  );
end;
$$;

comment on function public.resolve_tenant_by_host(text) is
  'Hostname to salon, for the Worker. Returns null for an unknown host so the caller can fall back.';

revoke execute on function public.resolve_tenant_by_host(text) from public, anon, authenticated;
grant  execute on function public.resolve_tenant_by_host(text) to service_role;

-- ----------------------------------------------------------- HQ overview --
--
-- One row per salon for the HQ screen: enough to run the business off, without
-- N queries or exposing another salon's client rows.

create or replace function public.hq_tenant_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_out jsonb;
begin
  if not public.auth_is_platform_admin() then
    raise exception 'not_platform_admin' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row order by row->>'name'), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status,
      'timezone', t.timezone, 'locale', t.locale, 'currency', t.currency,
      'phone_country', t.phone_country,
      'brand', coalesce(t.brand, '{}'::jsonb),
      'created_at', t.created_at,
      'hosts', coalesce((
        select jsonb_agg(jsonb_build_object('id', d.id, 'host', d.host,
                 'is_primary', d.is_primary, 'verified_at', d.verified_at)
               order by d.is_primary desc, d.host)
        from public.tenant_domains d
        where d.tenant_id = t.id and d.archived_at is null), '[]'::jsonb),
      'settings', coalesce((
        select to_jsonb(s) - 'tenant_id' - 'created_at' - 'updated_at'
        from public.tenant_settings s where s.tenant_id = t.id), '{}'::jsonb),
      'credits', coalesce((select sum(delta) from public.credit_ledger l where l.tenant_id = t.id), 0),
      'clients', (select count(*) from public.clients c
                   where c.tenant_id = t.id and c.merged_into_id is null and c.archived_at is null),
      'scans_30d', (select count(*) from public.scans sc
                     where sc.tenant_id = t.id and sc.captured_at > now() - interval '30 days'),
      'last_scan_at', (select max(sc.captured_at) from public.scans sc where sc.tenant_id = t.id)
    ) as row
    from public.tenants t
    where t.archived_at is null
  ) q;

  return v_out;
end;
$$;

comment on function public.hq_tenant_overview() is
  'Every salon, with domains, settings, credits and activity. Platform admins only.';

revoke execute on function public.hq_tenant_overview() from public, anon;
grant  execute on function public.hq_tenant_overview() to authenticated, service_role;
