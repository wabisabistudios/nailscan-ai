-- =============================================================================
-- 0102 — The calls the Worker and the book make.
--
-- Every one is SECURITY DEFINER with a locked search_path. The two ingest
-- functions are service_role only; nothing in a browser can reach them.
-- =============================================================================

begin;

-- ------------------------------------------------------ resolve_tenant_by_host

create or replace function public.resolve_tenant_by_host(p_host text)
returns table (id uuid, slug text, name text, branding jsonb, settings jsonb)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select t.id, t.slug, t.name, coalesce(t.branding,'{}'::jsonb), coalesce(t.settings,'{}'::jsonb)
  from public.tenant_hosts h
  join public.tenants t on t.id = h.tenant_id
  where lower(h.host) = lower(p_host)
    and h.archived_at is null
    and t.status <> 'closed'
  limit 1;
$$;

-- ---------------------------------------------------------------- ingest_scan
--
-- One transaction per reading, idempotent on public_id. The scan is written
-- before anyone knows whose hand it is; attach_lead_to_scan claims it later.

create or replace function public.ingest_scan(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_scan   uuid;
  v_at     timestamptz := coalesce((p->>'captured_at')::timestamptz, now());
  v_item   jsonb;
begin
  select id into v_tenant from public.tenants where slug = p->>'tenant_slug';
  if v_tenant is null then
    raise exception 'unknown tenant slug %', p->>'tenant_slug' using errcode = '23503';
  end if;

  select id into v_scan from public.scans
   where tenant_id = v_tenant and public_id = p->>'public_id';

  if v_scan is null then
    insert into public.scans (
      tenant_id, public_id, hand, capture_quality, analysis, overall_score,
      status, care_calendar, verdict, image_raw_path, analysis_provider,
      analysis_ms, analysis_cost_cents, created_at)
    values (
      v_tenant, p->>'public_id', coalesce(p->>'hand','unknown'),
      jsonb_build_object('score', (p->>'photo_quality')::numeric,
                         'nails_visible', (p->>'nails_visible')::int,
                         'confidence', (p->>'confidence')::numeric),
      coalesce(p->'record','{}'::jsonb),
      coalesce((p->>'overall_score')::numeric, 0),
      coalesce(p->>'status','complete'),
      coalesce(p#>'{record,display,calendar}','{}'::jsonb),
      jsonb_build_object('tier', p->>'tier', 'wear', p->>'wear',
                         'summary', p->>'summary'),
      p->>'image_path', coalesce(p->>'analysis_provider','nailscan-worker'),
      (p->>'analysis_ms')::int, coalesce((p->>'analysis_cost_cents')::int, 0), v_at)
    returning id into v_scan;
  else
    update public.scans set
      analysis      = coalesce(p->'record','{}'::jsonb),
      care_calendar = coalesce(p#>'{record,display,calendar}','{}'::jsonb),
      verdict       = jsonb_build_object('tier', p->>'tier', 'wear', p->>'wear',
                                         'summary', p->>'summary'),
      updated_at    = now()
    where id = v_scan;
  end if;

  -- children are rewritten wholesale: the reading is the source of truth, and
  -- a partial old copy is worse than none
  if p ? 'findings' then
    delete from public.scan_findings where scan_id = v_scan;
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p->'findings','[]'::jsonb)) loop
    insert into public.scan_findings
      (tenant_id, scan_id, code, fingers, zone, severity, is_positive, observed_at)
    values (v_tenant, v_scan, v_item->>'code',
      coalesce(array(select jsonb_array_elements_text(v_item->'fingers')), '{}'::text[]),
      coalesce(v_item->>'zone','whole'), coalesce(v_item->>'severity','mild'),
      coalesce((v_item->>'is_positive')::boolean, false), v_at)
    on conflict (scan_id, code, zone) do nothing;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p->'flags','[]'::jsonb)) loop
    insert into public.scan_flags (tenant_id, scan_id, code, observed_at)
    values (v_tenant, v_scan, v_item #>> '{}', v_at)
    on conflict (scan_id, code) do nothing;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p->'photos','[]'::jsonb)) loop
    insert into public.scan_photos
      (tenant_id, scan_id, kind, storage, path, public_url, content_type, taken_at)
    values (v_tenant, v_scan, coalesce(v_item->>'kind','capture'),
      coalesce(v_item->>'storage','r2'), v_item->>'path',
      v_item->>'public_url', v_item->>'content_type', v_at)
    on conflict (storage, path) do nothing;
  end loop;

  if p ? 'milestones' then
    delete from public.care_milestones where scan_id = v_scan and status = 'pending';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p->'milestones','[]'::jsonb)) loop
    insert into public.care_milestones
      (tenant_id, scan_id, due_on, label, sub, kind, service_slug, is_primary)
    values (v_tenant, v_scan, (v_item->>'due_on')::date, v_item->>'label',
      v_item->>'sub', coalesce(v_item->>'kind','check'),
      v_item->>'service_slug', coalesce((v_item->>'is_primary')::boolean, false));
  end loop;

  return v_scan;
