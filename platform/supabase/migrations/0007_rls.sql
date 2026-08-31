-- =============================================================================
-- 0007 — Row-level security.
--
-- Tenant isolation is enforced here, by Postgres, and nowhere else. The salon
-- app talks to Supabase straight from the browser with the publishable key, so
-- "the app only asks for its own tenant's rows" is not a security model — it is
-- a hope. These policies are the actual boundary.
--
-- The four helpers below are SECURITY DEFINER on purpose: a policy on
-- tenant_members that itself queried tenant_members would recurse forever.
-- Each is STABLE, has a locked search_path, and is executable only by logged-in
-- roles. They are the only functions in this schema that bypass RLS.
--
-- There are no DELETE policies anywhere in this file. Nothing in this database
-- is deleted through the API — rows are archived, voided, or superseded.
-- =============================================================================

-- ---------------------------------------------------------------- helpers --

create or replace function public.auth_is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
$$;

create or replace function public.auth_is_staff_for_tenant(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tenant_members m
    where m.tenant_id = p_tenant
      and m.user_id   = auth.uid()
      and m.status    = 'active'
      and m.archived_at is null
  );
$$;

create or replace function public.auth_staff_role_for_tenant(p_tenant uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role from public.tenant_members m
  where m.tenant_id = p_tenant
    and m.user_id   = auth.uid()
    and m.status    = 'active'
    and m.archived_at is null
  limit 1;
$$;

-- Which client file, if any, the logged-in user IS at this tenant. Returns null
-- for staff and for strangers — so a client policy written as
-- `client_id = auth_client_id_for_tenant(tenant_id)` denies by default.
create or replace function public.auth_client_id_for_tenant(p_tenant uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.client_id from public.client_portal_access a
  where a.tenant_id = p_tenant
    and a.user_id   = auth.uid()
    and a.accepted_at is not null
    and a.revoked_at is null
  limit 1;
$$;

create or replace function public.auth_is_manager_for_tenant(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.auth_staff_role_for_tenant(p_tenant) in ('owner','manager');
$$;

revoke execute on function public.auth_is_platform_admin()          from public;
revoke execute on function public.auth_is_staff_for_tenant(uuid)    from public;
revoke execute on function public.auth_staff_role_for_tenant(uuid)  from public;
revoke execute on function public.auth_client_id_for_tenant(uuid)   from public;
revoke execute on function public.auth_is_manager_for_tenant(uuid)  from public;

grant execute on function public.auth_is_platform_admin()          to authenticated;
grant execute on function public.auth_is_staff_for_tenant(uuid)    to authenticated;
grant execute on function public.auth_staff_role_for_tenant(uuid)  to authenticated;
grant execute on function public.auth_client_id_for_tenant(uuid)   to authenticated;
grant execute on function public.auth_is_manager_for_tenant(uuid)  to authenticated;

-- ------------------------------------------------------------- enable RLS --

alter table public.tenants              enable row level security;
alter table public.tenant_members       enable row level security;
alter table public.platform_admins      enable row level security;
alter table public.clients              enable row level security;
alter table public.client_identities    enable row level security;
alter table public.client_portal_access enable row level security;
alter table public.client_consents      enable row level security;
alter table public.client_notes         enable row level security;
alter table public.services             enable row level security;
alter table public.visits               enable row level security;
alter table public.visit_lines          enable row level security;
alter table public.scans                enable row level security;
alter table public.scan_findings        enable row level security;
alter table public.scan_flags           enable row level security;
alter table public.scan_photos          enable row level security;
alter table public.care_milestones      enable row level security;
alter table public.client_events        enable row level security;
alter table public.audit_log            enable row level security;
alter table public.credit_ledger        enable row level security;

-- Force RLS for table owners too, so a migration run as the owner cannot
-- silently sidestep the boundary it just declared.
alter table public.clients         force row level security;
alter table public.scans           force row level security;
alter table public.scan_photos     force row level security;
alter table public.client_notes    force row level security;
alter table public.client_events   force row level security;

-- ---------------------------------------------------------------- tenants --

create policy tenants_read_staff on public.tenants for select to authenticated
  using (public.auth_is_staff_for_tenant(id)
         or public.auth_client_id_for_tenant(id) is not null
         or public.auth_is_platform_admin());

create policy tenants_write_owner on public.tenants for update to authenticated
  using (public.auth_is_manager_for_tenant(id) or public.auth_is_platform_admin())
  with check (public.auth_is_manager_for_tenant(id) or public.auth_is_platform_admin());

create policy tenants_insert_hq on public.tenants for insert to authenticated
  with check (public.auth_is_platform_admin());

-- --------------------------------------------------------- tenant members --

create policy members_read on public.tenant_members for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy members_manage on public.tenant_members for insert to authenticated
  with check (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy members_update on public.tenant_members for update to authenticated
  using (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin())
  with check (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin());

-- -------------------------------------------------------- platform admins --

create policy platform_admins_read on public.platform_admins for select to authenticated
  using (public.auth_is_platform_admin());

-- ---------------------------------------------------------------- clients --

create policy clients_staff_read on public.clients for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy clients_self_read on public.clients for select to authenticated
  using (id = public.auth_client_id_for_tenant(tenant_id));

create policy clients_staff_insert on public.clients for insert to authenticated
  with check (public.auth_is_staff_for_tenant(tenant_id));

create policy clients_staff_update on public.clients for update to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id))
  with check (public.auth_is_staff_for_tenant(tenant_id));

-- A client may correct her own contact details and preferences. She may not
-- move herself to another tenant, and she may not touch status or merges —
-- those columns are guarded by the trigger below, not by the policy.
create policy clients_self_update on public.clients for update to authenticated
  using (id = public.auth_client_id_for_tenant(tenant_id))
  with check (id = public.auth_client_id_for_tenant(tenant_id));

create or replace function public.guard_client_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Staff and HQ are unrestricted here; this guard is only for the portal.
  if public.auth_is_staff_for_tenant(new.tenant_id) or public.auth_is_platform_admin() then
    return new;
  end if;
  if new.tenant_id      is distinct from old.tenant_id
     or new.status         is distinct from old.status
     or new.merged_into_id is distinct from old.merged_into_id
     or new.archived_at    is distinct from old.archived_at then
    raise exception 'clients: that column is not client-editable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger clients_self_update_guard before update on public.clients
  for each row execute function public.guard_client_self_update();

-- ------------------------------------------------------------- identities --

create policy identities_staff on public.client_identities for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy identities_staff_write on public.client_identities for insert to authenticated
  with check (public.auth_is_staff_for_tenant(tenant_id));

create policy identities_staff_update on public.client_identities for update to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id))
  with check (public.auth_is_staff_for_tenant(tenant_id));

