-- =============================================================================
-- 0012 — What HQ is allowed to touch.
--
-- 0007 wrote the service-menu policies for the only case that existed then: a
-- salon's own manager editing their own menu. With an HQ screen there is a
-- second legitimate editor — us, setting a salon up before they have ever
-- logged in, or fixing a price over the phone.
--
-- This is a widening, so it is written narrowly. Platform admins gain exactly
-- the writes the HQ screen needs and nothing else: the service menu and a
-- salon's own visit history stays untouched. Nobody gains a delete.
-- =============================================================================

drop policy if exists services_manage on public.services;
drop policy if exists services_update on public.services;

create policy services_manage on public.services for insert to authenticated
  with check (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin());

create policy services_update on public.services for update to authenticated
  using (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin())
  with check (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin());

-- Setting a salon up means creating their staff seats before they can log in
-- to create them themselves.
drop policy if exists members_manage on public.tenant_members;
create policy members_manage on public.tenant_members for insert to authenticated
  with check (public.auth_is_manager_for_tenant(tenant_id) or public.auth_is_platform_admin());

comment on policy services_manage on public.services is
  'A salon''s own manager, or HQ setting them up. Widened from manager-only in 0012.';

-- ----------------------------------------------------------- reordering --
--
-- The HQ screen reorders the menu by dragging. Doing that as N separate
-- updates means a half-applied order if the connection drops mid-drag, and a
-- menu that reads differently depending on when you looked. One call, one
-- transaction, one order.

create or replace function public.reorder_services(p jsonb)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := (p->>'tenant_id')::uuid;
  v_ids    uuid[];
  v_n      integer := 0;
  v_total  integer := 0;
  v_id     uuid;
begin
  if v_tenant is null then
    raise exception 'tenant_id required' using errcode = '22023';
  end if;
  -- security invoker: the caller's own RLS decides whether these rows are
  -- theirs to touch. HQ and the salon's manager both pass; nobody else does.
  select array_agg(value::text::uuid order by ordinality)
    into v_ids
    from jsonb_array_elements_text(coalesce(p->'ids', '[]'::jsonb)) with ordinality;

  if v_ids is null then return 0; end if;

  -- Count rows ACTUALLY moved, not ids iterated.
  --
  -- Under row-level security an update that matches nothing succeeds quietly —
  -- which is correct, and which would let this return "3 reordered" to somebody
  -- whose changes RLS threw away. The UI would say saved over a no-op. Return
  -- what really happened and let the caller notice a zero.
  declare v_moved integer;
  begin
    v_n := 0;
    foreach v_id in array v_ids loop
      v_n := v_n + 1;
      update public.services
         set sort_order = v_n * 10
       where id = v_id and tenant_id = v_tenant;
      get diagnostics v_moved = row_count;
      v_total := v_total + v_moved;
    end loop;
  end;
  return v_total;
end;
$$;

comment on function public.reorder_services(jsonb) is
  'Apply a whole menu order in one transaction. Security invoker: RLS still decides.';

revoke execute on function public.reorder_services(jsonb) from public, anon;
grant  execute on function public.reorder_services(jsonb) to authenticated, service_role;
