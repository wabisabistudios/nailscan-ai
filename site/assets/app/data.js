/* ═══════════════════════════════════════════════════════════════════════════
   DATA — the mock ledger
   ═══════════════════════════════════════════════════════════════════════════

   Everything the dashboard draws comes from here. No API yet, so this stands
   in for one: a deterministic 120-day ledger for a single salon, generated
   from a fixed seed so the charts are byte-identical on every load. A demo
   whose numbers move between refreshes is a demo the prospect stops trusting.

   Two decisions worth keeping when the real API lands:

   1. A scan stores a SERVICE KEY, never a price. Prices live in the brand
      config, so switching tenant in the settings screen re-prices the entire
      history in front of the owner — which is the fastest way to prove the
      white-label claim is real and not a logo swap.

   2. A returning client's readings IMPROVE over her visit history. That is
      the product's whole argument — the record shows the work paying off —
      and a dataset of independent random scans would quietly fail to
      demonstrate it.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  /* mulberry32 — small, fast, and good enough that the histograms look
     organic rather than flat. Seeded, so the ledger never moves. */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var R = rng(20260802);
  var pick = function (a) { return a[Math.floor(R() * a.length)]; };
  var between = function (lo, hi) { return lo + R() * (hi - lo); };
  var chance = function (p) { return R() < p; };

  var FIRST = ['Danielle', 'Marisol', 'Aisha', 'Priya', 'Camille', 'Nadia', 'Yesenia', 'Brooke',
    'Thanh', 'Imani', 'Rosalie', 'Sofia', 'Kelsey', 'Amara', 'Jocelyn', 'Renata', 'Iris',
    'Bianca', 'Leilani', 'Farah', 'Delphine', 'Noor', 'Tamara', 'Elise', 'Mina', 'Corinne',
    'Adaeze', 'Sunni', 'Valeria', 'Hana', 'Odette', 'Simone', 'Paloma', 'Keziah', 'Anouk'];
  var LAST = ['R.', 'M.', 'O.', 'K.', 'T.', 'B.', 'S.', 'A.', 'N.', 'D.', 'L.', 'V.', 'C.', 'F.', 'W.'];

  var SOURCES = [
    { id: 'instagram', label: 'Instagram', paid: false, w: 0.34 },
    { id: 'meta_ads',  label: 'Meta ads',  paid: true,  w: 0.23 },
    { id: 'website',   label: 'Website',   paid: false, w: 0.21 },
    { id: 'google',    label: 'Google',    paid: true,  w: 0.12 },
    { id: 'walk_in',   label: 'In salon',  paid: false, w: 0.10 }
  ];

  var FIELDS = ['surface', 'color', 'structure', 'cuticle'];

  /* Reading copy. Index 0 is the best state; higher indexes want more prep.
     Nothing in here is a defect — every line describes what the nail is ready
     for, because that is what the client is shown. */
  var READINGS = {
    surface: [
      'Smooth plate, even through the free edge',
      'Light texture through the plate',
      'Texture across the plate, softening at the edge'
    ],
    color: [
      'Uniform bed, clear natural tone',
      'Slight warmth in the outer third',
      'Warm tone through the outer third, both hands'
    ],
    structure: [
      'Even thickness, strong side walls',
      'One plate wants reseating at the wall',
      'Two plates want reseating at the side wall'
    ],
    cuticle: [
      'Eponychium intact, well maintained',
      'Ready for conditioning at the base',
      'Wants conditioning at the base and fold'
    ]
  };

  /* Verdict Core, ported verbatim from verdict-core/service-routing.js v1.8.
     Kept as real code rather than a lookup table so the dashboard, the
     scanner and the website all demonstrably run the same rules. */
  function deriveService(obs) {
    if (obs.color >= 2) return { rule: 'R1', key: 'tone_prep_set' };
    if (obs.structure >= 2) return { rule: 'R2', key: 'edge_rebuild_set' };
    if (obs.structure >= 1 && obs.color >= 1) return { rule: 'R3', key: 'strength_prep_set' };
    return { rule: 'R0', key: 'full_set' };
  }

  /* One step per field that is not already ready. The thresholds have to match
     the pill the client sees: a row reading "prep first" with an empty prep
     list on the same card is the kind of contradiction a technician notices
     immediately and stops trusting. */
  function prepSteps(obs) {
    var p = [];
    if (obs.surface >= 1) p.push('surface_smoothing');
    if (obs.color >= 1) p.push('tone_correct');
    if (obs.structure >= 1) p.push('edge_reseat');
    if (obs.cuticle >= 1) p.push('cuticle_condition');
    return p;
  }

  /* ---------------------------------------------------------------------
     Build the ledger.
     --------------------------------------------------------------------- */

  var DAYS = 120;
  // A fixed "today" — Date.now() would make the charts drift and would break
  // the promise that two people looking at the demo see the same numbers.
  var TODAY = new Date('2026-08-02T00:00:00Z');

  function dayOffset(n) {
    var d = new Date(TODAY.getTime() - n * 86400000);
    return d.toISOString().slice(0, 10);
  }

  var clients = [];
  var scans = [];
  var usedNames = {};

  function makeName() {
    for (var i = 0; i < 60; i++) {
      var n = pick(FIRST) + ' ' + pick(LAST);
      if (!usedNames[n]) { usedNames[n] = 1; return n; }
    }
    return pick(FIRST) + ' ' + pick(LAST) + ' ' + (clients.length + 1);
  }

  function phone() {
    return '(' + pick(['713', '281', '832', '346']) + ') 555-0' +
      String(100 + Math.floor(R() * 899));
  }

  function weightedSource() {
    var r = R(), acc = 0;
    for (var i = 0; i < SOURCES.length; i++) {
      acc += SOURCES[i].w;
      if (r <= acc) return SOURCES[i].id;
    }
    return SOURCES[0].id;
  }

  // Volume ramps over the 120 days — a salon that just switched it on. Plus a
  // weekday rhythm, because a flat daily count reads as fabricated.
  function scansOnDay(offset) {
    var age = (DAYS - offset) / DAYS;                  // 0 at the start, 1 today
    var base = 0.9 + age * 3.4;
    var dow = new Date(TODAY.getTime() - offset * 86400000).getUTCDay();
    var rhythm = [0.55, 0.8, 0.95, 1.05, 1.2, 1.45, 1.15][dow];  // Sun…Sat
    return Math.max(0, Math.round(base * rhythm * between(0.55, 1.5)));
  }

  var cid = 0;
  var sid = 0;

  for (var off = DAYS; off >= 0; off--) {
    var date = dayOffset(off);
    var n = scansOnDay(off);

    for (var k = 0; k < n; k++) {
      // Returning clients become more likely as the base grows.
      var returning = clients.length > 12 && chance(0.34);
      // MUST be assigned, not just declared: `var` is function-scoped, so a
      // bare `var client;` on the second pass keeps the previous iteration's
      // client and every subsequent scan lands on the same person. It did.
      var client = null;

      if (returning) {
        // Prefer someone who is actually due back rather than anyone at all.
        var pool = clients.filter(function (c) {
          return c.visits.length && c.visits[c.visits.length - 1].dayOffset - off >= 21;
        });
        client = pool.length ? pick(pool) : null;
      }

      if (!client) {
        client = {
          id: 'C' + String(++cid).padStart(4, '0'),
          name: makeName(),
          phone: phone(),
          source: weightedSource(),
          firstSeen: date,
          visits: []
        };
        clients.push(client);
      }

      // Readings. First visit is drawn from the wild; each return improves,
      // because that is what the care plan is for.
      var visitIndex = client.visits.length;
      var obs = {};
      FIELDS.forEach(function (f) {
        var v;
        if (visitIndex === 0) {
          v = chance(0.44) ? 0 : (chance(0.62) ? 1 : 2);
        } else {
          var prev = client.visits[visitIndex - 1].obs[f];
          // Improves most of the time, holds sometimes, slips rarely.
          v = chance(0.62) ? Math.max(0, prev - 1) : (chance(0.85) ? prev : Math.min(2, prev + 1));
        }
        obs[f] = v;
      });

      var routed = deriveService(obs);
      var prep = prepSteps(obs);
      var conf = +(between(0.74, 0.97)).toFixed(2);

      // Funnel. A report that gets opened converts far better, which is the
      // argument the lead-engine page makes.
      var opened = chance(0.79);
      var called = opened && chance(0.74);
      var booked = called && chance(returning ? 0.71 : 0.46);
      var showed = booked && chance(0.88);

      var scan = {
        id: 'NS-' + date.replace(/-/g, '').slice(2) + '-' + String(++sid).padStart(4, '0'),
        date: date,
        dayOffset: off,
        clientId: client.id,
        source: client.source,
        returning: returning,
        visitIndex: visitIndex,
        obs: obs,
        readings: FIELDS.reduce(function (a, f) { a[f] = READINGS[f][obs[f]]; return a; }, {}),
        prep: prep,
        rule: routed.rule,
        service: routed.key,
        confidence: conf,
        opened: opened,
        called: called,
        booked: booked,
        showed: showed
      };

      scans.push(scan);
      client.visits.push(scan);
      client.lastSeen = date;
    }
  }

  // A handful of retakes — the confidence gate doing its job. They are scans
  // that never produced a quote, and they must show up in the ledger or the
  // funnel maths silently overstates the capture rate.
  var retakes = [];
  for (var r2 = 0; r2 < 23; r2++) {
    var o2 = Math.floor(R() * DAYS);
    retakes.push({
      id: 'NS-' + dayOffset(o2).replace(/-/g, '').slice(2) + '-R' + String(r2 + 1).padStart(3, '0'),
      date: dayOffset(o2), dayOffset: o2, retake: true,
      confidence: +(between(0.31, 0.71)).toFixed(2)
    });
  }

  /* ---------------------------------------------------------------------
     Derived views. Prices resolve against the CURRENT brand every time, so
     switching tenant re-prices the whole history live.
     --------------------------------------------------------------------- */

  function priceOf(serviceKey, salon) {
    salon = salon || (root.Brand && root.Brand.current) || null;
    if (!salon) return 0;
    var s = salon.services[serviceKey];
    return s ? s.price : 0;
  }

  function serviceName(serviceKey, salon) {
    salon = salon || (root.Brand && root.Brand.current) || null;
    if (!salon) return serviceKey;
    var s = salon.services[serviceKey];
    return s ? s.name : serviceKey;
  }

  function totals(range) {
    var list = inRange(scans, range);
    var t = {
      scans: list.length,
      retakes: inRange(retakes, range).length,
      opened: 0, called: 0, booked: 0, showed: 0,
      quoted: 0, revenue: 0, clients: {}
    };
    list.forEach(function (s) {
      if (s.opened) t.opened++;
      if (s.called) t.called++;
      if (s.booked) t.booked++;
      if (s.showed) t.showed++;
      t.quoted += priceOf(s.service);
      if (s.showed) t.revenue += priceOf(s.service);
      t.clients[s.clientId] = 1;
    });
    t.uniqueClients = Object.keys(t.clients).length;
    delete t.clients;
    t.avgTicket = t.showed ? Math.round(t.revenue / t.showed) : 0;
    t.bookRate = list.length ? t.booked / list.length : 0;
    return t;
  }

  function inRange(list, days) {
    if (!days) return list;
    return list.filter(function (s) { return s.dayOffset < days; });
  }

  function byDay(range) {
    var out = [], d = range || DAYS;
    for (var i = d - 1; i >= 0; i--) {
      var day = scans.filter(function (s) { return s.dayOffset === i; });
      out.push({
        date: dayOffset(i),
        dayOffset: i,
        scans: day.length,
        booked: day.filter(function (s) { return s.booked; }).length,
        revenue: day.reduce(function (a, s) { return a + (s.showed ? priceOf(s.service) : 0); }, 0)
      });
    }
    return out;
  }

  function serviceMix(range) {
    var list = inRange(scans, range), m = {};
    root.Brand.SERVICE_KEYS.forEach(function (k) { m[k] = { key: k, count: 0, revenue: 0 }; });
    list.forEach(function (s) {
      m[s.service].count++;
      if (s.showed) m[s.service].revenue += priceOf(s.service);
    });
    return root.Brand.SERVICE_KEYS.map(function (k) { return m[k]; });
  }

  function sourceMix(range) {
    var list = inRange(scans, range);
    return SOURCES.map(function (src) {
      var rows = list.filter(function (s) { return s.source === src.id; });
      return {
        id: src.id, label: src.label, paid: src.paid,
        scans: rows.length,
        booked: rows.filter(function (s) { return s.booked; }).length,
        revenue: rows.reduce(function (a, s) { return a + (s.showed ? priceOf(s.service) : 0); }, 0)
      };
    }).sort(function (a, b) { return b.scans - a.scans; });
  }

  function funnel(range) {
    var t = totals(range);
    return [
      { stage: 'Scanned',  n: t.scans },
      { stage: 'Report opened', n: t.opened },
      { stage: 'Contacted', n: t.called },
      { stage: 'Booked',   n: t.booked },
      { stage: 'Showed',   n: t.showed }
    ];
  }

  function clientRows() {
    return clients.map(function (c) {
      var last = c.visits[c.visits.length - 1];
      var revenue = c.visits.reduce(function (a, s) { return a + (s.showed ? priceOf(s.service) : 0); }, 0);
      var rebook = root.Brand.current
        ? (root.Brand.current.services[last.service] || {}).rebook || 4 : 4;
      return {
        id: c.id, name: c.name, phone: c.phone, source: c.source,
        firstSeen: c.firstSeen, lastSeen: c.lastSeen,
        visits: c.visits.length,
        lastService: last.service,
        lastObs: last.obs,
        revenue: revenue,
        // Weeks since the last visit against the rebook interval for the
        // service she actually had. "Due" is the whole point of the record.
        dueInDays: Math.round(rebook * 7 - last.dayOffset),
        trend: c.visits.length > 1
          ? sum(c.visits[0].obs) - sum(last.obs)     // positive = improving
          : null
      };
    }).sort(function (a, b) { return a.lastSeen < b.lastSeen ? 1 : -1; });
  }

  function sum(o) { return o.surface + o.color + o.structure + o.cuticle; }

  function clientById(id) {
    return clients.filter(function (c) { return c.id === id; })[0];
  }

  function scanById(id) {
    return scans.filter(function (s) { return s.id === id; })[0];
  }

  root.Ledger = {
    DAYS: DAYS,
    TODAY: TODAY,
    FIELDS: FIELDS,
    READINGS: READINGS,
    SOURCES: SOURCES,
    scans: scans,
    retakes: retakes,
    clients: clients,
    deriveService: deriveService,
    prepSteps: prepSteps,
    priceOf: priceOf,
    serviceName: serviceName,
    totals: totals,
    byDay: byDay,
    serviceMix: serviceMix,
    sourceMix: sourceMix,
    funnel: funnel,
    clientRows: clientRows,
    clientById: clientById,
    scanById: scanById,
    sum: sum
  };
}(window));
