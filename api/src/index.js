// NailScan Try — Nail Reading Worker
//
// Cloned from based-nail-scanner (Based Aesthetics) on 2026-08-24. The engine is
// carried over UNCHANGED: perception prompt, finding/flag vocabulary, tier gate,
// calendar rules, copy bank and trends list are byte-identical to the original.
// The model only PERCEIVES. All dates, copy, and decisions are deterministic code.
//
// What this clone changes, and only this:
//   1. BRAND config below replaces every hard-coded Based Aesthetics reference.
//   2. Phone normalises against a caller-supplied country, not hard-coded +91.
//   3. Lead capture is SPLIT OUT of the scan. POST /api/analyze-nails takes an
//      image and nothing else, and pushes no lead. POST /api/lead attaches the
//      contact to an existing record. That split is what lets the contact form
//      appear once, at the report reveal, instead of gating the camera.
//   4. Copy uses American spelling (US market).
//
// See docs/api-contract.md for the original contract this was derived from.

import { ingestScan, attachLead, recordPlanSaved, rpcResolveHost, storeConfigured } from './store.js';

// ============================== BRAND ==============================
// White-label boundary, our side. Nothing here is client-configurable.

// Defaults, not constants. Everything a salon should be able to change is read
// through brandFor(env) below, which prefers the deployment's own vars — so the
// same code serves a NailScan demo and a salon install without an edit.
const DEFAULT_BRAND = {
  name:    'NailScan',
  site:    'https://try.nailscan.ai',
  locale:  'en-US',
  city:    '',                       // appended to booking CTAs when set
  // Report-snapshot palette. Mirrors public/css/app.css, which mirrors
  // nailscan.ai. The archival copy has to look like the reading she was
  // actually shown, or it is not an archive of anything.
  ink:     '#F4F6F8',      // type on the dark ground
  inkSoft: '#8A939F',
  ground:  '#07080A',
  paper:   '#0F1216',
  lacquer: '#FF5233',
  field:   '#3ED598',
  amber:   '#F2B84B'
};

// The salon's own identity, per deployment. Falls back to NailScan's for the
// demo install. Colours are deliberately NOT in here: the palette is the
// instrument's, not the client's (see public/config.js for why).
function brandFor(env) {
  if (!env) return DEFAULT_BRAND;
  return {
    ...DEFAULT_BRAND,
    name:   env.BRAND_NAME   || DEFAULT_BRAND.name,
    site:   env.SITE_BASE    || DEFAULT_BRAND.site,
    locale: env.BRAND_LOCALE || DEFAULT_BRAND.locale,
    city:   env.BRAND_CITY   || DEFAULT_BRAND.city
  };
}

// ============================== PERCEPTION ==============================

const FINDING_CODES = [
  'ridging_vertical','grooves_longitudinal','lines_transverse','peeling_free_edge',
  'splitting_lateral','white_spots_surface','surface_rough_patches','thinning_plate',
  'dryness_dull','micro_cracks','breakage_chips','cuticle_dry','cuticle_overgrown',
  'cuticle_picked','shape_uneven_length','polish_grow_out','staining_yellow_mild',
  'healthy_plate','healthy_cuticle','even_structure'
];

const FLAG_CODES = [
  'pigment_band_dark','onycholysis_lifting','lifting_with_discoloration',
  'green_discoloration','plate_crumbling','fold_inflammation_pus',
  'blisters_fluid','exposed_bed_or_bleeding','pitting_oil_drop_debris'
];

const FINGERS = ['thumb','index','middle','ring','little'];

function visionPrompt() {
  return `You are the perception module of a nail-photo reader for a nail wellness studio. You look at ONE photo of a hand and report ONLY what is clearly visible, as strict JSON. You never diagnose, never advise, never write prose.

Return ONLY a JSON object (no markdown fences, no commentary) with exactly this shape:
{
 "photo_quality": {"score": <0..1>, "issues": [<"blur"|"glare"|"too_far"|"cropped"|"low_light">...]},
 "wear": <"bare"|"polish"|"gel"|"acrylic"|"extensions"|"unknown">,
 "hand": <"left"|"right"|"unknown">,
 "nails_visible": <0..5>,
 "undertone": <"warm"|"cool"|"neutral"|"unknown">,
 "nail_bed": <"short_wide"|"long_narrow"|"balanced"|"unknown">,
 "findings": [{"code": <code>, "fingers": [<"thumb"|"index"|"middle"|"ring"|"little">...], "zone": <"tip"|"mid"|"base"|"cuticle"|"folds"|"whole">, "severity": <"mild"|"moderate"|"marked">}],
 "flags": [<flag>...],
 "confidence": <0..1>
}

finding codes (use ONLY these): ${FINDING_CODES.join(', ')}.
flag codes (use ONLY these): ${FLAG_CODES.join(', ')}.

Rules:
- Findings: report only what is clearly visible at this resolution. If unsure, omit. Use "fingers": [] when you cannot tell which fingers.
- Positive findings matter: if the plate, cuticles, or overall structure look genuinely good, include healthy_plate / healthy_cuticle / even_structure.
- Colour caution: phone white balance lies. Under warm or yellow light, do NOT report staining or discoloration unless unmistakable.
- Flags are serious-only and must be CLEARLY visible: a dark longitudinal band (pigment_band_dark); plate visibly lifting from the bed (onycholysis_lifting); lifting together with colour change (lifting_with_discoloration); green tint (green_discoloration); crumbling plate (plate_crumbling); red swollen folds with pus (fold_inflammation_pus); fluid blisters (blisters_fluid); exposed bed or bleeding (exposed_bed_or_bleeding); pitting plus oil-drop patches plus debris under the nail (pitting_oil_drop_debris). When in genuine doubt between flag and no-flag on a dark band, INCLUDE the flag.
- photo_quality.score reflects how confidently nails can be read: sharp, daylight, 4-5 nails filling frame = high.
- confidence is your overall confidence in the findings.
- undertone / nail_bed are for COSMETIC STYLING only (never health). undertone: the skin's undertone — "warm" (golden/olive/yellow), "cool" (pink/blue/rosy), or "neutral". Under obviously coloured light, use "unknown". nail_bed: the natural nail-bed proportion — "short_wide" (bed wider than it is long), "long_narrow" (bed longer than it is wide), or "balanced". If you genuinely cannot tell, use "unknown".
JSON only.`;
}

async function callVision(env, imageB64, mediaType) {
  const model = env.VISION_MODEL || 'claude-sonnet-4-6';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageB64 } },
          { type: 'text', text: visionPrompt() }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error('vision_http_' + res.status);
  const data = await res.json();
  const text = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('');
  return parsePerception(text);
}

function parsePerception(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const p = JSON.parse(m ? m[0] : text);
    // sanitize hard
    const pq = p.photo_quality || {};
    const out = {
      photo_quality: { score: clamp01(pq.score), issues: arr(pq.issues).filter(s => typeof s === 'string').slice(0, 5) },
      wear: oneOf(p.wear, ['bare','polish','gel','acrylic','extensions','unknown'], 'unknown'),
      hand: oneOf(p.hand, ['left','right','unknown'], 'unknown'),
      nails_visible: Math.max(0, Math.min(5, parseInt(p.nails_visible, 10) || 0)),
      undertone: oneOf(p.undertone, ['warm','cool','neutral','unknown'], 'unknown'),
      nail_bed: oneOf(p.nail_bed, ['short_wide','long_narrow','balanced','unknown'], 'unknown'),
      findings: arr(p.findings).map(f => ({
        code: oneOf(f && f.code, FINDING_CODES, null),
        fingers: arr(f && f.fingers).filter(x => FINGERS.includes(x)),
        zone: oneOf(f && f.zone, ['tip','mid','base','cuticle','folds','whole'], 'whole'),
        severity: oneOf(f && f.severity, ['mild','moderate','marked'], 'mild')
      })).filter(f => f.code).slice(0, 10),
      flags: arr(p.flags).filter(x => FLAG_CODES.includes(x)).slice(0, 6),
      confidence: clamp01(p.confidence)
    };
    return out;
  } catch (e) {
    return null; // caller maps null -> unclear, never medical
  }
}