end;
$$;

-- -------------------------------------------------------- attach_lead_to_scan
--
-- Where an anonymous reading becomes somebody's file. Phone is the identity —
-- the project already enforces that with a unique index on (tenant_id, phone).
-- Email never matches on its own: mothers and daughters share inboxes, and a
-- wrongly merged file is far worse than a duplicate one.

create or replace function public.attach_lead_to_scan(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_scan   uuid;
  v_client uuid;
  v_phone  text := nullif(trim(p->>'phone'), '');
  v_first  text := coalesce(nullif(trim(split_part(coalesce(p->>'name',''), ' ', 1)), ''), 'Guest');
  v_last   text := nullif(trim(substr(coalesce(p->>'name',''), length(split_part(coalesce(p->>'name',''),' ',1)) + 2)), '');
  v_new    boolean := false;
begin
  select id into v_tenant from public.tenants where slug = p->>'tenant_slug';
  if v_tenant is null then
    raise exception 'unknown tenant slug %', p->>'tenant_slug' using errcode = '23503';
  end if;

  select id into v_scan from public.scans
   where tenant_id = v_tenant and public_id = p->>'public_id';
  if v_scan is null then
    raise exception 'no scan with public id %', p->>'public_id' using errcode = 'P0002';
  end if;

  if v_phone is not null then
    select id into v_client from public.clients
     where tenant_id = v_tenant and phone = v_phone;
  end if;

  if v_client is null then
    insert into public.clients (tenant_id, first_name, last_name, phone, phone_raw,
                                email, source, status, marketing_consent, consented_at,
                                data_consent_at)
    values (v_tenant, v_first, v_last, v_phone, p->>'phone_raw', nullif(p->>'email',''),
            coalesce(p->>'source','scanner'), 'active', true, now(), now())
    returning id into v_client;
    v_new := true;
  else
    update public.clients set
      email        = coalesce(nullif(p->>'email',''), email),
      last_name    = coalesce(last_name, v_last),
      consented_at = coalesce(consented_at, now()),
      updated_at   = now()
    where id = v_client;
  end if;

  update public.scans set client_id = v_client, updated_at = now()
   where id = v_scan and client_id is distinct from v_client;

  update public.care_milestones set client_id = v_client
   where scan_id = v_scan and client_id is null;

  -- the timeline this project already keeps
  insert into public.activity_log (tenant_id, client_id, type, ref_id, summary, meta)
  select v_tenant, v_client, 'scan', v_scan,
         coalesce(p->>'summary', 'Nail reading taken'),
         jsonb_build_object('public_id', p->>'public_id', 'source', p->>'source')
  where not exists (
    select 1 from public.activity_log
     where tenant_id = v_tenant and type = 'scan' and ref_id = v_scan);

  return jsonb_build_object('client_id', v_client, 'scan_id', v_scan, 'created', v_new);
end;
$$;

-- --------------------------------------------------------- record_plan_saved

create or replace function public.record_plan_saved(p jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_scan   uuid;
  v_client uuid;
begin
  select id into v_tenant from public.tenants where slug = p->>'tenant_slug';
  if v_tenant is null then return; end if;

  select id, client_id into v_scan, v_client from public.scans
   where tenant_id = v_tenant and public_id = p->>'public_id';
  if v_scan is null then return; end if;

  insert into public.activity_log (tenant_id, client_id, type, ref_id, summary, meta)
  values (v_tenant, v_client, 'plan_saved', v_scan,
          coalesce(p->>'summary', 'Saved her dates to a calendar'),
          coalesce(p->'meta','{}'::jsonb));
end;
$$;

-- ------------------------------------------------------------ credit_balance

create or replace function public.credit_balance(p_tenant uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce((select balance from public.tenant_credit_balance where tenant_id = p_tenant), 0)::int;
$$;

-- --------------------------------------------------------- hq_tenant_overview

create or replace function public.hq_tenant_overview()
returns table (
  id uuid, slug text, name text, status text, timezone text, locale text,
  currency text, branding jsonb, settings jsonb, created_at timestamptz,
  hosts jsonb, credits int, clients int, scans_30d int, last_scan_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
begin
  if not public.auth_is_platform_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  select t.id, t.slug, t.name, t.status, t.timezone, t.locale, t.currency,
         coalesce(t.branding,'{}'::jsonb), coalesce(t.settings,'{}'::jsonb), t.created_at,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'id', h.id, 'host', h.host, 'is_primary', h.is_primary,
                     'verified_at', h.verified_at) order by h.is_primary desc, h.host)
                   from public.tenant_hosts h
                   where h.tenant_id = t.id and h.archived_at is null), '[]'::jsonb),
         public.credit_balance(t.id),
         (select count(*)::int from public.clients c where c.tenant_id = t.id),
         (select count(*)::int from public.scans s
           where s.tenant_id = t.id and s.created_at > now() - interval '30 days'),
         (select max(s.created_at) from public.scans s where s.tenant_id = t.id)
  from public.tenants t
  order by t.name;
