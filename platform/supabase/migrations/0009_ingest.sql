-- =============================================================================
-- 0009 — Ingest: the two calls the scanner Worker makes.
--
-- The Worker could write these tables one REST call at a time, but then a
-- half-written scan is a real state — findings saved, photo row missing, no
-- timeline entry — and the client file would quietly lie. So ingestion is two
-- functions, each one transaction.
--
-- Both are idempotent. A Worker retry, a double-tap on a flaky salon wifi, or a
-- replayed webhook produces the same row it produced the first time.
--
-- Both are service_role only. Nothing in a browser can call them.
-- =============================================================================

-- ------------------------------------------------------------ ingest_scan --
--
-- Called the moment a reading is generated, before anyone knows who took it.
-- The scan is stored unattached; attach_lead_to_scan claims it later. A scan
-- nobody ever claims is still a scan the salon can see and count.

create or replace function public.ingest_scan(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_scan     uuid;
  v_captured timestamptz := coalesce((p->>'captured_at')::timestamptz, now());
  v_item     jsonb;
begin
  select id into v_tenant from public.tenants
   where slug = p->>'tenant_slug' and archived_at is null;
  if v_tenant is null then
    raise exception 'unknown tenant slug %', p->>'tenant_slug' using errcode = '23503';
  end if;

  -- Idempotent on (tenant, public_id). A retry updates the reading in place
  -- rather than minting a second one against the same public link.
  insert into public.scans (
    tenant_id, public_id, source, captured_at, tier, wear,
    confidence, photo_quality, nails_visible, hand, undertone, nail_bed,
    summary, record, record_version, analysis)
  values (
    v_tenant, p->>'public_id', coalesce(p->>'source','try-demo'), v_captured,
    p->>'tier', coalesce(p->>'wear','unknown'),
    (p->>'confidence')::real, (p->>'photo_quality')::real,
    (p->>'nails_visible')::smallint, p->>'hand', p->>'undertone', p->>'nail_bed',
    p->>'summary', coalesce(p->'record','{}'::jsonb),
    coalesce((p->>'record_version')::smallint, 2), coalesce(p->'analysis','{}'::jsonb))
  on conflict (tenant_id, public_id) do update
    set tier = excluded.tier, wear = excluded.wear, summary = excluded.summary,
        record = excluded.record, analysis = excluded.analysis, updated_at = now()
  returning id into v_scan;

  -- Children are rewritten wholesale on a retry: the reading is the source of
  -- truth, and a partial old copy is worse than none.
  delete from public.scan_findings where scan_id = v_scan;
  for v_item in select * from jsonb_array_elements(coalesce(p->'findings','[]'::jsonb)) loop
    insert into public.scan_findings
      (tenant_id, scan_id, code, fingers, zone, severity, is_positive, observed_at)
    values (
      v_tenant, v_scan, v_item->>'code',
      coalesce(array(select jsonb_array_elements_text(v_item->'fingers')), '{}'::text[]),
      coalesce(v_item->>'zone','whole'), coalesce(v_item->>'severity','mild'),
      coalesce((v_item->>'is_positive')::boolean, false), v_captured)
    on conflict (scan_id, code, zone) do nothing;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p->'flags','[]'::jsonb)) loop
    insert into public.scan_flags (tenant_id, scan_id, code, observed_at)
    values (v_tenant, v_scan, v_item #>> '{}', v_captured)
    on conflict (scan_id, code) do nothing;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p->'photos','[]'::jsonb)) loop
    insert into public.scan_photos
      (tenant_id, scan_id, kind, storage, path, public_url, content_type, taken_at)
    values (
      v_tenant, v_scan, coalesce(v_item->>'kind','capture'),
      coalesce(v_item->>'storage','r2'), v_item->>'path',
      v_item->>'public_url', v_item->>'content_type', v_captured)
    on conflict (storage, path) do nothing;
  end loop;

  delete from public.care_milestones where scan_id = v_scan and status = 'pending';
  for v_item in select * from jsonb_array_elements(coalesce(p->'milestones','[]'::jsonb)) loop
    insert into public.care_milestones
      (tenant_id, scan_id, due_on, label, sub, kind, service_slug, is_primary)
    values (
      v_tenant, v_scan, (v_item->>'due_on')::date, v_item->>'label', v_item->>'sub',
      coalesce(v_item->>'kind','check'), v_item->>'service_slug',
      coalesce((v_item->>'is_primary')::boolean, false));
  end loop;

  return v_scan;