const clamp01 = v => { const n = Number(v); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };
const arr = v => Array.isArray(v) ? v : [];
const oneOf = (v, list, dflt) => list.includes(v) ? v : dflt;

// ============================== TIER GATE ==============================

const CARE_CODES = ['peeling_free_edge','splitting_lateral','thinning_plate','micro_cracks','breakage_chips','white_spots_surface','surface_rough_patches','grooves_longitudinal','lines_transverse'];

function decideTier(p) {
  if (!p) return 'unclear';
  if (p.flags.length > 0) return 'medical';
  if (p.photo_quality.score < 0.45 || p.nails_visible < 3 || p.confidence < 0.5) return 'unclear';
  const hasCare = p.findings.some(f => CARE_CODES.includes(f.code));
  const hasNote = p.findings.some(f => ['ridging_vertical','dryness_dull','cuticle_dry','cuticle_picked','cuticle_overgrown','staining_yellow_mild','polish_grow_out'].includes(f.code));
  if (hasCare) return 'manageable';
  if (hasNote) return 'manageable';
  return 'healthy';
}

// ============================== COPY BANK ==============================
// Every sentence a person reads lives here. Carried over verbatim from the
// original bank: this is the product a salon owner is being shown.

const COPY = {
  ridging_vertical:    { k: 'Surface', hd: 'Fine vertical ridges', v: 'Fine vertical ridges with light dryness — asking for <b>moisture, not repair.</b>', status: 'note', mark: { color: 'marigold', zone: 'mid' } },
  grooves_longitudinal:{ k: 'Surface', hd: 'Deeper lengthwise grooves', v: 'Deeper lengthwise grooves — these should <b>never be filed flat;</b> they thin the plate. Care works around them.', status: 'note', mark: { color: 'marigold', zone: 'mid' } },
  lines_transverse:    { k: 'Surface', hd: 'Lines across the plate', v: 'Faint lines running across the plate — usually a record of a rough few weeks months ago, now growing out.', status: 'note', mark: { color: 'marigold', zone: 'mid' } },
  peeling_free_edge:   { k: 'Free edge', hd: 'Tips peeling in layers', v: 'The tips are peeling in layers — the signature of <b>coatings taken off the hard way.</b>', status: 'note', mark: { color: 'red', zone: 'tip' }, fig: 'cross_section' },
  splitting_lateral:   { k: 'Free edge', hd: 'A split at the side', v: 'A split starting at the side — worth keeping short and protected while it grows past.', status: 'note', mark: { color: 'red', zone: 'tip' } },
  white_spots_surface: { k: 'Surface', hd: 'White patches', v: 'White patches on the surface — almost always <b>removal trauma,</b> not a vitamin story.', status: 'note', mark: { color: 'red', zone: 'mid' }, fig: 'cross_section' },
  surface_rough_patches:{ k: 'Surface', hd: 'Rough patches on the surface', v: 'Rough patches where the top layers have been disturbed — they grow out; they don\u2019t need sanding down.', status: 'note', mark: { color: 'red', zone: 'mid' } },
  thinning_plate:      { k: 'Plate', hd: 'The plate reads thin', v: 'The plate reads thin — bendy tips, shadows under light. It rebuilds; it just needs the cycle broken.', status: 'note', mark: { color: 'red', zone: 'tip' }, fig: 'cross_section' },
  dryness_dull:        { k: 'Surface', hd: 'Thirsty and a little dull', v: 'Reading a little thirsty and dull — the kind of thing daily oil visibly reverses.', status: 'note', mark: { color: 'marigold', zone: 'whole' } },
  micro_cracks:        { k: 'Plate', hd: 'Hairline cracks', v: 'Hairline cracks across the plate — keep length moderate while they grow past.', status: 'note', mark: { color: 'red', zone: 'tip' } },
  breakage_chips:      { k: 'Free edge', hd: 'Chips at the edge', v: 'Chips and breaks at the edge — strength first, length later.', status: 'note', mark: { color: 'red', zone: 'tip' } },
  cuticle_dry:         { k: 'Cuticle', hd: 'Cuticles intact but dry', v: 'Cuticles are intact but dry — a drop of oil a day is the whole prescription.', status: 'note', mark: { color: 'marigold', zone: 'cuticle' } },
  cuticle_overgrown:   { k: 'Cuticle', hd: 'Cuticles crept up the plate', v: 'Cuticles have crept up the plate — they want a gentle professional push-back, never cutting at home.', status: 'note', mark: { color: 'marigold', zone: 'cuticle' } },
  cuticle_picked:      { k: 'Cuticle', hd: 'Signs of picking', v: 'Signs of picking at the edges — your nails\u2019 only request is that you let the studio handle it.', status: 'note', mark: { color: 'red', zone: 'cuticle' } },
  shape_uneven_length: { k: 'Structure', hd: 'Uneven lengths', v: 'Lengths are uneven across the hand — one good shaping session resets the line.', status: 'note', mark: { color: 'marigold', zone: 'tip' } },
  polish_grow_out:     { k: 'Wear', hd: 'Grow-out at the base', v: 'Visible grow-out at the base — the coat is past its best and starting to lever at the edges.', status: 'note', mark: { color: 'marigold', zone: 'base' } },
  staining_yellow_mild:{ k: 'Color', hd: 'Mild yellowing', v: 'Mild yellowing from pigment — cosmetic, and it grows out faster with a proper base coat next time.', status: 'note', mark: { color: 'marigold', zone: 'whole' } },
  healthy_plate:       { k: 'Plate', hd: 'A smooth, even plate', v: 'A smooth, even plate — whatever you\u2019re doing, it\u2019s working.', status: 'good' },
  healthy_cuticle:     { k: 'Cuticle', hd: 'Healthy cuticles', v: 'Healthy, intact cuticles — whoever\u2019s been minding them, keep going.', status: 'good' },
  even_structure:      { k: 'Structure', hd: 'Even length and shape', v: 'Even length and shape across the hand.', status: 'good' }
};

const ZONE_WORDS = { tip: 'tips', mid: 'mid-plate', base: 'base', cuticle: 'cuticles', folds: 'nail folds', whole: 'across the plate' };

function fingersPhrase(fingers) {
  if (!fingers || fingers.length === 0 || fingers.length === 5) return 'all five';
  return fingers.join(' + ');
}

