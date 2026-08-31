-- Local stand-in for the parts of Supabase the schema leans on, so the
-- migrations and the RLS tests can run against a throwaway Postgres with no
-- network and no project. Never applied to a real Supabase project — it already
-- has all of this.
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- PostgREST puts the JWT subject here; Supabase's auth.uid() reads it back.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role;  exception when duplicate_object then null; end $$;