end;
$$;

comment on function public.ingest_scan(jsonb) is
  'Worker entry point. One transaction per reading, idempotent on (tenant, public_id).';

-- ------------------------------------------------------ attach_lead_to_scan --
--
-- Called when she gives her details. This is where an anonymous reading becomes
-- somebody's file — and where a returning client is recognised.
--
-- Matching order, deliberately:
--   1. a live client with this phone
--   2. a historical identity with this phone (she changed her number, or the
--      salon typed the old one)
--   3. otherwise a new client, and the phone recorded as her first identity
--
-- Email never matches on its own. Mothers and daughters share inboxes; a
-- wrongly merged file is far worse than a duplicate one.

create or replace function public.attach_lead_to_scan(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant   uuid;
  v_scan     public.scans%rowtype;
  v_client   uuid;
  v_phone    text := nullif(btrim(coalesce(p->>'phone','')), '');
  v_email    citext := nullif(btrim(coalesce(p->>'email','')), '');
  v_first    text := nullif(btrim(split_part(coalesce(p->>'name',''), ' ', 1)), '');
  v_last     text := nullif(btrim(substr(coalesce(p->>'name',''), length(split_part(coalesce(p->>'name',''), ' ', 1)) + 2)), '');
  v_new      boolean := false;
begin
  select id into v_tenant from public.tenants
   where slug = p->>'tenant_slug' and archived_at is null;
  if v_tenant is null then
    raise exception 'unknown tenant slug %', p->>'tenant_slug' using errcode = '23503';
  end if;

  select * into v_scan from public.scans
   where tenant_id = v_tenant and public_id = p->>'public_id';
  if not found then
    raise exception 'unknown scan %', p->>'public_id' using errcode = 'P0002';
  end if;

  -- 1. live client on this number
  select c.id into v_client from public.clients c
   where c.tenant_id = v_tenant and c.phone = v_phone
     and c.merged_into_id is null and c.archived_at is null
   limit 1;

  -- 2. a number she used to have
  if v_client is null and v_phone is not null then
    select coalesce(c.merged_into_id, c.id) into v_client
      from public.client_identities i
      join public.clients c on c.id = i.client_id
     where i.tenant_id = v_tenant and i.kind = 'phone' and i.value = v_phone
       and c.archived_at is null
     limit 1;
  end if;

  -- 3. someone new
  if v_client is null then
    insert into public.clients (tenant_id, phone, email, first_name, last_name, source, status, last_seen_at)
    values (v_tenant, v_phone, v_email, v_first, v_last,
            coalesce(p->>'source','try-demo'), 'lead', v_scan.captured_at)
    returning id into v_client;
    v_new := true;

    insert into public.client_events (tenant_id, client_id, kind, title, detail, actor_label)
    values (v_tenant, v_client, 'client_created',
            coalesce(v_first, 'New client') || ' added',
            'Created from a nail reading.', 'Scanner');
  else
    -- Known face. Fill the blanks she just gave us; never overwrite what the
    -- salon already knows about her.
    update public.clients
       set email        = coalesce(email, v_email),
           first_name   = coalesce(first_name, v_first),
           last_name    = coalesce(last_name, v_last),
           phone        = coalesce(phone, v_phone),
           last_seen_at = greatest(coalesce(last_seen_at, v_scan.captured_at), v_scan.captured_at)
     where id = v_client;
  end if;

  -- Remember every handle, so the next match is easier than this one was.
  if v_phone is not null then
    insert into public.client_identities (tenant_id, client_id, kind, value, is_primary)
    values (v_tenant, v_client, 'phone', v_phone, true)
    on conflict (tenant_id, kind, value) do nothing;
  end if;
  if v_email is not null then
    insert into public.client_identities (tenant_id, client_id, kind, value, is_primary)
    values (v_tenant, v_client, 'email', v_email::text, true)
    on conflict (tenant_id, kind, value) do nothing;
  end if;

  -- Claim the reading and everything hanging off it.
  update public.scans          set client_id = v_client where id = v_scan.id;
  update public.scan_findings  set client_id = v_client where scan_id = v_scan.id;
  update public.scan_flags     set client_id = v_client where scan_id = v_scan.id;
  update public.scan_photos    set client_id = v_client where scan_id = v_scan.id;
  update public.care_milestones set client_id = v_client where scan_id = v_scan.id;

  -- The words she was actually shown, kept verbatim.
  --
  -- The consent log is append-only and records CHANGES of state, so a retry
  -- that re-asserts the consent already on file adds nothing. Only write when
  -- the latest row for this kind says something different — a genuine
  -- re-consent later, with different wording or a withdrawal, still lands.
  if p ? 'consent_text' then
    if not exists (
      select 1 from public.client_consents c
       where c.client_id = v_client and c.kind = 'contact'
         and c.granted = true and c.text_shown = p->>'consent_text'
       order by c.granted_at desc limit 1
    ) then
      insert into public.client_consents (tenant_id, client_id, kind, granted, text_shown, source)
      values (v_tenant, v_client, 'contact', true, p->>'consent_text', coalesce(p->>'source','try-demo'));

      insert into public.client_events (tenant_id, client_id, kind, title, detail, actor_label)
      values (v_tenant, v_client, 'consent', 'Agreed to be contacted',
              left(p->>'consent_text', 400), 'Scanner');
    end if;
  end if;

  insert into public.client_events (tenant_id, client_id, at, kind, title, detail, ref_table, ref_id, actor_label, payload)
  values (v_tenant, v_client, v_scan.captured_at, 'scan',
          'Nail reading · ' || v_scan.tier,
          left(coalesce(v_scan.summary, ''), 1000),
          'scans', v_scan.id, 'Scanner',
          jsonb_build_object('tier', v_scan.tier, 'wear', v_scan.wear, 'public_id', v_scan.public_id))
  on conflict (client_id, kind, ref_table, ref_id) where ref_id is not null do nothing;

  -- A flag is the one thing on a file that should never need looking for.
  insert into public.client_events (tenant_id, client_id, at, kind, title, detail, ref_table, ref_id, actor_label)
  select v_tenant, v_client, f.observed_at, 'flag_raised',
         'Worth a check · ' || f.code,
         'Outside cosmetic care. Not a diagnosis.', 'scan_flags', f.id, 'Scanner'
    from public.scan_flags f where f.scan_id = v_scan.id
  on conflict (client_id, kind, ref_table, ref_id) where ref_id is not null do nothing;

  return jsonb_build_object(
    'client_id', v_client,
    'scan_id',   v_scan.id,
    'is_new_client', v_new);
end;
$$;

comment on function public.attach_lead_to_scan(jsonb) is
  'Turns an anonymous reading into somebody''s file. Matches on phone, then on historical phone, then creates.';

-- Server-side only. Neither of these is reachable from a browser session.
revoke execute on function public.ingest_scan(jsonb)         from public, anon, authenticated;
revoke execute on function public.attach_lead_to_scan(jsonb) from public, anon, authenticated;
grant  execute on function public.ingest_scan(jsonb)         to service_role;
grant  execute on function public.attach_lead_to_scan(jsonb) to service_role;