end;
$$;

-- ---------------------------------------------------------- reorder_services
--
-- Returns the number of rows actually moved, not the number asked for. A menu
-- that says "saved" over a no-op is worse than one that says nothing.

create or replace function public.reorder_services(p jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  v_ids    uuid[] := array(select (jsonb_array_elements_text(p->'ids'))::uuid);
  v_moved  int := 0;
  v_n      int;
  i        int;
begin
  if not (public.auth_is_platform_admin() or public.auth_is_staff_for_tenant(v_tenant)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  for i in 1 .. coalesce(array_length(v_ids, 1), 0) loop
    update public.services set sort = i * 10, updated_at = now()
     where id = v_ids[i] and tenant_id = v_tenant and sort is distinct from i * 10;
    get diagnostics v_n = row_count;
    v_moved := v_moved + v_n;
  end loop;

  return v_moved;
end;
$$;

-- ------------------------------------------------------------------- grants

revoke all on function public.ingest_scan(jsonb)         from public, anon, authenticated;
revoke all on function public.attach_lead_to_scan(jsonb) from public, anon, authenticated;
revoke all on function public.record_plan_saved(jsonb)   from public, anon, authenticated;
revoke all on function public.resolve_tenant_by_host(text) from public, anon;

grant execute on function public.ingest_scan(jsonb)          to service_role;
grant execute on function public.attach_lead_to_scan(jsonb)  to service_role;
grant execute on function public.record_plan_saved(jsonb)    to service_role;
grant execute on function public.resolve_tenant_by_host(text) to service_role, authenticated;
grant execute on function public.hq_tenant_overview()        to authenticated;
grant execute on function public.reorder_services(jsonb)     to authenticated;
grant execute on function public.credit_balance(uuid)        to authenticated, service_role;

commit;