const TIER_COPY = {
  healthy: {
    num: '1/4', label: 'HEALTHY',
    headline: (n) => `${n ? n + ', y' : 'Y'}our nails are <span class="italic">genuinely healthy.</span>`,
    line: 'Strong, even, cared-for. <span class="hl">Ready for anything.</span>',
    sub: 'No repair needed and nothing to fix — which makes them the perfect canvas. The calendar below is just maintenance rhythm.',
    calIntro: 'Nothing to undo — this is simply the rhythm that keeps them this way.'
  },
  manageable: {
    num: '2/4', label: 'A LITTLE LOVE',
    headline: (n) => `${n ? n + ', y' : 'Y'}our nails are asking for <span class="italic">a little love.</span>`,
    line: 'Lovely base. Some wear. <span class="hl">Entirely reversible.</span>',
    sub: 'No drama, no upsell. Good condition carrying some wear — mapped nail by nail below, with the schedule that undoes it.',
    calIntro: 'Dates computed from your photo. The wear grows <b>out</b>, not deeper. Save them — this is the whole plan.'
  },
  medical: {
    num: '3/4', label: 'WORTH A CHECK',
    headline: (n) => `${n ? n + ', w' : 'W'}e noticed something worth <span class="italic">checking first.</span>`,
    line: 'Most likely nothing. <span class="hl">Checked is better than guessed.</span>',
    sub: 'We spotted a change that sits outside cosmetic care. It\u2019s very often completely harmless — but we\u2019d rather be careful with you than clever.',
    medical: 'We\u2019re a nail studio, not a clinic, so we can\u2019t diagnose — but we noticed a change in color or structure that\u2019s best looked at by a dermatologist before any cosmetic treatment. It\u2019s very often nothing; a quick check just gives everyone peace of mind. Bring this reading along if it helps.'
  },
  unclear: {
    num: '4/4', label: 'COULDN\u2019T READ',
    headline: () => `We couldn\u2019t quite <span class="italic">read that one.</span>`,
    line: 'Too soft to call. <span class="hl">We\u2019d rather say so than guess.</span>',
    sub: 'The photo came through a little too unclear for an honest reading — and honest is the whole point.'
  }
};

// ============================== CALENDAR RULES ==============================

const BRAND = DEFAULT_BRAND;          // module-level default; request paths use brandFor(env)
const LOCALITY = BRAND.city ? ' \u00b7 ' + BRAND.city : '';

const DAY = 86400000;
function addDays(t, d) { return new Date(t + d * DAY); }
function iso(d) { return d.toISOString().slice(0, 10); }

const GROW_OUT_WEEKS = { tip: 10, mid: 18, base: 26, whole: 18, cuticle: 10, folds: 10 };

function worstZone(findings) {
  let weeks = 0, zone = null;
  for (const f of findings) {
    const c = COPY[f.code];
    if (!c || c.status !== 'note') continue;
    if (!c.mark || c.mark.color !== 'red') continue;
    const z = c.mark.zone === 'whole' ? f.zone : (f.zone || c.mark.zone);
    const w = GROW_OUT_WEEKS[z] || 18;
    if (w > weeks) { weeks = w; zone = z; }
  }
  return zone ? { zone, weeks } : null;
}

function buildCalendar(tier, wear, findings, now) {
  if (tier === 'medical' || tier === 'unclear') return null;
  const t = now.getTime();
  const ms = [];
  const grow = worstZone(findings);

  if (tier === 'healthy') {
    ms.push({ date: iso(addDays(t, 2)), label: 'Book anything', sub: 'Mani, art, gel — your nails are ready', kind: 'action', primary: true, service: 'classic-manicure', cta: 'Book a manicure or nail art' });
    ms.push({ date: iso(addDays(t, 7)), label: 'Daily oil habit set', sub: 'One drop, every night', kind: 'check' });
    ms.push({ date: iso(addDays(t, 56)), label: 'Shape check', sub: 'A tidy-up keeps the line perfect', kind: 'goal' });
    return { milestones: ms, grown_out: null };
  }

  // manageable
  if (wear === 'gel' || wear === 'extensions') {
    const removal = addDays(t, 14), visit = addDays(t, 28), check = addDays(t, 46);
    ms.push({ date: iso(removal), label: 'Gel removal-by', sub: '(soaked, never peeled)', kind: 'action', primary: true, service: 'gel-removal', cta: `Secure the ${fmtShort(removal)} removal slot`, ctaSub: 'Soak-off removal, never peeled \u00b7 20 min' + LOCALITY });
    ms.push({ date: iso(visit), label: 'Strengthening visit', sub: 'polish-free block ends', kind: 'action', service: 'biab-nail-strengthening-therapy' });
    ms.push({ date: iso(check), label: 'Recovery check', sub: 'ridges should soften', kind: 'check' });
  } else if (wear === 'acrylic') {
    const removal = addDays(t, 21), visit = addDays(t, 35), check = addDays(t, 56);
    ms.push({ date: iso(removal), label: 'Acrylic removal-by', sub: '(professional soak-off only)', kind: 'action', primary: true, service: 'acrylic-removal', cta: `Secure the ${fmtShort(removal)} removal slot`, ctaSub: 'Professional soak-off' + LOCALITY });
    ms.push({ date: iso(visit), label: 'Strengthening visit', sub: 'plate recovery begins', kind: 'action', service: 'biab-nail-strengthening-therapy' });
    ms.push({ date: iso(check), label: 'Recovery check', sub: 'flexibility returning', kind: 'check' });
  } else {
    const visit = addDays(t, 5), oil = addDays(t, 19), check = addDays(t, 40);
    ms.push({ date: iso(visit), label: 'Strengthening visit', sub: 'the reset starts here', kind: 'action', primary: true, service: 'biab-nail-strengthening-therapy', cta: `Secure the ${fmtShort(visit)} strengthening slot`, ctaSub: 'BIAB strengthening \u00b7 75 min' + LOCALITY });
    ms.push({ date: iso(oil), label: 'Oil habit check', sub: 'two weeks of daily drops', kind: 'check' });
    ms.push({ date: iso(check), label: 'Recovery check', sub: 'surface should be smoothing', kind: 'check' });
  }

  let grown_out = null;
  if (grow) {
    const g = addDays(t, grow.weeks * 7);
    grown_out = { date: iso(g), zone: grow.zone };
    ms.push({ date: iso(g), label: grow.zone === 'tip' ? 'Tip damage fully grown out' : 'Damage fully grown out', sub: '\u2248 3mm of growth a month', kind: 'goal' });
  }
  return { milestones: ms.slice(0, 4), grown_out };
}

function fmtShort(d) {
  return d.toLocaleDateString(BRAND.locale, { month: 'short', day: 'numeric' }).replace(/(\w+) (\d+)/, '$1 $2');
}

// ============================== TRENDS ==============================
// AK's editable list. tags: healthy_only | needs_length | recovery_friendly | after_recovery

const TRENDS = [
  { name: 'Glazed nude', line: 'Sheer, glossy, one coat — lets the plate breathe and recover while still looking finished.', tags: ['recovery_friendly'] },
  { name: 'Milky white', line: 'Clean, bright, office-and-wedding proof — gentle on a recovering plate.', tags: ['recovery_friendly'] },
  { name: 'Sheer pink BIAB', line: 'Strength that looks like nothing at all — the recovery workhorse.', tags: ['recovery_friendly'] },
  { name: 'Micro French', line: 'A whisper of a tip line — neat on any length.', tags: ['recovery_friendly', 'healthy_only'] },
  { name: 'Chrome', line: 'Mirror finish that loves an even, healthy plate.', tags: ['after_recovery', 'healthy_only'] },
  { name: 'Velvet cat-eye', line: 'Magnetic depth that reads expensive in person.', tags: ['after_recovery', 'healthy_only'] },
  { name: 'Classic deep red', line: 'The forever flex — best on a strong, smooth plate.', tags: ['after_recovery', 'healthy_only'] },
  { name: 'Minimal art accent', line: 'One nail, one idea — maximum taste, minimum commitment.', tags: ['healthy_only', 'recovery_friendly'] }
];

function pickTrends(tier, grown_out) {
  if (tier === 'medical' || tier === 'unclear') return null;
  if (tier === 'healthy') {
    const now = TRENDS.find(x => x.tags.includes('healthy_only')) || TRENDS[0];
    const later = TRENDS.find(x => x.tags.includes('after_recovery') && x !== now) || TRENDS[4];
    return {
      now: { tag: 'Now', name: now.name, line: now.line, when: 'Your nails are ready' },
      later: { tag: 'Also yours', name: later.name, line: later.line, when: 'Whenever you like' }
    };
  }
  const now = TRENDS.find(x => x.tags.includes('recovery_friendly')) || TRENDS[0];
  const later = TRENDS.find(x => x.tags.includes('after_recovery')) || TRENDS[4];
  const when = grown_out ? ('After ' + fmtShortIso(grown_out.date)) : 'After recovery';
  return {
    now: { tag: 'Now', name: now.name, line: now.line, when: 'Safe during recovery' },
    later: { tag: when, name: later.name, line: later.line, when: 'Unlocked by your calendar' }
  };
}