-- ---------------------------------------------------------- portal access --

create policy portal_access_staff on public.client_portal_access for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy portal_access_self on public.client_portal_access for select to authenticated
  using (user_id = auth.uid());

create policy portal_access_manage on public.client_portal_access for insert to authenticated
  with check (public.auth_is_manager_for_tenant(tenant_id));

create policy portal_access_update on public.client_portal_access for update to authenticated
  using (public.auth_is_manager_for_tenant(tenant_id) or user_id = auth.uid())
  with check (public.auth_is_manager_for_tenant(tenant_id) or user_id = auth.uid());

-- --------------------------------------------------------------- consents --

create policy consents_staff on public.client_consents for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy consents_self on public.client_consents for select to authenticated
  using (client_id = public.auth_client_id_for_tenant(tenant_id));

create policy consents_insert on public.client_consents for insert to authenticated
  with check (public.auth_is_staff_for_tenant(tenant_id)
              or client_id = public.auth_client_id_for_tenant(tenant_id));

-- ------------------------------------------------------------------ notes --
-- Staff-only, deliberately. A client's own file is hers to read; the desk's
-- shorthand about her is not.

create policy notes_staff_read on public.client_notes for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id));

create policy notes_staff_insert on public.client_notes for insert to authenticated
  with check (public.auth_is_staff_for_tenant(tenant_id));

create policy notes_staff_update on public.client_notes for update to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id))
  with check (public.auth_is_staff_for_tenant(tenant_id));

-- --------------------------------------------------------------- services --

create policy services_read on public.services for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id)
         or public.auth_client_id_for_tenant(tenant_id) is not null
         or public.auth_is_platform_admin());

