-- =============================================================================
-- 0002 — Clients: the person a file belongs to.
--
-- Identity is the phone number. Not because phones never change, but because in
-- a salon the phone is what gets typed at the desk, what the booking came in
-- on, and what Maya calls. Email is secondary and often shared between a mother
-- and a daughter; a name is not an identifier at all.
--
-- Two rules make that survivable:
--   1. Every phone or email a client has EVER been reached at is kept in
--      client_identities. Change your number and the old one still matches you.
--   2. Duplicates are merged, never deleted. The loser row stays and points at
--      the winner, so an old link, an old scan, or an old receipt still resolves.
-- =============================================================================

create table public.clients (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,

  -- Primary identity. Nullable only so a walk-in can be filed before anyone has
  -- asked for a number; the app should fill it at the first opportunity.
  phone          public.phone_e164,
  email          citext check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$'),

  first_name     text check (length(btrim(first_name)) between 1 and 60),
  last_name      text check (length(btrim(last_name))  between 1 and 60),

  -- What staff should actually call her, when it differs from her legal first
  -- name. Falls back to first_name in the app, never shown empty.
  preferred_name text check (length(btrim(preferred_name)) between 1 and 60),
  pronouns       text check (length(btrim(pronouns)) <= 32),

  -- Birthday, not date of birth: salons send birthday offers, they do not need
  -- an age. Month and day only, year deliberately absent.
  birth_month    smallint check (birth_month between 1 and 12),
  birth_day      smallint check (birth_day between 1 and 31),

  -- Cosmetic profile carried between visits so a tech does not re-ask every
  -- time: undertone, nail bed shape, allergies the client volunteered,
  -- preferred length and finish. Free-shaped on purpose — it is a preference
  -- sheet, not a medical record.
  profile        jsonb not null default '{}'::jsonb,

  -- Free-text the front desk types. Long-form notes live in client_notes.
  headline_note  text check (length(headline_note) <= 400),

  status         text not null default 'active'
                   check (status in ('lead','active','lapsed','archived')),
  source         text check (length(source) <= 40),   -- try-demo, walk-in, referral…

  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz,

  -- Merge target. Set when this row lost a de-duplication; it keeps every old
  -- reference resolvable instead of breaking it.
  merged_into_id uuid references public.clients(id) on delete restrict,
  merged_at      timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  archived_at    timestamptz,

  constraint clients_merge_coherent
    check ((merged_into_id is null) = (merged_at is null)),
  constraint clients_no_self_merge
    check (merged_into_id is distinct from id),
  constraint clients_birthday_pair
    check ((birth_month is null) = (birth_day is null))
);

comment on table public.clients is
  'A person a salon keeps a file on. Phone is identity; duplicates merge, never delete.';

-- One live client per phone per tenant. Merged and archived rows are excluded,
-- so a merge frees the number for the surviving row without a delete.
create unique index clients_tenant_phone_uniq
  on public.clients (tenant_id, phone)
  where phone is not null and merged_into_id is null and archived_at is null;

create index clients_tenant_idx      on public.clients (tenant_id) where archived_at is null;
create index clients_tenant_seen_idx on public.clients (tenant_id, last_seen_at desc nulls last);
create index clients_email_idx       on public.clients (tenant_id, email) where email is not null;

-- Name search for the client list. Trigram would be better at scale; for a
-- salon's book this is the cheap, index-only path.
create index clients_name_search_idx on public.clients
  using gin (to_tsvector('simple',
    coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(preferred_name,'')));

create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------ identities --

-- Every handle this person has ever been reachable at. An inbound scan matches
-- against this table, not just clients.phone, so a changed number still lands
-- in the right file.
create table public.client_identities (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  client_id   uuid not null references public.clients(id) on delete restrict,

  kind        text not null check (kind in ('phone','email')),
  value       citext not null,

  is_primary  boolean not null default false,
  verified_at timestamptz,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz,

  unique (tenant_id, kind, value)
);

comment on table public.client_identities is
  'Historical phone/email handles. The match key for an inbound scan or booking.';

create index client_identities_client_idx on public.client_identities (client_id);

-- ------------------------------------------------------- portal accounts --

-- A client who has logged in to see her own file. Separate from tenant_members:
-- the same human could in principle be staff at one salon and a client at
-- another, and RLS must never confuse the two.
create table public.client_portal_access (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  client_id   uuid not null references public.clients(id) on delete restrict,
  user_id     uuid not null references auth.users(id) on delete restrict,

  invited_at  timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at  timestamptz,

  unique (tenant_id, user_id),
  unique (client_id, user_id)
);

comment on table public.client_portal_access is
  'Links an auth user to one client file. The client portal reads through this and nothing else.';

-- ---------------------------------------------------------------- consent --

-- What she agreed to, in the words she was shown, at the moment she agreed.
-- Append-only: a consent is never edited, only superseded by a later row.
create table public.client_consents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  client_id     uuid not null references public.clients(id) on delete restrict,

  kind          text not null
                  check (kind in ('contact','photo_storage','photo_marketing','sms','email','call_recording')),
  granted       boolean not null,

  -- The exact sentence rendered on screen. If the wording changes, the record of
  -- what she actually agreed to does not change with it.
  text_shown    text not null check (length(text_shown) between 1 and 2000),
  source        text check (length(source) <= 40),      -- try-demo, front-desk, portal
  ip            inet,
  user_agent    text check (length(user_agent) <= 400),

  granted_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

comment on table public.client_consents is
  'Append-only consent log. Never updated — a change of mind is a new row.';

create index client_consents_client_idx on public.client_consents (client_id, kind, granted_at desc);

-- ------------------------------------------------------------------ notes --

create table public.client_notes (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete restrict,
  client_id   uuid not null references public.clients(id) on delete restrict,
  author_id   uuid references auth.users(id) on delete set null,

  body        text not null check (length(btrim(body)) between 1 and 4000),
  pinned      boolean not null default false,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references auth.users(id) on delete set null
);

comment on table public.client_notes is
  'Staff notes on a client. Soft-deleted only — the salon''s memory is not disposable.';

create index client_notes_client_idx on public.client_notes (client_id, created_at desc)
  where deleted_at is null;

create trigger client_notes_touch before update on public.client_notes
  for each row execute function public.touch_updated_at();
