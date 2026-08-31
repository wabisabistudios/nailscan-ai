-- =============================================================================
-- 0008 — Table privileges.
--
-- RLS decides which ROWS a logged-in person may touch. Grants decide whether
-- the role may touch the table at all. Both are needed: a policy without a
-- grant reads as "permission denied", and a grant without a policy reads as
-- "everything".
--
-- Two deliberate choices here:
--   * `anon` gets nothing. Nobody reads a client file without logging in. The
--     public scanner does not use this database from the browser at all — the
--     Worker writes on the service key.
--   * Nobody gets DELETE. Not staff, not managers, not HQ. Removal happens by
--     archiving, voiding or superseding, and those are UPDATEs.
-- =============================================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

grant usage on schema public to authenticated, service_role;

-- Read + write, never delete.
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- The Worker and any server-side job. Bypasses RLS by virtue of the role, but
-- still needs the grant.
grant select, insert, update on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Tables that are append-only by trigger get no UPDATE grant either, so the
-- refusal is a permission error rather than an exception raised mid-statement.
revoke update on public.client_events  from authenticated, service_role;
revoke update on public.client_consents from authenticated, service_role;
revoke update on public.audit_log      from authenticated, service_role;
revoke update on public.credit_ledger  from authenticated, service_role;

-- Anything added by a later migration inherits the same shape.
alter default privileges in schema public
  grant select, insert, update on tables to authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, service_role;
