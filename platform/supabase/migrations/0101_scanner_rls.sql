-- =============================================================================
-- 0101 — Row-level security for the five new tables.
--
-- The project already has RLS on all 24 of its tables and its own helper
-- functions for who-is-who. These policies call those helpers rather than
-- inventing a second answer to the same question.
-- =============================================================================

begin;

alter table public.scan_findings  enable row level security;
alter table public.scan_flags     enable row level security;
alter table public.scan_photos    enable row level security;
alter table public.care_milestones enable row level security;
alter table public.tenant_hosts   enable row level security;

alter table public.scan_findings  force row level security;
alter table public.scan_flags     force row level security;
alter table public.scan_photos    force row level security;
alter table public.care_milestones force row level security;
alter table public.tenant_hosts   force row level security;

-- staff of the salon, and nobody else, may read the reading detail
do $$
declare t text;
begin
  foreach t in array array['scan_findings','scan_flags','scan_photos','care_milestones']
  loop
    execute format(
      'drop policy if exists %I on public.%I', t || '_staff_read', t);
    execute format(
      'create policy %I on public.%I for select using (public.auth_is_staff_for_tenant(tenant_id))',
      t || '_staff_read', t);
  end loop;
end $$;

-- a client may read her own reading detail through the portal
drop policy if exists scan_findings_client_read on public.scan_findings;
create policy scan_findings_client_read on public.scan_findings
  for select using (
    exists (select 1 from public.scans s
             where s.id = scan_findings.scan_id
               and s.client_id = public.auth_client_id_for_tenant(scan_findings.tenant_id)));

drop policy if exists scan_photos_client_read on public.scan_photos;
create policy scan_photos_client_read on public.scan_photos
  for select using (
    exists (select 1 from public.scans s
             where s.id = scan_photos.scan_id
               and s.client_id = public.auth_client_id_for_tenant(scan_photos.tenant_id)));

drop policy if exists care_milestones_client_read on public.care_milestones;
create policy care_milestones_client_read on public.care_milestones
  for select using (
    client_id = public.auth_client_id_for_tenant(care_milestones.tenant_id));

-- hosts: a salon may see its own, only HQ may write any
drop policy if exists tenant_hosts_staff_read on public.tenant_hosts;
create policy tenant_hosts_staff_read on public.tenant_hosts
  for select using (
    public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

drop policy if exists tenant_hosts_admin_write on public.tenant_hosts;
create policy tenant_hosts_admin_write on public.tenant_hosts
  for all using (public.auth_is_platform_admin())
  with check (public.auth_is_platform_admin());

-- staff may tick a milestone off; they may not invent one
drop policy if exists care_milestones_staff_update on public.care_milestones;
create policy care_milestones_staff_update on public.care_milestones
  for update using (public.auth_is_staff_for_tenant(tenant_id))
  with check (public.auth_is_staff_for_tenant(tenant_id));

commit;