create policy services_manage on public.services for insert to authenticated
  with check (public.auth_is_manager_for_tenant(tenant_id));

create policy services_update on public.services for update to authenticated
  using (public.auth_is_manager_for_tenant(tenant_id))
  with check (public.auth_is_manager_for_tenant(tenant_id));

-- ----------------------------------------------------------------- visits --

create policy visits_staff_read on public.visits for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy visits_self_read on public.visits for select to authenticated
  using (client_id = public.auth_client_id_for_tenant(tenant_id));

create policy visits_staff_insert on public.visits for insert to authenticated
  with check (public.auth_is_staff_for_tenant(tenant_id));

create policy visits_staff_update on public.visits for update to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id))
  with check (public.auth_is_staff_for_tenant(tenant_id));

create policy visit_lines_staff_read on public.visit_lines for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy visit_lines_self_read on public.visit_lines for select to authenticated
  using (exists (select 1 from public.visits v
                 where v.id = visit_id
                   and v.client_id = public.auth_client_id_for_tenant(v.tenant_id)));

create policy visit_lines_staff_insert on public.visit_lines for insert to authenticated
  with check (public.auth_is_staff_for_tenant(tenant_id));

create policy visit_lines_staff_update on public.visit_lines for update to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id))
  with check (public.auth_is_staff_for_tenant(tenant_id));

-- ------------------------------------------------------------------ scans --
-- Written by the Worker with the service key, which bypasses RLS entirely.
-- These policies govern humans reading them back.

create policy scans_staff_read on public.scans for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy scans_self_read on public.scans for select to authenticated
  using (client_id = public.auth_client_id_for_tenant(tenant_id));

create policy scans_staff_update on public.scans for update to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id))
  with check (public.auth_is_staff_for_tenant(tenant_id));

create policy findings_staff_read on public.scan_findings for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy findings_self_read on public.scan_findings for select to authenticated
  using (client_id = public.auth_client_id_for_tenant(tenant_id));

create policy flags_staff_read on public.scan_flags for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy flags_self_read on public.scan_flags for select to authenticated
  using (client_id = public.auth_client_id_for_tenant(tenant_id));

-- Acknowledging a flag is the one staff write on this table.
create policy flags_staff_ack on public.scan_flags for update to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id))
  with check (public.auth_is_staff_for_tenant(tenant_id));

create policy photos_staff_read on public.scan_photos for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy photos_self_read on public.scan_photos for select to authenticated
  using (client_id = public.auth_client_id_for_tenant(tenant_id));

create policy photos_staff_insert on public.scan_photos for insert to authenticated
  with check (public.auth_is_staff_for_tenant(tenant_id));

create policy photos_staff_update on public.scan_photos for update to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id))
  with check (public.auth_is_staff_for_tenant(tenant_id));

create policy milestones_staff_read on public.care_milestones for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy milestones_self_read on public.care_milestones for select to authenticated
  using (client_id = public.auth_client_id_for_tenant(tenant_id));

create policy milestones_staff_update on public.care_milestones for update to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id))
  with check (public.auth_is_staff_for_tenant(tenant_id));

-- --------------------------------------------------------------- timeline --

create policy events_staff_read on public.client_events for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

-- The client sees her own story, minus the desk's private shorthand.
create policy events_self_read on public.client_events for select to authenticated
  using (client_id = public.auth_client_id_for_tenant(tenant_id)
         and kind <> 'note');

create policy events_staff_insert on public.client_events for insert to authenticated
  with check (public.auth_is_staff_for_tenant(tenant_id));

-- -------------------------------------------------------------- audit log --
-- Readable by the people accountable for it, and by nobody else.

create policy audit_read on public.audit_log for select to authenticated
  using (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy audit_insert on public.audit_log for insert to authenticated
  with check (tenant_id is null or public.auth_is_staff_for_tenant(tenant_id));

-- ---------------------------------------------------------------- credits --

create policy credits_read on public.credit_ledger for select to authenticated
  using (public.auth_is_staff_for_tenant(tenant_id) or public.auth_is_platform_admin());

-- Grants come from HQ. Spends come from the Worker on the service key. Neither
-- is a thing a salon can do to itself from the browser.
create policy credits_hq_insert on public.credit_ledger for insert to authenticated
  with check (public.auth_is_platform_admin());
