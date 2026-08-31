/* Which salon does a request belong to?
 *
 * This is the one piece of the Worker where a bug crosses a tenant boundary.
 * The Worker holds a service key that bypasses row-level security, so if the
 * tenant could be steered by anything the caller controls — the Origin header,
 * a field in the body, a query parameter — a crafted request could write a
 * scan, a lead or a photo into somebody else's book.
 *
 * These tests exist to prove it cannot, and that every failure degrades to the
 * configured tenant rather than to a wrong one.
 *
 *   node test/tenant-test.mjs
 */
import { resolveTenant, requestHost } from '../api/src/index.js';

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { console.log('  PASS  ' + label); pass++; }
  else { console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); fail++; }
}

const req = (url, headers = {}) => new Request(url, { headers });

const SUPA = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'k' };
const FIXED = { TENANT_SLUG: 'nailscan-demo', ...SUPA };
const HOSTED = { ...FIXED, TENANT_RESOLUTION: 'host' };

// One salon in the "database"; everything else is unmapped.
let calls = 0, mode = 'ok';
globalThis.fetch = async (url, init) => {
  calls++;
  if (mode === 'throw') throw new Error('connection reset');
  const body = JSON.parse(init.body);
  const host = body.p_host;
  const row = host === 'nails.polishedaustin.com' || host === 'polished.nailscan.ai'
    ? { tenant_id: 't-1', slug: 'polished', name: 'Polished Nails', status: 'active',
        locale: 'en-US', brand: { name: 'Polished Nails' },
        primary_host: 'nails.polishedaustin.com',
        settings: { ghl_webhook_url: 'https://hooks.example.com/polished' } }
    : null;
  return { ok: true, status: 200, text: async () => JSON.stringify(row) };
};

const quiet = console.log;
const hush = () => { console.log = () => {}; };
const speak = () => { console.log = quiet; };

console.log('THE DEFAULT IS TODAY');
{
  const t = await resolveTenant(FIXED, req('https://polished.nailscan.ai/api/analyze-nails'));
  check('fixed mode ignores the hostname entirely', t.slug === 'nailscan-demo' && t.source === 'config');
  const t2 = await resolveTenant({ TENANT_SLUG: 'demo' }, req('https://anything/api/x'));
  check('no Supabase configured means no lookup', t2.source === 'config');
}

console.log('\nHOST MODE');
{
  const t = await resolveTenant(HOSTED, req('https://polished.nailscan.ai/api/analyze-nails'));
  check('a mapped hostname resolves to its salon', t.slug === 'polished' && t.source === 'host', t.slug);
  check('the brand comes with it', t.brand.name === 'Polished Nails');
  check('their CRM comes with it', t.settings.ghl_webhook_url === 'https://hooks.example.com/polished');
  // Her saved links must live on the address the salon controls, so that they
  // keep working if the salon ever leaves us.
  check('report links are built from their primary domain',
    t.brand.site === 'https://nails.polishedaustin.com', t.brand.site);

  hush();
  const u = await resolveTenant(HOSTED, req('https://someone-else.example.com/api/x'));
  speak();
  check('an unmapped hostname falls back', u.slug === 'nailscan-demo' && u.source === 'config');
}

console.log('\nTHE BOUNDARY');
{
  // The whole point. Origin is a header; curl sets it to anything.
  hush();
  const t = await resolveTenant(HOSTED, req('https://nailscan-try-api.maya-bff.workers.dev/api/lead',
    { origin: 'https://nails.polishedaustin.com' }));
  speak();
  check('Origin cannot choose a salon', t.slug === 'nailscan-demo' && t.source === 'config', t.slug);

  hush();
  const w = await resolveTenant(HOSTED, req('https://nailscan-try-api.maya-bff.workers.dev/api/x'));
  speak();
  check('a workers.dev host is refused, not guessed at', w.source === 'config');

  hush();
  const l = await resolveTenant(HOSTED, req('http://localhost:8791/api/x'));
  speak();
  check('localhost is refused too', l.source === 'config');

  check('the hostname is read from the URL, not a header',
    requestHost(req('https://a.example.com/api/x', { origin: 'https://b.example.com' })) === 'a.example.com');
  check('and it is lowercased', requestHost(req('https://A.Example.COM/api/x')) === 'a.example.com');
}

console.log('\nWHEN THE DATABASE IS HAVING A BAD DAY');
{
  mode = 'throw';
  hush();
  const t = await resolveTenant(HOSTED, req('https://never-seen-before.example.com/api/x'));
  speak();
  check('a thrown lookup falls back rather than failing the scan',
    t.slug === 'nailscan-demo' && t.source === 'config');
  mode = 'ok';
}

console.log('\nCACHING');
{
  calls = 0;
  await resolveTenant(HOSTED, req('https://polished.nailscan.ai/api/x'));
  const first = calls;
  await resolveTenant(HOSTED, req('https://polished.nailscan.ai/api/x'));
  await resolveTenant(HOSTED, req('https://polished.nailscan.ai/api/x'));
  check('repeat requests do not re-query', calls === first, `${calls} vs ${first}`);
  hush();
  const before = calls;
  await resolveTenant(HOSTED, req('https://unmapped-x.example.com/api/x'));
  await resolveTenant(HOSTED, req('https://unmapped-x.example.com/api/x'));
  speak();
  check('an unmapped host is cached too, so it cannot hammer the database', calls === before + 1);
}

console.log(`\nTOTAL  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
