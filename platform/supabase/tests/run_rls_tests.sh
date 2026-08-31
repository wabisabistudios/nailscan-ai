#!/usr/bin/env bash
#
# RLS deny-tests.
#
# These are the tests that matter most in this repo. The salon app talks to
# Supabase straight from the browser, so every guarantee about one salon not
# seeing another salon's clients is a guarantee made by Postgres and by nothing
# else. This script logs in as each kind of person and checks what they can
# actually reach.
#
# Runs against a throwaway local Postgres, not against production:
#
#   ./run_rls_tests.sh                       # uses a local socket on :5433
#   PGHOST=... PGPORT=... ./run_rls_tests.sh
#
# Bring the database up first with:
#   initdb -D /tmp/pgdata -U postgres --auth=trust
#   pg_ctl -D /tmp/pgdata -o "-p 5433 -k /tmp/pgsock" -l /tmp/pg.log start
#   psql ... -c 'create database nailscan'
#   psql ... -f supabase_local_stub.sql -f ../migrations/000*.sql -f seed_test_tenants.sql

set -uo pipefail

PGHOST="${PGHOST:-/tmp/pgsock}"
PGPORT="${PGPORT:-5433}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-nailscan}"
PSQL="psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -tAq"

STAFF_A=11111111-1111-1111-1111-111111111111
STAFF_B=22222222-2222-2222-2222-222222222222
CLIENT_A=33333333-3333-3333-3333-333333333333
HQ=44444444-4444-4444-4444-444444444444
SALON_A=aaaaaaaa-0000-0000-0000-000000000001
SALON_B=bbbbbbbb-0000-0000-0000-000000000002
SEEDED="tenant_id in ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002')"
ALICE=cccccccc-0000-0000-0000-00000000000a

pass=0; fail=0

# Run SQL as a logged-in end user, exactly as PostgREST would.
as() { $PSQL <<EOF 2>&1
select set_config('request.jwt.claim.sub', '$1', false);
set role authenticated;
$2
EOF
}

check() {
  if [ "$2" = "$3" ]; then printf '  PASS  %s\n' "$1"; pass=$((pass+1))
  else printf '  FAIL  %s  (expected %s, got %s)\n' "$1" "$2" "$3"; fail=$((fail+1)); fi
}

denied() { echo "$1" | grep -qiE 'row-level security|permission denied|append-only|not client-editable' && echo denied || echo ALLOWED; }

echo "TENANT ISOLATION"
check "staff A sees only salon A clients"      1 "$(as $STAFF_A 'select count(*) from public.clients;' | tail -1)"
check "staff B sees only salon B clients"      1 "$(as $STAFF_B 'select count(*) from public.clients;' | tail -1)"
check "staff A cannot reach salon B by id"     0 "$(as $STAFF_A "select count(*) from public.clients where tenant_id='$SALON_B';" | tail -1)"
check "staff A sees only salon A scans"        1 "$(as $STAFF_A 'select count(*) from public.scans;' | tail -1)"
# Scoped to the fixture's own tenants so the assertion holds whatever else is
# in the database — this file gets run against a scratch DB that other tests
# have already written to.
check "HQ sees across tenant lines"            2 "$(as $HQ      "select count(*) from public.clients where $SEEDED;" | tail -1)"

echo
echo "CLIENT PORTAL"
check "client sees only her own file"          1 "$(as $CLIENT_A 'select count(*) from public.clients;' | tail -1)"
check "client sees her own scan"               1 "$(as $CLIENT_A 'select count(*) from public.scans;' | tail -1)"
check "client cannot read desk notes"          0 "$(as $CLIENT_A 'select count(*) from public.client_notes;' | tail -1)"
check "client timeline hides note events"      1 "$(as $CLIENT_A 'select count(*) from public.client_events;' | tail -1)"
check "staff timeline shows every event"       2 "$(as $STAFF_A  'select count(*) from public.client_events;' | tail -1)"

echo
echo "WRITE BOUNDARIES"
check "staff A cannot write into salon B" denied "$(denied "$(as $STAFF_A "insert into public.clients (tenant_id, phone, first_name) values ('$SALON_B','+919000000009','Sneaky');")")"
check "nobody can delete a client"        denied "$(denied "$(as $STAFF_A 'delete from public.clients;')")"
check "timeline is append-only"           denied "$(denied "$(as $STAFF_A "update public.client_events set title='rewritten';")")"
check "timeline cannot be erased"         denied "$(denied "$(as $STAFF_A 'delete from public.client_events;')")"
check "client cannot archive herself"     denied "$(denied "$(as $CLIENT_A "update public.clients set status='archived' where id='$ALICE';")")"
check "client can fix her own name"           ok "$(as $CLIENT_A "update public.clients set preferred_name='Ally' where id='$ALICE';" | grep -qiE 'error|denied' && echo BLOCKED || echo ok)"

echo
echo "MULTI-TENANT IDENTITY"
check "staff A sees only their own hosts"     2 "$(as $STAFF_A 'select count(*) from public.tenant_domains;' | tail -1)"
check "staff A cannot see salon B's hosts"    0 "$(as $STAFF_A "select count(*) from public.tenant_domains where tenant_id='$SALON_B';" | tail -1)"
check "HQ sees every host"                    3 "$(as $HQ      'select count(*) from public.tenant_domains;' | tail -1)"
check "an owner reads their own CRM setting"  1 "$(as $STAFF_A 'select count(*) from public.tenant_settings;' | tail -1)"
# Pointing a hostname at a salon decides whose data a scan writes into. It is
# an HQ act, and a salon must not be able to do it to itself.
check "a salon cannot claim a hostname"  denied "$(denied "$(as $STAFF_A "insert into public.tenant_domains (tenant_id, host) values ('$SALON_A','sneaky.example.com');")")"
check "only HQ can read the overview"    denied "$(echo "$(as $STAFF_A 'select public.hq_tenant_overview();')" | grep -qi 'not_platform_admin' && echo denied || echo ALLOWED)"
check "HQ overview returns both salons"       2 "$(as $HQ 'select jsonb_array_length(public.hq_tenant_overview());' | tail -1)"

echo
printf 'TOTAL  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
