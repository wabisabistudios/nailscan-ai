-- Fixture for the RLS deny-tests: two salons that must never see each other,
-- one client with a portal login, one HQ operator.
--
-- Deliberately hostile shape — Salon A and Salon B have adjacent ids, the same
-- table, and no application code between them and the data. If isolation holds
-- here it holds in production, because in production the browser is the client.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','staff-a@example.com'),
  ('22222222-2222-2222-2222-222222222222','staff-b@example.com'),
  ('33333333-3333-3333-3333-333333333333','client-a1@example.com'),
  ('44444444-4444-4444-4444-444444444444','hq@example.com');

insert into public.tenants (id, slug, name, timezone) values
  ('aaaaaaaa-0000-0000-0000-000000000001','salon-a','Salon A','America/Toronto'),
  ('bbbbbbbb-0000-0000-0000-000000000002','salon-b','Salon B','Asia/Kolkata');

insert into public.tenant_members (tenant_id, user_id, role, display_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','owner','Ava'),
  ('bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','owner','Bo');

insert into public.platform_admins (user_id) values ('44444444-4444-4444-4444-444444444444');

insert into public.clients (id, tenant_id, phone, first_name) values
  ('cccccccc-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','+14155550101','Alice'),
  ('cccccccc-0000-0000-0000-00000000000b','bbbbbbbb-0000-0000-0000-000000000002','+919000000002','Bhavna');

insert into public.client_portal_access (tenant_id, client_id, user_id, accepted_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000a','33333333-3333-3333-3333-333333333333', now());

insert into public.client_notes (tenant_id, client_id, body) values
  ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000a','Prefers short, hates chrome.');

insert into public.scans (tenant_id, public_id, client_id, tier, wear, record) values
  ('aaaaaaaa-0000-0000-0000-000000000001','a1scan01','cccccccc-0000-0000-0000-00000000000a','manageable','gel','{}'),
  ('bbbbbbbb-0000-0000-0000-000000000002','b1scan01','cccccccc-0000-0000-0000-00000000000b','healthy','bare','{}');

insert into public.client_events (tenant_id, client_id, kind, title) values
  ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000a','scan','Nail reading — a little love'),
  ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000a','note','Desk note added');

-- Hostnames. Salon A is mid-move: the subdomain we started them on, and their
-- own domain now primary — so the links their clients hold are on an address
-- the salon controls, and keep working if they ever leave us.
insert into public.tenant_domains (tenant_id, host, is_primary, verified_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','salon-a.nailscan.ai',    false, now()),
  ('aaaaaaaa-0000-0000-0000-000000000001','nails.salonaaustin.com', true,  now()),
  ('bbbbbbbb-0000-0000-0000-000000000002','salon-b.nailscan.ai',    true,  now());

insert into public.tenant_settings (tenant_id, ghl_webhook_url, booking_url) values
  ('aaaaaaaa-0000-0000-0000-000000000001','https://hooks.example.com/salon-a','https://book.salonaaustin.com');