function fmtShortIso(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString(BRAND.locale, { month: 'short', day: 'numeric' });
}

// ============================== RECORD BUILDER ==============================

function buildChecks(tier, findings) {
  if (tier === 'unclear') return [];
  const rows = [];
  const seen = new Set();
  // notes first, then goods; cap 6
  const ordered = [...findings.filter(f => COPY[f.code] && COPY[f.code].status === 'note'),
                   ...findings.filter(f => COPY[f.code] && COPY[f.code].status === 'good')];
  for (const f of ordered) {
    if (seen.has(f.code) || rows.length >= 6) continue;
    seen.add(f.code);
    const c = COPY[f.code];
    const zone = c.mark && c.mark.zone !== 'whole' ? (f.zone && f.zone !== 'whole' ? f.zone : c.mark.zone) : f.zone;
    const where = c.status === 'good' ? fingersPhrase(f.fingers)
      : `${fingersPhrase(f.fingers)}${zone && zone !== 'whole' ? ', ' + ZONE_WORDS[zone] : ''}`;
    // `hd` is the two-second version, `k` the location, `v` the full sentence.
    // The report shows hd alone and opens the rest on a tap — a reading that
    // reads as a wall of prose is a reading nobody finishes.
    rows.push({ hd: c.hd || c.k, k: `${c.k} \u00b7 ${where}`, v: c.v, status: c.status });
  }
  if (rows.length === 0 && tier === 'healthy') {
    rows.push({ hd: COPY.healthy_plate.hd, k: 'Plate \u00b7 all five', v: COPY.healthy_plate.v, status: 'good' });
    rows.push({ hd: COPY.even_structure.hd, k: 'Structure \u00b7 all five', v: COPY.even_structure.v, status: 'good' });
  }
  return rows;
}

function buildMap(tier, p) {
  if (tier === 'unclear' || !p) return null;
  const marks = [];
  let cuticle = 'none';
  for (const f of p.findings) {
    const c = COPY[f.code];
    if (!c) continue;
    if (f.code === 'healthy_cuticle' && cuticle === 'none') cuticle = 'good';
    if (!c.mark) continue;
    const zone = (f.zone && f.zone !== 'whole') ? f.zone : c.mark.zone;
    if (zone === 'cuticle' || zone === 'folds') {
      cuticle = c.mark.color === 'red' ? 'red' : (cuticle === 'red' ? 'red' : 'marigold');
      continue;
    }
    const fingers = (f.fingers && f.fingers.length) ? f.fingers.map(x => FINGERS.indexOf(x)) : [0,1,2,3,4];
    marks.push({ color: c.mark.color, zone: zone === 'whole' ? 'mid' : zone, fingers, label: c.k });
  }
  if (cuticle === 'none') cuticle = p.findings.some(f => f.code === 'healthy_cuticle') ? 'good' : 'good';
  return { hand: p.hand, marks: marks.slice(0, 6), cuticle };
}

function buildFigures(tier, findings, grown_out) {
  return {
    cross_section: tier === 'manageable' && findings.some(f => COPY[f.code] && COPY[f.code].fig === 'cross_section'),
    growth: tier === 'manageable' && !!grown_out
  };
}

function buildRecord({ id, name, concern, perception, now }) {
  const tier = decideTier(perception);
  const p = perception;
  const tc = TIER_COPY[tier];
  const cal = buildCalendar(tier, p ? p.wear : 'unknown', p ? p.findings : [], now);
  const grown_out = cal ? cal.grown_out : null;
  const carry = pickTrends(tier, grown_out);
  const checks = buildChecks(tier, p ? p.findings : []);
  const map = buildMap(tier, p);
  const figures = buildFigures(tier, p ? p.findings : [], grown_out);

  const primary = cal ? cal.milestones.find(m => m.primary) : null;

  const record = {
    v: 2, id, name: name || '', created_at: now.toISOString(), concern: concern || null,
    tier,
    wear: p ? p.wear : 'unknown',
    display: {
      headline: tc.headline(name || ''),
      verdict: { num: tc.num, label: tc.label, line: tc.line, sub: tc.sub },
      checks,
      map,
      figures,
      calendar: cal ? {
        intro: tc.calIntro || '',
        milestones: cal.milestones,
        grown_out: grown_out ? grown_out.date : null,
        book: primary ? { label: primary.cta || ('Book: ' + primary.label), sub: primary.ctaSub || '', service: primary.service || '', date: primary.date } : null
      } : null,
      carry,
      medical: tier === 'medical' ? tc.medical : null,
      quality_issues: tier === 'unclear' && p ? p.photo_quality.issues : []
    },
    perception: p ? { findings: p.findings, flags: p.flags, photo_quality: p.photo_quality, confidence: p.confidence, nails_visible: p.nails_visible, hand: p.hand, undertone: p.undertone, nail_bed: p.nail_bed } : null
  };
  return record;
}

// =================== LEGACY RESPONSE (deployed scan.html) ===================

function legacyFromRecord(rec, reportUrl) {
  const d = rec.display;
  const conditions = d.checks.map(c => {
    const plain = c.v.replace(/<[^>]+>/g, '');
    return plain;
  });
  const tierLabelMap = { healthy: 'Healthy', manageable: 'A little love', medical: 'Worth a check', unclear: 'Couldn\u2019t read' };
  const tierNameMap = {
    healthy: 'No repair needed \u2014 ready for anything',
    manageable: 'A little care brings them right back',
    medical: 'Best to see a doctor first',
    unclear: 'We need a clearer photo'
  };
  const book = d.calendar && d.calendar.book;
  const rcmd = (() => {
    if (rec.tier === 'unclear') return 'Try once more in natural daylight, hand flat and palm down, with four or five nails filling the frame.';
    if (rec.tier === 'medical') return '';
    if (!d.calendar) return '';
    const m = d.calendar.milestones[0];
    const g = d.calendar.grown_out ? ` At normal growth, the wear we see is fully grown out around ${fmtShortIso(d.calendar.grown_out)}.` : '';
    return `Your nail calendar starts ${fmtShortIso(m.date)}: ${m.label.toLowerCase()}${m.sub ? ' ' + m.sub : ''}.${g} The full plan is in your reading.`;
  })();
  return {
    tier: rec.tier,
    tierLabel: tierLabelMap[rec.tier],
    tierName: tierNameMap[rec.tier],
    headline: d.headline,
    summary: d.verdict.sub,
    conditions,
    recommendation: rcmd,
    medical: d.medical || '',
    showCta: !!book,
    ctaService: book ? book.service : '',
    ctaText: book ? book.label : '',
    ctaMeta: book ? 'From your nail calendar' : '',
    report_url: reportUrl || ''
  };
}

// ============================== GHL ==============================

// Normalise a phone number to E.164 against a caller-supplied ISO country code.
// The original worker hard-coded +91; this audience is US and Canadian salon
// owners, so the country has to come from the form. Falls back to US.
//
// Handles: bare national numbers, a 00 international prefix, an already-+CC
// number, and the NANP trunk 1. Anything it cannot confidently map is returned
// digits-with-+ (best effort) rather than dropped.
const DIAL = { US: '1', CA: '1', GB: '44', AU: '61', IN: '91' };
const NANP_LEN = 10;

