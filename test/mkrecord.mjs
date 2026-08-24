/* Regenerates the mock records used by test/mock-api.py.
 *
 * These are produced by the REAL Worker engine (api/src/index.js -> buildRecord),
 * not hand-written, so the front-end is always rendering the true schema. One
 * record per tier, because each tier renders a different report shape.
 *
 *   node test/mkrecord.mjs
 */
import { buildRecord } from '../api/src/index.js';
import fs from 'fs';

const base = { photo_quality: { score: 0.86, issues: [] }, nails_visible: 5,
               confidence: 0.82, hand: 'left', undertone: 'warm',
               nail_bed: 'balanced', findings: [], flags: [] };

const CASES = {
  manageable: { ...base, wear: 'gel', findings: [
    { code: 'peeling_free_edge', fingers: ['index','middle','ring'], zone: 'tip',     severity: 'moderate' },
    { code: 'ridging_vertical',  fingers: [],                        zone: 'mid',     severity: 'mild' },
    { code: 'cuticle_dry',       fingers: ['thumb','index'],         zone: 'cuticle', severity: 'mild' },
    { code: 'polish_grow_out',   fingers: [],                        zone: 'base',    severity: 'mild' },
    { code: 'healthy_cuticle',   fingers: [],                        zone: 'cuticle', severity: 'mild' }
  ]},
  healthy: { ...base, wear: 'bare', findings: [
    { code: 'healthy_plate',   fingers: [], zone: 'whole',   severity: 'mild' },
    { code: 'healthy_cuticle', fingers: [], zone: 'cuticle', severity: 'mild' },
    { code: 'even_structure',  fingers: [], zone: 'whole',   severity: 'mild' }
  ]},
  medical: { ...base, wear: 'bare', flags: ['onycholysis_lifting'], findings: [
    { code: 'thinning_plate', fingers: ['ring'], zone: 'tip', severity: 'moderate' }
  ]},
  unclear: null      // null perception is exactly how a failed vision call arrives
};

const now = new Date('2026-08-24T09:00:00Z');
for (const [tier, perception] of Object.entries(CASES)) {
  const rec = buildRecord({ id: 'demo' + tier.slice(0, 3), name: '', concern: null, perception, now });
  rec.source = 'try-demo';
  rec.assets = { image: '', report: '' };
  if (tier === 'unclear') rec.display.quality_issues = ['low_light', 'blur'];
  fs.writeFileSync(`./test/record.${tier}.json`,
    JSON.stringify({ ok: true, id: rec.id, record: rec, record_version: 2 }, null, 1));
  console.log(`${tier.padEnd(11)} -> tier=${rec.tier.padEnd(11)} checks=${rec.display.checks.length} cal=${rec.display.calendar ? rec.display.calendar.milestones.length : 'null'}`);
}
