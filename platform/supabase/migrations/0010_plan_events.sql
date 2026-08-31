-- =============================================================================
-- 0010 — "She saved the plan."
--
-- When somebody puts your dates in her own phone, that is the strongest signal
-- this product generates: a person who read the reading, believed it enough to
-- act, and told you when her wedding is. It belongs on her file and in front of
-- whoever calls her.
--
-- Two changes: the timeline learns a new kind of event, and the Worker gets a
-- narrow way to write one.
-- =============================================================================

-- The kind list is a CHECK rather than an enum on purpose — adding a value is a
-- visible migration instead of a silent ALTER TYPE.
alter table public.client_events drop constraint if exists client_events_kind_check;

alter table public.client_events add constraint client_events_kind_check
  check (kind in (
    'client_created','client_merged',
    'scan','flag_raised','flag_acknowledged',
    'visit_booked','visit_settled','visit_cancelled','visit_no_show','redo',
    'photo','note','consent',
    'milestone_due','milestone_met','milestone_missed',
    'plan_saved',
    'call','message','portal_login'));

comment on constraint client_events_kind_check on public.client_events is
  'Closed vocabulary of timeline events. Adding one is a migration, never an app-side string.';

-- ------------------------------------------------------- record_plan_saved --
--
-- Called by the scanner Worker when a reminder file is downloaded. Resolves the
-- scan to its client and writes one timeline row.
--
-- Idempotent by the same rule as everything else here: the unique index on
-- (client_id, kind, ref_table, ref_id) means a double-tap on the download
-- button, or a retried request, inserts nothing twice.

create or replace function public.record_plan_saved(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_scan   public.scans%rowtype;
  v_detail text;
  v_count  int := coalesce((p->>'total')::int, 0);
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

  -- An unattached scan has no file to write to yet. Not an error: the lead POST
  -- may simply not have landed. Say so and let the caller move on.
  if v_scan.client_id is null then
    return jsonb_build_object('logged', false, 'reason', 'scan_unattached');
  end if;

  v_detail := v_count || ' reminder' || case when v_count = 1 then '' else 's' end ||
              ' saved to her phone';
  if coalesce(p->>'event_label', '') <> '' then
    v_detail := v_detail || ' · ' || (p->>'event_label') ||
                coalesce(' on ' || nullif(p->>'event_date', ''), '');
  end if;

  insert into public.client_events
    (tenant_id, client_id, kind, title, detail, ref_table, ref_id, actor_label, payload)
  values (v_tenant, v_scan.client_id, 'plan_saved',
          'Saved her nail plan', left(v_detail, 1000),
          'scans', v_scan.id, 'Scanner', coalesce(p->'payload', '{}'::jsonb))
  on conflict (client_id, kind, ref_table, ref_id) where ref_id is not null do nothing;

  -- A named date she volunteered is a booking conversation. Put it where the
  -- salon will actually see it, not only in the CRM.
  if coalesce(p->>'event_date', '') <> '' then
    update public.clients
       set profile = profile || jsonb_build_object(
             'upcoming_event', jsonb_build_object(
               'label', coalesce(p->>'event_label', 'an event'),
               'date',  p->>'event_date',
               'told_us_at', now()))
     where id = v_scan.client_id;
  end if;

  return jsonb_build_object('logged', true, 'client_id', v_scan.client_id);
end;
$$;

comment on function public.record_plan_saved(jsonb) is
  'Worker entry point for a downloaded reminder file. One timeline row, plus any event date she volunteered.';

revoke execute on function public.record_plan_saved(jsonb) from public, anon, authenticated;
grant  execute on function public.record_plan_saved(jsonb) to service_role;