function normalizePhone(raw, country) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const cc = DIAL[String(country || '').toUpperCase()] || DIAL.US;
  let digits = s.replace(/\D/g, '');
  if (!digits) return s;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(cc) && digits.length > cc.length + 6) return '+' + digits;
  if (cc === '1') {
    if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
    if (digits.length === NANP_LEN) return '+1' + digits;
  }
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);  // trunk 0
  if (digits.length >= 7 && digits.length <= 12) return '+' + cc + digits;
  return '+' + digits;
}

// One inbound-webhook workflow in the NailScan.ai GHL sub-account
// (location cj1dKYGBhaLLrI6e0Jkg). Keys are snake_case; the key -> custom-field
// mapping lives inside the GHL workflow, exactly as in the original. Never
// blocks the caller: a CRM failure is logged and swallowed.
async function pushGHL(env, payload, tenant) {
  // The salon's own CRM when they have configured one; ours otherwise. A salon
  // that wants its leads in its own GoHighLevel gets that, and does not have
  // to take our word for what we do with them.
  const url = (tenant && tenant.settings && tenant.settings.ghl_webhook_url) || env.GHL_WEBHOOK_URL;
  if (!url) { console.log(`[GHL] ${payload && payload.event}: no webhook url configured`); return false; }
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const snippet = (await res.text().catch(() => '')).slice(0, 200);
    console.log(`[GHL] ${payload.event}: phone=${JSON.stringify(payload.phone)} country=${JSON.stringify(payload.country)} HTTP ${res.status}${res.ok ? '' : ' NOT-OK'} ${snippet}`);
    return res.ok;
  } catch (e) {
    console.log(`[GHL] ${payload && payload.event}: FETCH FAILED ${e && e.message}`);
    return false;
  }
}

// ============================== R2 STORAGE ==============================
// Persist each scan's photo + a self-contained report snapshot to R2, served
// back through this Worker at permanent /api/scans/<id>/<file> URLs (no signed
// URL 7-day cap, no public-bucket exposure). All best-effort: a storage failure
// must never block lead capture, so callers fall back to empty URL strings.

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Plain-text, 2–3 sentence findings summary for the CRM (scan_summary).
function buildScanSummary(record) {
  const d = record.display || {};
  const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (record.tier === 'unclear') {
    return strip(d.verdict && d.verdict.sub) ||
      'The photo was too unclear for a confident reading. A retake in daylight, hand flat with four or five nails filling the frame, gives an honest result.';
  }
  const parts = [];
  if (d.headline) parts.push(strip(d.headline));
  if (d.verdict && d.verdict.sub) parts.push(strip(d.verdict.sub));
  const notes = (d.checks || []).filter(c => c.status === 'note').slice(0, 2).map(c => strip(c.v));
  if (notes.length) parts.push('Noted: ' + notes.join(' '));
  return parts.filter(Boolean).join(' ').slice(0, 600);
}

// Self-contained, styled snapshot of the reading — no JS, no external data deps.
// Archival copy only: stored in R2, never surfaced to a client or to staff.
// Palette and type mirror public/css/app.css so the snapshot reads as the same
// product, and the whole thing is driven by BRAND.
function renderReportHtml(record, brand) {
  const BRAND = brand || DEFAULT_BRAND;   // shadows the module default on purpose
  const d = record.display || {};
  const v = d.verdict || {};
  let dateStr = '';
  try { dateStr = new Date(record.created_at).toLocaleDateString(BRAND.locale, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) {}
  const checks = (d.checks || []).map(c =>
    `<li class="chk ${c.status === 'good' ? 'good' : 'note'}"><span class="hd">${esc(c.hd || c.k)}</span><span class="k">${esc(c.k)}</span><span class="v">${c.v}</span></li>`
  ).join('');
  const ms = ((d.calendar && d.calendar.milestones) || []).map(m =>
    `<li class="ms"><span class="dt">${esc(fmtShortIso(m.date))}</span><span class="bd"><b>${esc(m.label)}</b>${m.sub ? `<span class="s">${esc(m.sub)}</span>` : ''}</span></li>`
  ).join('');
  const medical = d.medical ? `<div class="sec"><div class="lbl">Worth a check</div><p class="sub">${esc(d.medical)}</p></div>` : '';
  const carry = d.carry ? `<div class="sec"><div class="lbl">What suits you</div>
    <div class="carry"><span class="pill">${esc(d.carry.now.tag)}</span><b>${esc(d.carry.now.name)}</b><span class="cl">${esc(d.carry.now.line)}</span></div>
    <div class="carry"><span class="pill">${esc(d.carry.later.tag)}</span><b>${esc(d.carry.later.name)}</b><span class="cl">${esc(d.carry.later.line)}</span></div></div>` : '';
  const grown = d.calendar && d.calendar.grown_out
    ? `<p class="sub">At normal growth, the wear in this photo is fully grown out around ${esc(fmtShortIso(d.calendar.grown_out))}.</p>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Nail reading &middot; ${esc(BRAND.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
:root{--ink:${BRAND.ink};--ink2:${BRAND.inkSoft};--ground:${BRAND.ground};--paper:${BRAND.paper};--lacquer:${BRAND.lacquer};--field:${BRAND.field};--amber:${BRAND.amber};--line:#1C2128;--line2:#262D36;--s:'Geist',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;--m:'Geist Mono',ui-monospace,monospace;--d:'Instrument Serif','Iowan Old Style',Georgia,serif;}
*{box-sizing:border-box;}body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--s);line-height:1.55;-webkit-font-smoothing:antialiased;}
.wrap{max-width:560px;margin:0 auto;padding:30px 22px 56px;}
.top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--line2);padding-bottom:11px;font-family:var(--m);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink2);}
.top b{font-family:var(--s);font-weight:700;letter-spacing:.22em;color:var(--ink);}
.verdict{padding:24px 0;border-bottom:1px solid var(--line);}
.badge{font-family:var(--m);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--lacquer);}
h1{font-family:var(--d);font-size:36px;line-height:1.03;letter-spacing:-.022em;font-weight:400;margin:12px 0 10px;}
h1 .italic{font-style:italic;}
.hl{background:linear-gradient(transparent 64%,rgba(255,82,51,.20) 64%);box-shadow:0 1px 0 rgba(255,82,51,.32);}
.line{font-size:18px;letter-spacing:-.012em;}
.sub{margin:13px 0 0;font-size:14.5px;color:var(--ink2);}
.sec{padding:22px 0;border-bottom:1px solid var(--line);}
.lbl{font-family:var(--m);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--lacquer);margin-bottom:12px;}
ul{list-style:none;margin:0;padding:0;}
.chk{padding:13px 0;border-top:1px solid var(--line);}.chk:first-child{border-top:0;}
.chk .hd{display:flex;align-items:center;gap:8px;font-size:16px;font-weight:500;color:var(--ink);margin-bottom:4px;}
.chk .k{display:block;font-family:var(--m);font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink2);margin-bottom:5px;padding-left:14px;}
.chk .hd:before{content:'';width:6px;height:6px;background:var(--lacquer);flex:none;}
.chk.good .hd:before{background:var(--field);border-radius:50%;}
.chk .v{display:block;font-size:14.5px;color:var(--ink2);padding-left:14px;}
.ms{display:flex;gap:16px;padding:12px 0;border-top:1px solid var(--line);}.ms:first-child{border-top:0;}
.ms .dt{font-family:var(--m);font-size:11px;font-weight:500;color:var(--lacquer);min-width:58px;font-variant-numeric:tabular-nums;}
.ms .bd b{display:block;font-weight:600;}.ms .s{display:block;font-size:13.5px;color:var(--ink2);}
.carry{padding:12px 0;border-top:1px solid var(--line);}.carry:first-of-type{border-top:0;}
.carry .pill{display:inline-block;font-family:var(--m);font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;background:var(--lacquer);color:#100603;padding:2px 7px;margin-bottom:6px;}
.carry b{display:block;font-family:var(--d);font-size:21px;font-weight:400;}.carry .cl{display:block;font-size:13.5px;color:var(--ink2);}
.foot{margin-top:26px;font-family:var(--m);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);text-align:center;line-height:1.8;}
</style></head><body><div class="wrap">
<div class="top"><b>${esc(BRAND.name)}</b><span>Nail reading &middot; ${esc(dateStr)}</span></div>
<div class="verdict"><span class="badge">${esc(v.num || '')} &middot; ${esc(v.label || '')}</span><h1>${d.headline || ''}</h1><div class="line">${v.line || ''}</div>${v.sub ? `<p class="sub">${esc(v.sub)}</p>` : ''}</div>
${checks ? `<div class="sec"><div class="lbl">What we saw</div><ul>${checks}</ul></div>` : ''}
${medical}
${ms ? `<div class="sec"><div class="lbl">Care calendar</div><ul>${ms}</ul>${grown}</div>` : ''}
${carry}
<div class="foot">${esc(BRAND.name)} &middot; record ${esc(record.id)}<br>A cosmetic assessment, not a medical diagnosis. For any health concern, consult a doctor.</div>
</div></body></html>`;
}

// Upload photo + report snapshot; returns permanent URLs (empty string on any failure).
async function uploadScanAssets(env, id, imageBytes, mediaType, reportHtml) {
  const base = env.SITE_BASE || BRAND.site;
  let imageUrl = '', reportUrl = '';
  if (!env.SCANS) return { imageUrl, reportUrl };   // storage not configured yet — degrade gracefully
  try {
    await env.SCANS.put(`scans/${id}/photo.jpg`, imageBytes, { httpMetadata: { contentType: mediaType || 'image/jpeg' } });
    imageUrl = `${base}/api/scans/${id}/photo.jpg`;
  } catch (e) { imageUrl = ''; }
  try {
    await env.SCANS.put(`scans/${id}/report.html`, reportHtml, { httpMetadata: { contentType: 'text/html; charset=utf-8' } });
    reportUrl = `${base}/api/scans/${id}/report.html`;
  } catch (e) { reportUrl = ''; }
  return { imageUrl, reportUrl };
}

// ============================== TENANCY ==============================
//
// Which salon does this request belong to?
//
// The answer comes from the REQUEST URL's hostname and from nothing else. Not
// the Origin header, not a field in the body, not a query parameter. This
// Worker holds a service key that bypasses row-level security, so a tenant
// taken from anything the caller controls would let a crafted request write a
// scan, a lead or a photo into another salon's book. Origin looks tempting
// because it carries the salon's domain in the current cross-origin setup —
// and curl can set it to whatever it likes, which is exactly the point.
//
// The consequence is a deployment requirement, not a code detail: to serve
// more than one salon, the Worker must be ROUTED on each salon's hostname, so
// that request.url carries it. A Worker reached at its workers.dev address
// cannot tell one salon from another, and this code refuses to guess — it logs
// and falls back rather than picking someone.
//
// Everything about this degrades to today's behaviour:
//   * TENANT_RESOLUTION unset or "fixed"  -> TENANT_SLUG, exactly as before
//   * hostname not in the database        -> fall back
//   * Supabase slow, down or unreachable  -> fall back
// A database problem must never cost somebody her reading.

const TENANT_TTL_MS = 60000;
const TENANT_CACHE = new Map();          // host -> { at, value }

function requestHost(request) {
  try { return new URL(request.url).hostname.toLowerCase(); } catch (e) { return ''; }
}

// A hostname we cannot attribute to a salon. Not an error in `fixed` mode.
function isUnattributable(host) {
  return !host || host.endsWith('.workers.dev') || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host);
}

