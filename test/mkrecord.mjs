import { buildRecord } from '../api/src/index.js';
import fs from 'fs';

// A realistic perception object — exactly what the vision module returns for a
// gel-worn hand carrying tip peeling and dry cuticles. Drives tier `manageable`,
// which is the only tier that produces a full calendar + carry block.
const perception = {
  photo_quality: { score: 0.86, issues: [] },
  wear: 'gel', hand: 'left', nails_visible: 5,
  undertone: 'warm', nail_bed: 'balanced',
  findings: [
    { code: 'peeling_free_edge', fingers: ['index','middle','ring'], zone: 'tip', severity: 'moderate' },
    { code: 'ridging_vertical',  fingers: [],                        zone: 'mid', severity: 'mild' },
    { code: 'cuticle_dry',       fingers: ['thumb','index'],         zone: 'cuticle', severity: 'mild' },
    { code: 'polish_grow_out',   fingers: [],                        zone: 'base', severity: 'mild' },
    { code: 'healthy_cuticle',   fingers: [],                        zone: 'cuticle', severity: 'mild' }
  ],
  flags: [], confidence: 0.82
};

const rec = buildRecord({ id: 'demo01x', name: '', concern: null, perception, now: new Date('2026-08-24T09:00:00Z') });
rec.source = 'try-demo';
rec.assets = { image: '', report: '' };
fs.writeFileSync('./test/record.manageable.json', JSON.stringify({ ok: true, id: rec.id, record: rec, record_version: 2 }, null, 1));
console.log('tier:', rec.tier, '| checks:', rec.display.checks.length,
            '| milestones:', rec.display.calendar.milestones.length,
            '| grown_out:', rec.display.calendar.grown_out);
