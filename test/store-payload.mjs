/* Proves the Worker's client-file payload matches what the Postgres function
 * expects — without a network, a project, or a key.
 *
 * The engine builds a real record, store.js maps it, and a stubbed fetch
 * captures the exact JSON that would have gone over the wire. That JSON is
 * written to test/ingest-payload.json, which platform/supabase/tests replays
 * straight into ingest_scan() on a throwaway Postgres.
 *
 * If the mapping and the function ever drift apart, this is where it shows.
 *
 *   node test/store-payload.mjs
 */
import { buildRecord, COPY } from '../api/src/index.js';
import { ingestScan, attachLead } from '../api/src/store.js';
import fs from 'fs';

const perception = {
  photo_quality: { score: 0.86, issues: [] }, nails_visible: 5, confidence: 0.82,
  hand: 'left', undertone: 'warm', nail_bed: 'balanced', wear: 'gel',
  findings: [
    { code: 'peeling_free_edge', fingers: ['index', 'middle'], zone: 'tip', severity: 'moderate' },
    { code: 'cuticle_dry', fingers: ['thumb'], zone: 'cuticle', severity: 'mild' },
    { code: 'healthy_plate', fingers: [], zone: 'whole', severity: 'mild' }
  ],
  flags: []
};

const record = buildRecord({ id: 'q7x2m9a', name: '', concern: null, perception, now: new Date('2026-08-31T12:00:00Z') });
record.source = 'try-demo';
record.assets = {
  image:  'https://try.nailscan.ai/api/scans/q7x2m9a/photo.jpg',
  report: 'https://try.nailscan.ai/api/scans/q7x2m9a/report.html'
};

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key-not-real',
  TENANT_SLUG: 'nailscan-demo'
};

const captured = {};
globalThis.fetch = async (url, init) => {
  captured[String(url).split('/rpc/')[1]] = JSON.parse(init.body).p;
  return { ok: true, status: 200, text: async () => '{}' };
};

const isPositive = code => !!(COPY[code] && COPY[code].status === 'good');
await ingestScan(env, 'nailscan-demo', record, isPositive, 'Lovely base carrying some wear.');
await attachLead(env, 'nailscan-demo', record.id,
  { name: 'Nina Rao', salon: 'Polished', email: 'nina@example.com', phone: '+14155559999', source: 'try-demo' },
  'By submitting, you agree NailScan may contact you about your scan.');

const ing = captured.ingest_scan, att = captured.attach_lead_to_scan;

function assert(label, cond) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) process.exitCode = 1;
}

console.log('INGEST PAYLOAD');
assert('tenant + public id carried',   ing.tenant_slug === 'nailscan-demo' && ing.public_id === 'q7x2m9a');
assert('tier and wear from the gate',  ing.tier === 'manageable' && ing.wear === 'gel');
assert('perception metadata flattened', ing.photo_quality === 0.86 && ing.nails_visible === 5 && ing.hand === 'left');
assert('every finding mapped',          ing.findings.length === 3);
assert('positive findings marked',      ing.findings.filter(f => f.is_positive).length === 1);
assert('fingers survive as an array',   Array.isArray(ing.findings[0].fingers) && ing.findings[0].fingers.length === 2);
assert('both photos recorded',          ing.photos.length === 2 && ing.photos.some(p => p.kind === 'report'));
assert('calendar became milestones',    ing.milestones.length === record.display.calendar.milestones.length);
assert('primary milestone flagged',     ing.milestones.filter(m => m.is_primary).length === 1);
assert('milestone dates are ISO dates', ing.milestones.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.due_on)));
assert('whole record carried verbatim', ing.record && ing.record.id === 'q7x2m9a');

console.log('ATTACH PAYLOAD');
assert('phone is the identity',   att.phone === '+14155559999');
assert('consent text carried',    /may contact you/.test(att.consent_text));
assert('points at the same scan', att.public_id === 'q7x2m9a');

fs.writeFileSync(new URL('./ingest-payload.json', import.meta.url), JSON.stringify(ing, null, 2));
fs.writeFileSync(new URL('./attach-payload.json', import.meta.url), JSON.stringify(att, null, 2));
console.log('\nwrote test/ingest-payload.json and test/attach-payload.json');