function configTenant(env) {
  return {
    slug: env.TENANT_SLUG || '',
    tenantId: null,
    brand: brandFor(env),
    settings: {},
    source: 'config'
  };
}

async function resolveTenant(env, request) {
  const fallback = configTenant(env);
  if ((env.TENANT_RESOLUTION || 'fixed') !== 'host') return fallback;
  if (!storeConfigured(env)) return fallback;

  const host = requestHost(request);
  if (isUnattributable(host)) {
    console.log(`[tenant] host mode but request host is ${JSON.stringify(host)} — not attributable, using TENANT_SLUG. Route the Worker on the salon's domain.`);
    return fallback;
  }

  const hit = TENANT_CACHE.get(host);
  if (hit && Date.now() - hit.at < TENANT_TTL_MS) return hit.value;

  let row = null;
  try {
    row = await rpcResolveHost(env, host);
  } catch (e) {
    console.log(`[tenant] lookup failed for ${host}: ${e && e.message}`);
    return fallback;
  }
  if (!row) {
    console.log(`[tenant] no salon mapped to ${host} — using TENANT_SLUG`);
    // Cache the miss briefly too, so an unmapped host cannot hammer the database.
    TENANT_CACHE.set(host, { at: Date.now(), value: fallback });
    return fallback;
  }

  const base = brandFor(env);
  const brand = row.brand || {};
  const value = {
    slug: row.slug,
    tenantId: row.tenant_id,
    status: row.status,
    brand: {
      ...base,
      name:   brand.name   || row.name   || base.name,
      site:   'https://' + (row.primary_host || host),
      locale: row.locale   || base.locale,
      city:   brand.city   || base.city
    },
    settings: row.settings || {},
    source: 'host'
  };
  TENANT_CACHE.set(host, { at: Date.now(), value });
  return value;
}

// ============================== CLIENT FILE ==============================
// The durable half. KV holds the record the front end reads back seconds later;
// Postgres holds the file the salon works from for years. Neither is allowed to
// block the reading — see api/src/store.js.

const isPositiveFinding = code => !!(COPY[code] && COPY[code].status === 'good');

// Fire-and-forget when we have a ctx (production), awaited when we do not
// (tests, local runs). Either way a failure only ever reaches the log.
function background(ctx, promise) {
  const guarded = Promise.resolve(promise).catch(e =>
    console.log('[store] background task failed: ' + (e && e.message)));
  if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(guarded); return null; }
  return guarded;
}

// ============================== HTTP ==============================
//
// Two POST endpoints, deliberately split (see the header note):
//
//   POST /api/analyze-nails  { image }                     -> { ok, id, record }
//   POST /api/lead           { id, name, salon, phone, ... } -> { ok }
//
// analyze-nails pushes NO lead and requires no contact details, so the camera is
// never gated behind a form. /api/lead attaches the contact to a record that
// already exists and fires the single GHL webhook.

const B32 = '0123456789abcdefghjkmnpqrstvwxyz';
function shortId() {
  const a = new Uint8Array(7); crypto.getRandomValues(a);
  return [...a].map(x => B32[x % 32]).join('');
}

function cors(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || BRAND.site).split(',').map(s => s.trim()).filter(Boolean);
  // Unlisted origins get allowed[0] echoed back — a mismatch the browser rejects.
  // Same behaviour as the original worker; kept so a misconfigured ALLOWED_ORIGINS
  // fails closed rather than opening the API to any site.
  const ok = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': ok,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

const json = (obj, status, hdrs) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json', ...(hdrs || {}) } });

// Per-IP hourly cap. Optional: without the RATE_LIMIT binding the endpoint is open.
async function rateLimited(env, request, bucket, cap) {
  if (!env.RATE_LIMIT) return false;
  const ip = request.headers.get('CF-Connecting-IP') || 'x';
  const key = `rl:${bucket}:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const n = parseInt(await env.RATE_LIMIT.get(key) || '0', 10) + 1;
  await env.RATE_LIMIT.put(key, String(n), { expirationTtl: 3700 });
  return n > cap;
}

const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// ------------------------------------------------------------------ scan --

async function handleAnalyze(request, env, C, ctx) {
  if (await rateLimited(env, request, 'scan', 12)) return json({ error: 'rate_limited' }, 429, C);

  // Whose salon this is — from the hostname, never from the body below.
  const tenant = await resolveTenant(env, request);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, C); }

  const { image } = body || {};
  if (!image) return json({ error: 'missing_image' }, 400, C);
  if (image.length > 3.5 * 1024 * 1024) return json({ error: 'image_too_large' }, 413, C);

  const m = String(image).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return json({ error: 'bad_image' }, 400, C);
  const mediaType = m[1], imageB64 = m[2];
  const now = new Date();

  // Perception. A model failure degrades to tier `unclear`, never to an error.
  let perception = null;
  try { perception = await callVision(env, imageB64, mediaType); }
  catch (e) { console.log('[vision] failed: ' + (e && e.message)); perception = null; }

  const id = shortId();
  const record = buildRecord({ id, name: '', concern: null, perception, now });
  record.source = str(body.source, 40) || 'try-demo';

  // Photo + archival snapshot to R2. Best-effort: never fails the scan.
  try {
    const up = await uploadScanAssets(env, id, base64ToBytes(imageB64), mediaType, renderReportHtml(record, tenant.brand));
    record.assets = { image: up.imageUrl, report: up.reportUrl };
  } catch (e) { record.assets = { image: '', report: '' }; }

  // Permanent, no TTL — /api/lead reads this back, and the record is the report.
  if (env.REPORTS) await env.REPORTS.put('r:' + id, JSON.stringify(record));

  // Into the client file. Unattached for now: nobody has said who this is, and
  // an anonymous reading is still something the salon should be able to count.
  // Deliberately not awaited — she gets her report at the speed of the vision
  // call, not the speed of a database.
  background(ctx, ingestScan(env, tenant.slug, record, isPositiveFinding, buildScanSummary(record)));

  return json({ ok: true, id, record, record_version: 2 }, 200, C);
}

// ------------------------------------------------------------------ lead --

// A contact with no readable scan behind it. Still a lead, still pushed, but
// tagged so it is obvious in the CRM and countable in KV. Best-effort by
// design: this path exists because something already went wrong upstream.
async function captureOrphanLead(env, c, tenant) {
  const now = new Date();
  const key = `orphan:${now.toISOString()}:${shortId()}`;
  const payload = {
    event: 'nailscan_try_lead',
    source: c.source || 'try-demo',
    name: c.name, salon: c.salon, email: c.email, phone: c.phone, country: c.country,
    consent: true, consented_at: now.toISOString(),
    tags: 'demo,try-scan,scan-unmatched',
    scan_id: c.scanId || '',
    tier: '', wear: '',
    scan_score: 'unmatched',
    scan_summary: 'Contact captured, but the scan record behind it could not be read. Follow up without scan detail.',
    submitted_at: now.toISOString()
  };
  const delivered = await pushGHL(env, payload, tenant);
  console.log(`[lead] UNMATCHED scan_id=${JSON.stringify(c.scanId)} delivered=${delivered}`);
  if (env.REPORTS) {
    try { await env.REPORTS.put(key, JSON.stringify({ ...payload, delivered })); } catch (e) {}
  }
  return delivered;
}

async function handleLead(request, env, C, ctx) {
  if (await rateLimited(env, request, 'lead', 20)) return json({ error: 'rate_limited' }, 429, C);

  const tenant = await resolveTenant(env, request);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, C); }

  const id      = str(body && body.id, 16).toLowerCase().replace(/[^0-9a-z]/g, '');
  const name    = str(body && body.name, 60);
  const salon   = str(body && body.salon, 120);
  const email   = str(body && body.email, 120);
  const country = str(body && body.country, 2).toUpperCase();
  const phone   = normalizePhone(body && body.phone, country);

  if (!name || !phone || !email) return json({ error: 'missing_fields' }, 400, C);
  // The consent line is shown verbatim on the form; the submit asserts it.
  if (body.consent !== true) return json({ error: 'consent_required' }, 400, C);

  let record = null;
  if (id && env.REPORTS) {
    const raw = await env.REPORTS.get('r:' + id);
    if (raw) { try { record = JSON.parse(raw); } catch (e) { record = null; } }
  }

  // A lead is never dropped because its scan could not be found.
  //
  // The front end deliberately fails open — it unlocks the calendar even when
  // this endpoint errors, because the reading is already on her device and a
  // backend problem is ours, not hers. The cost of that choice is that a 404
  // here was invisible on both sides: she saw success, and the lead vanished.
  // A misconfigured KV binding could bleed every lead this way and nobody
  // would know.
  //
  // So an unmatched submission is still a real person who typed her details in.
  // Capture the contact, push it with what we have, and mark it unmatched so it
  // can be reconciled. `matched:false` is the signal to alert on.
  if (!record) {
    await captureOrphanLead(env, { name, salon, email, phone, country, scanId: id, source: str(body.source, 40) }, tenant);
    return json({ ok: true, delivered: true, matched: false }, 200, C);
  }

  const d = record.display || {};
  const cal = d.calendar;
  const now = new Date();
  const reportUrl = `${tenant.brand.site}/report?id=${record.id}`;

  const tags = ['demo', 'try-scan', 'nail-scan-' + record.tier, 'wear-' + record.wear]
    .concat(record.perception ? record.perception.findings.map(f => 'finding-' + f.code) : []);

  const ok = await pushGHL(env, {
    event: 'nailscan_try_lead',
    source: str(body.source, 40) || 'try-demo',
    name, salon, email, phone, country,
    consent: true, consented_at: now.toISOString(),
    tags: tags.join(','),
    scan_id: record.id,
    tier: record.tier, wear: record.wear,
    scan_score: record.tier === 'unclear' ? 'unreadable' : record.tier,
    scan_result: (d.verdict && d.verdict.sub) || '',
    scan_conditions: (d.checks || []).map(c => c.v.replace(/<[^>]+>/g, '')).join(' | '),
    scan_summary: buildScanSummary(record),
    scan_recommendation: legacyFromRecord(record, reportUrl).recommendation,
    recommended_service: cal && cal.book ? cal.book.service : '',
    next_action_date: cal && cal.book ? cal.book.date : '',
    grown_out_date: cal ? (cal.grown_out || '') : '',
    scan_image_url: (record.assets && record.assets.image) || '',
    report_url: reportUrl,
    scanned_at: record.created_at,
    submitted_at: now.toISOString()
  }, tenant);

  // Stamp the record so a resubmit is visible in KV, and keep the contact with
  // the scan for the staff-side view.
  record.lead = { name, salon, email, phone, country, at: now.toISOString(), delivered: ok };
  if (env.REPORTS) await env.REPORTS.put('r:' + record.id, JSON.stringify(record));

  // A CRM outage is silent by design on the client side. Leave a countable
  // trace so it is not silent on ours: these keys are the reconcile queue.
  if (!ok && env.REPORTS) {
    console.log(`[lead] UNDELIVERED scan_id=${record.id}`);
    try {
      await env.REPORTS.put(`undelivered:${now.toISOString()}:${record.id}`,
        JSON.stringify({ scan_id: record.id, name, salon, email, phone, country, at: now.toISOString() }));
    } catch (e) {}
  }

  // The reading becomes somebody's file. Phone is the identity, so a client who
  // scanned in March and scans again in August lands on the same file with both
  // readings on it — which is the entire point of the product.
  //
  // If the scan is not in Postgres yet (its background ingest lost a race, or
  // was still in flight when she typed fast), ingest it here and retry once.
  // Losing the link between a person and her reading is not an acceptable
  // outcome of a race.
  if (storeConfigured(env)) {
    const consentText = str(body.consent_text, 2000) || null;
    const claim = attachLead(env, tenant.slug, record.id, { name, salon, email, phone, country, source: record.source }, consentText)
      .then(async r => {
        if (r) return r;
        await ingestScan(env, tenant.slug, record, isPositiveFinding, buildScanSummary(record));
        return attachLead(env, tenant.slug, record.id, { name, salon, email, phone, country, source: record.source }, consentText);
      });
    background(ctx, claim);
  }

  // `ok: true` even when GHL is down. The calendar is already on her device and
  // the record is already persisted — a CRM outage is ours to reconcile, not
  // hers to be blocked by. `delivered` says what actually happened.
  return json({ ok: true, delivered: ok, matched: true }, 200, C);
}

// ------------------------------------------------------------------ plan --
//
// She ticked some reminders and downloaded them. The file itself is built and
// saved entirely on her device — this endpoint is only how the salon finds out,
// so it carries a summary and never the file.
//
// It cannot fail in a way she notices. By the time this request goes out the
// .ics is already in her downloads; a bad response here is ours to reconcile,
// not a thing to show her an error about.

async function handlePlan(request, env, C, ctx) {
  if (await rateLimited(env, request, 'plan', 40)) return json({ error: 'rate_limited' }, 429, C);

  const tenant = await resolveTenant(env, request);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, C); }

  const id = str(body && body.id, 16).toLowerCase().replace(/[^0-9a-z]/g, '');
  const items = Array.isArray(body && body.items) ? body.items.slice(0, 40) : [];
  if (!id || !items.length) return json({ error: 'missing_fields' }, 400, C);

  let record = null;
  if (env.REPORTS) {
    const raw = await env.REPORTS.get('r:' + id);
    if (raw) { try { record = JSON.parse(raw); } catch (e) { record = null; } }
  }
  if (!record) {
    console.log(`[plan] UNKNOWN scan_id=${id} items=${items.length}`);
    return json({ ok: true, matched: false }, 200, C);
  }

  const appts  = items.filter(i => i && i.kind !== 'habit').length;
  const habits = items.filter(i => i && i.kind === 'habit').length;
  const eventDate  = str(body.event_date, 10);
  const eventLabel = str(body.event_label, 60);
  const now = new Date();
  const lead = record.lead || {};

  const summary = {
    total: items.length,
    event_date: eventDate,
    event_label: eventLabel,
    payload: {
      service: str(body.service, 60),
      rhythm:  str(body.rhythm, 20),
      appointments: appts,
      habits: habits,
      items: items.map(i => str(i && i.id, 40)).filter(Boolean)
    }
  };

  // Stamp the record, so the salon-side view and any later replay both see it.
  record.plan = { at: now.toISOString(), total: items.length, appointments: appts,
                  habits: habits, event_date: eventDate, event_label: eventLabel };
  if (env.REPORTS) await env.REPORTS.put('r:' + id, JSON.stringify(record));

  background(ctx, Promise.all([
    pushGHL(env, {
      event: 'nailscan_plan_saved',
      source: str(body.source, 40) || record.source || 'try-demo',
      // Identity, so the workflow finds the contact it already has.
      name: lead.name || '', email: lead.email || '', phone: lead.phone || '',
      country: lead.country || '',
      scan_id: id, tier: record.tier, wear: record.wear,
      plan_total: items.length,
      plan_appointments: appts,
      plan_habits: habits,
      plan_titles: items.map(i => str(i && i.title, 80)).filter(Boolean).join(' | '),
      plan_next_date: items.map(i => str(i && i.date, 10)).filter(Boolean).sort()[0] || '',
      // The one field worth interrupting somebody for.
      plan_event_label: eventLabel,
      plan_event_date: eventDate,
      plan_service: str(body.service, 60),
      plan_rhythm: str(body.rhythm, 20),
      saved_at: now.toISOString()
    }, tenant),
    storeConfigured(env) ? recordPlanSaved(env, tenant.slug, id, summary) : Promise.resolve(null)
  ]));

  console.log(`[plan] scan_id=${id} total=${items.length} appts=${appts} habits=${habits} event=${JSON.stringify(eventLabel)}`);
  return json({ ok: true, matched: true }, 200, C);
}

// ------------------------------------------------------------------ main --

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const C = cors(env, request.headers.get('Origin') || '');

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: C });

    // Liveness — the deploy check. Pages returns 200 for unknown paths on the
    // sibling project, so a real body is the only proof the Worker is routed.
    if (request.method === 'GET' && url.pathname === '/api/health') {
      const t = await resolveTenant(env, request);
      return json({
        ok: true, worker: 'nailscan-try-api',
        brand: t.brand.name, site: t.brand.site,
        tenant: t.slug, resolution: env.TENANT_RESOLUTION || 'fixed', resolved_by: t.source,
        host: requestHost(request)
      }, 200, C);
    }

    // The salon's own identity, for a page that does not know whose install it
    // is serving. Public and deliberately thin: a name, a logo, booking links.
    // No settings, no webhook, nothing a competitor could not read off the page
    // anyway. Cached at the edge for a minute — a rename should land quickly,
    // but not at the cost of a lookup per visitor.
    if (request.method === 'GET' && url.pathname === '/api/config') {
      const t = await resolveTenant(env, request);
      return json({
        ok: true,
        source: t.source,
        brand: {
          name:   t.brand.name,
          site:   t.brand.site,
          locale: t.brand.locale,
          city:   t.brand.city,
          logo:   (t.settings && t.settings.overrides && t.settings.overrides.logo) || null
        },
        links: {
          booking:         (t.settings && t.settings.booking_url) || null,
          crossLink:       (t.settings && t.settings.cross_link_url) || null,
          crossLinkLabel:  (t.settings && t.settings.cross_link_label) || null,
          support:         (t.settings && t.settings.support_email) || null
        }
      }, 200, { ...C, 'cache-control': 'public, max-age=60' });
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/report/')) {
      const id = url.pathname.split('/').pop().toLowerCase().replace(/[^0-9a-z]/g, '');
      if (!id || !env.REPORTS) return json({ error: 'not_found' }, 404, C);
      const raw = await env.REPORTS.get('r:' + id);
      if (!raw) return json({ error: 'not_found' }, 404, C);
      const rec = JSON.parse(raw);
      delete rec.lead;                       // contact details never leave via a GET
      return json(rec, 200, { ...C, 'cache-control': 'private, max-age=300' });
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/scans/')) {
      const mo = url.pathname.match(/^\/api\/scans\/([0-9a-z]+)\/(photo\.jpg|report\.html)$/);
      if (!mo || !env.SCANS) return json({ error: 'not_found' }, 404, C);
      const obj = await env.SCANS.get(`scans/${mo[1]}/${mo[2]}`);
      if (!obj) return json({ error: 'not_found' }, 404, C);
      const fallbackType = mo[2].endsWith('.jpg') ? 'image/jpeg' : 'text/html; charset=utf-8';
      return new Response(obj.body, { headers: {
        'content-type': (obj.httpMetadata && obj.httpMetadata.contentType) || fallbackType,
        'cache-control': 'public, max-age=31536000, immutable'
      }});
    }

    if (request.method === 'POST' && url.pathname === '/api/analyze-nails') return handleAnalyze(request, env, C, ctx);
    if (request.method === 'POST' && url.pathname === '/api/lead')          return handleLead(request, env, C, ctx);
    if (request.method === 'POST' && url.pathname === '/api/plan')          return handlePlan(request, env, C, ctx);

    return json({ error: 'not_found' }, 404, C);
  }
};

// exported for engine tests
export { resolveTenant, requestHost, brandFor, BRAND, buildRecord, decideTier, buildCalendar, pickTrends, parsePerception, legacyFromRecord, renderReportHtml, buildScanSummary, base64ToBytes, normalizePhone, COPY, FINDING_CODES, FLAG_CODES };
