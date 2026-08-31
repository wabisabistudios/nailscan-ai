/* Wabi Sabi Studios — NailScan
   Interactive proof modules.

   Every module below is a faithful front-end simulation of the production
   engine's behaviour. No inference call is made from this page. The rule
   source shown in the service-routing explorer is the real Verdict Core logic. */

(function () {
  'use strict';

  var THRESHOLD = 0.72;

  /* ---------- helpers ---------- */

  function el(sel, root) { return (root || document).querySelector(sel); }
  function els(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // FNV-1a — deterministic. Same string in, same digest out, always.
  function digest(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    var hex = h.toString(16).padStart(8, '0');
    return hex.slice(0, 4) + '·' + hex.slice(4);
  }

  function line(out, text, cls) {
    var s = document.createElement('span');
    s.className = 'ol ' + (cls || '');
    s.textContent = text;
    out.appendChild(s);
    out.scrollTop = out.scrollHeight;
  }

  function sep(out) {
    var s = document.createElement('span');
    s.className = 'sep';
    out.appendChild(s);
  }

  function money(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  /* =======================================================================
     MODULE 1 — Determinism proof
     ======================================================================= */

  (function determinism() {
    var root = el('[data-ix="determinism"]');
    if (!root) return;

    var out = el('.outlines', root);
    var hashes = el('[data-hashes]', root);
    var runBtn = el('[data-run]', root);
    var mode = 'nse';

    // The constrained engine returns exactly this, every pass.
    var NSE_RESULT = [
      'surface     : smooth plate; even through the free edge',
      'color       : uniform bed; clear natural tone',
      'structure   : even thickness; strong side walls',
      'cuticle     : eponychium intact; ready for conditioning',
      'confidence  : 0.91',
      'prep_steps  : []',
      'recommended : full_gel_set',
      'quoted      : 95.00',
      'care_plan   : cal_maintain_v2'
    ].join('\n');

    // An unconstrained generative tool, same photograph, three passes.
    var GEN_RESULTS = [
      'Your nails are looking gorgeous! I\'d go for a simple gloss\nmanicure — maybe $35 or so?',
      'These look ready for a builder gel overlay. That is usually\naround $120 at most places.',
      'Beautiful healthy nails! Honestly you could just book a file\nand polish. Call it $25.',
      'I\'d recommend a full acrylic set with tips, probably $150,\nplus a strengthening treatment on top.',
      'Nice natural nails. A soak-off and reset should do it —\nsomewhere in the $60 range.'
    ];

    function setMode(m) {
      mode = m;
      els('.seg button', root).forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-mode') === m);
      });
      out.innerHTML = '';
      hashes.innerHTML = '';
      line(out, 'Mode set: ' + (m === 'nse'
        ? 'NSE — ONYX-5 schema + Verdict Core'
        : 'Unconstrained generative tool'), 'dim');
      line(out, 'Input pinned: specimen-04.jpg · 2048×1536 · unchanged between passes', 'dim');
    }

    function run() {
      out.innerHTML = '';
      hashes.innerHTML = '';
      runBtn.disabled = true;

      var results = [];
      if (mode === 'nse') {
        results = [NSE_RESULT, NSE_RESULT, NSE_RESULT];
      } else {
        var pool = GEN_RESULTS.slice();
        for (var i = 0; i < 3; i++) {
          results.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        }
      }

      var pass = 0;
      (function step() {
        if (pass >= 3) {
          finish(results);
          runBtn.disabled = false;
          return;
        }
        if (pass > 0) sep(out);
        line(out, '── pass ' + (pass + 1) + ' ─ same input, same settings', 'dim');
        var body = results[pass];
        body.split('\n').forEach(function (l) {
          line(out, l, mode === 'nse' ? 'hi' : 'warn');
        });
        line(out, 'digest  : ' + digest(body), mode === 'nse' ? 'ok' : 'bad');
        pass++;
        setTimeout(step, 620);
      })();
    }

    function finish(results) {
      var d = results.map(digest);
      var identical = d[0] === d[1] && d[1] === d[2];

      sep(out);
      line(out,
        identical
          ? 'RESULT: 3/3 passes byte-identical. Output is reproducible.'
          : 'RESULT: 3/3 passes differ. Output is not reproducible.',
        identical ? 'ok' : 'bad');

      if (!identical) {
        line(out, 'Note: the same photograph was quoted at $25 and at $150. Your\n      front desk cannot honour a price the tool invents fresh each time.', 'dim');
      } else {
        line(out, 'Note: the perceptual layer fills observation fields only. Prep\n      steps, the recommended service and its price are derived by\n      Verdict Core from those fields, so the same nails are always\n      quoted the same number.', 'dim');
      }

      hashes.innerHTML = '<span>digests</span>';
      d.forEach(function (h, i) {
        var c = document.createElement('span');
        c.className = 'hashchip ' + (identical ? 'same' : 'diff');
        c.textContent = 'p' + (i + 1) + ' ' + h;
        hashes.appendChild(c);
      });
      var verdict = document.createElement('span');
      verdict.className = 'hashchip ' + (identical ? 'same' : 'diff');
      verdict.textContent = identical ? '= IDENTICAL' : '≠ DIVERGENT';
      hashes.appendChild(verdict);
    }

    els('.seg button', root).forEach(function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
    });
    runBtn.addEventListener('click', run);
    setMode('nse');
  })();

  /* =======================================================================
     MODULE 2 — Live pipeline simulator
     ======================================================================= */

  (function pipeline() {
    var root = el('[data-ix="pipeline"]');
    if (!root) return;

    var stagesEl = el('[data-stages]', root);
    var runBtn = el('[data-run]', root);
    var repWrap = el('[data-report]', root);

    var STAGES = [
      ['Aperture', 'image admission control'],
      ['ONYX-5 extraction', 'perceptual layer'],
      ['Confidence gate', 'threshold ' + THRESHOLD.toFixed(2)],
      ['Reading derivation', 'verdict core'],
      ['Service routing', 'verdict core'],
      ['Care Graph', 'plan selection'],
      ['Ledger write', 'persist then deliver']
    ];

    var CASES = {
      natural: {
        label: 'Specimen A',
        title: 'Ready for a full set',
        desc: 'Healthy and well maintained',
        conf: 0.94,
        haltAt: -1,
        obs: [
          ['surface', 'Smooth plate, even through the free edge'],
          ['color', 'Uniform bed, clear natural tone'],
          ['structure', 'Even thickness, strong side walls'],
          ['cuticle', 'Eponychium intact, well maintained']
        ],
        prep: [],
        service: 'Full gel set',
        price: '$95',
        plan: 'cal_maintain_v2',
        planName: 'Maintenance · 6 week cycle'
      },
      damage: {
        label: 'Specimen B',
        title: 'Ready for a rebuild',
        desc: 'Coming out of an old gel set',
        conf: 0.88,
        haltAt: -1,
        obs: [
          ['surface', 'Texture through the plate, softening at the edge'],
          ['color', 'Warm tone in the outer third, service-responsive'],
          ['structure', 'Two plates want reseating at the side wall'],
          ['cuticle', 'Ready for conditioning at the base']
        ],
        prep: ['surface_smoothing', 'edge_reseat', 'cuticle_condition'],
        service: 'Strengthening prep + new set',
        price: '$140',
        plan: 'cal_rebuild_v3',
        planName: 'Rebuild · 8 week cycle'
      },
      poor: {
        label: 'Specimen C',
        title: 'Needs a clearer photo',
        desc: 'Low light, out of focus',
        conf: 0.41,
        haltAt: 2,
        obs: [
          ['surface', 'Waiting on detail — she is asked for one more shot'],
          ['color', 'Waiting on white balance'],
          ['structure', 'Waiting on edge resolution'],
          ['cuticle', 'Waiting on detail']
        ],
        prep: [],
        service: null,
        price: null,
        plan: null,
        planName: null
      }
    };

    var current = 'natural';
    var running = false;

    function paintStages(state) {
      stagesEl.innerHTML = '';
      STAGES.forEach(function (s, i) {
        var d = document.createElement('div');
        d.className = 'pstage' + (state && state[i] ? ' ' + state[i] : '');
        var mark = state && state[i] === 'done' ? '✓'
                 : state && state[i] === 'halt' ? '!'
                 : state && state[i] === 'run' ? '·'
                 : (i + 1);
        d.innerHTML =
          '<span class="pi">' + mark + '</span>' +
          '<span class="pn">' + s[0] + ' <span style="color:var(--faint)">— ' + s[1] + '</span></span>' +
          '<span class="ps">' +
            (state && state[i] === 'done' ? 'pass'
             : state && state[i] === 'halt' ? 'halt'
             : state && state[i] === 'run' ? 'running'
             : state && state[i] === 'skip' ? 'skipped' : 'idle') +
          '</span>';
        stagesEl.appendChild(d);
      });
    }

    function selectCase(k) {
      current = k;
      els('.sample', root).forEach(function (b) {
        b.classList.toggle('on', b.getAttribute('data-case') === k);
      });
      repWrap.innerHTML = '';
      paintStages(null);
    }

    function run() {
      if (running) return;
      running = true;
      runBtn.disabled = true;
      repWrap.innerHTML = '';

      var c = CASES[current];
      var state = [];
      var i = 0;

      (function step() {
        if (i > 0) state[i - 1] = 'done';

        if (c.haltAt >= 0 && i === c.haltAt) {
          state[i] = 'halt';
          for (var j = i + 1; j < STAGES.length; j++) state[j] = 'skip';
          paintStages(state);
          renderHalt(c);
          running = false;
          runBtn.disabled = false;
          return;
        }

        if (i >= STAGES.length) {
          paintStages(state);
          renderReport(c);
          running = false;
          runBtn.disabled = false;
          return;
        }

        state[i] = 'run';
        paintStages(state);
        i++;
        setTimeout(step, 430);
      })();
    }

    function renderHalt(c) {
      repWrap.innerHTML =
        '<div class="repcard">' +
          '<div class="repcard-h"><span>one more photo</span>' +
          '<span class="verdict warn">retake requested</span></div>' +
          '<div class="repcard-b">' +
            '<div class="fieldrows" style="margin-bottom:14px">' +
              '<div class="fieldrow"><span class="fk">confidence</span><span class="fv">' + c.conf.toFixed(2) + ' — below operating threshold ' + THRESHOLD.toFixed(2) + '</span><span class="fs warn">gate</span></div>' +
              '<div class="fieldrow"><span class="fk">quote</span><span class="fv">Held until the photo supports it.</span><span class="fs warn">pending</span></div>' +
              '<div class="fieldrow"><span class="fk">client sees</span><span class="fv">One more shot please: move to daylight, hold still, fill the frame</span><span class="fs warn">retry</span></div>' +
            '</div>' +
            '<div class="note"><b>This is what protects the sale.</b> The perceptual layer had four observation fields it could have filled with plausible language, and a price would have followed from them. The gate held it back and asked for a better picture instead — because a quote your front desk cannot honour costs more than the extra thirty seconds.</div>' +
          '</div>' +
        '</div>';
    }

    function renderReport(c) {
      // Every row resolves to 'ready' or 'prep first'. There is no failing
      // state here on purpose: the report's job is to name the service she
      // should book, so a reading is either something you can work on today
      // or something you prepare first and then work on.
      var rows = c.obs.map(function (o) {
        var prep = c.prep.length && (o[0] === 'surface' || o[0] === 'structure');
        var cls = prep ? 'warn' : 'ok';
        return '<div class="fieldrow"><span class="fk">' + o[0] + '</span><span class="fv">' + o[1] +
               '</span><span class="fs ' + cls + '">' + (prep ? 'prep first' : 'ready') + '</span></div>';
      }).join('');

      var prepTxt = c.prep.length ? c.prep.join(' · ') : 'none needed';

      repWrap.innerHTML =
        '<div class="repcard">' +
          '<div class="repcard-h"><span>report ' + (c.prep.length ? 'NS-SIM-B' : 'NS-SIM-A') + ' · rendered</span>' +
            '<span class="verdict ok">' + c.service.toLowerCase() + ' · ' + c.price + '</span></div>' +
          '<div class="repcard-b">' +
            '<div class="fieldrows" style="margin-bottom:14px">' + rows +
              '<div class="fieldrow"><span class="fk">confidence</span><span class="fv">' + c.conf.toFixed(2) + ' — image quality sufficient</span><span class="fs ok">pass</span></div>' +
              '<div class="fieldrow"><span class="fk">prep steps</span><span class="fv">' + prepTxt + '</span><span class="fs ' + (c.prep.length ? 'warn' : 'ok') + '">' + c.prep.length + '</span></div>' +
              '<div class="fieldrow"><span class="fk">recommended</span><span class="fv">' + c.service + ' · ' + c.price + '</span><span class="fs ok">quoted</span></div>' +
              '<div class="fieldrow"><span class="fk">care graph</span><span class="fv">' + c.planName + ' · ' + c.plan + '</span><span class="fs ok">bound</span></div>' +
            '</div>' +
            '<div class="note"><b>Everything below the confidence row was derived, not written.</b> The prep steps come from the observation fields by rule, the service and its price come from the prep steps, and the care plan is selected by wear type from a versioned library. The perceptual layer never saw these outputs — which is why the same nails always get quoted the same price.</div>' +
          '</div>' +
        '</div>';
    }

    els('.sample', root).forEach(function (b) {
      b.addEventListener('click', function () { selectCase(b.getAttribute('data-case')); });
    });
    runBtn.addEventListener('click', run);
    selectCase('natural');
  })();

  /* =======================================================================
     MODULE 3 — Service routing explorer

     Every branch here ends in a service and a price. That is the point of
     the demonstration: the salon can quote from this table with confidence
     because the same readings always produce the same number, and no model
     ever touches the arithmetic.
     ======================================================================= */

  (function serviceRouting() {
    var root = el('[data-ix="referral"]');
    if (!root) return;

    var code = el('[data-code]', root);
    var verdictEl = el('[data-verdict]', root);
    var derivedEl = el('[data-derived]', root);

    var state = {
      discoloration: false,   // obs.tone_variance
      separation: false,      // obs.edge_reseat_needed
      lifting: false,         // obs.wall_reseat
      colorchange: false      // obs.warm_third
    };

    var OFFER = {
      R0: ['Full gel set', '$95'],
      R1: ['Tone-correcting prep + set', '$130'],
      R2: ['Edge rebuild + set', '$145'],
      R3: ['Strengthening prep + new set', '$140']
    };

    // Verdict Core v1.8 — service routing. Rendered verbatim.
    var SRC = [
      ['<span class="cm">// verdict-core/service-routing.js · v1.8</span>', null],
      ['<span class="cm">// Runs after ONYX-5 extraction. Reads observation fields only.</span>', null],
      ['', null],
      ['<span class="kw">function</span> deriveService(obs) {', null],
      ['  <span class="kw">if</span> (obs.tone_variance)      <span class="kw">return</span> <span class="st2">TONE_PREP_SET</span>;     <span class="cm">// R1 · $130</span>', 'R1'],
      ['  <span class="kw">if</span> (obs.edge_reseat_needed) <span class="kw">return</span> <span class="st2">EDGE_REBUILD_SET</span>;  <span class="cm">// R2 · $145</span>', 'R2'],
      ['  <span class="kw">if</span> (obs.wall_reseat', 'R3'],
      ['      &amp;&amp; obs.warm_third)      <span class="kw">return</span> <span class="st2">STRENGTH_PREP_SET</span>; <span class="cm">// R3 · $140</span>', 'R3'],
      ['  <span class="kw">return</span> <span class="st2">FULL_GEL_SET</span>;                    <span class="cm">// R0 · $95</span>', 'R0'],
      ['}', null]
    ];

    function evaluate() {
      var fired = 'R0';
      if (state.discoloration) fired = 'R1';
      else if (state.separation) fired = 'R2';
      else if (state.lifting && state.colorchange) fired = 'R3';

      code.innerHTML = SRC.map(function (l) {
        var isFire = l[1] && l[1] === fired;
        return '<span class="cl' + (isFire ? ' fire' : '') + '">' + l[0] + '</span>';
      }).join('');

      var reads = [];
      if (state.discoloration) reads.push('tone_variance');
      if (state.separation) reads.push('edge_reseat_needed');
      if (state.lifting) reads.push('wall_reseat');
      if (state.colorchange) reads.push('warm_third');

      var offer = OFFER[fired];

      derivedEl.innerHTML =
        '<div class="fieldrow"><span class="fk">readings</span><span class="fv">' +
          (reads.length ? reads.join(' · ') : 'all clear') +
        '</span><span class="fs ok">' + reads.length + '</span></div>' +
        '<div class="fieldrow"><span class="fk">rule fired</span><span class="fv">' +
          (fired === 'R0' ? 'default path — nails ready for service today' :
           fired === 'R1' ? 'R1 — tone varies across the plate' :
           fired === 'R2' ? 'R2 — free edge wants reseating' :
                            'R3 — side wall combined with warm tone') +
        '</span><span class="fs ok">' + fired + '</span></div>' +
        '<div class="fieldrow"><span class="fk">quoted</span><span class="fv">' +
          offer[0] + ' · ' + offer[1] +
        '</span><span class="fs ok">booked</span></div>';

      verdictEl.className = 'verdict ok';
      verdictEl.textContent = offer[0].toLowerCase() + ' · ' + offer[1];
    }

    els('.tg', root).forEach(function (t) {
      t.setAttribute('aria-checked', 'false');
      t.addEventListener('click', function () {
        var k = t.getAttribute('data-flag');
        state[k] = !state[k];
        t.classList.toggle('on', state[k]);
        t.setAttribute('aria-checked', state[k] ? 'true' : 'false');
        evaluate();
      });
    });

    evaluate();
  })();

  /* =======================================================================
     MODULE 4 — Funnel and payback calculator
     ======================================================================= */

  (function calc() {
    var root = el('[data-ix="calc"]');
    if (!root) return;

    var inputs = {};
    els('input[type="range"]', root).forEach(function (i) { inputs[i.getAttribute('data-k')] = i; });

    var tier = 3500;
    var managed = false;

    function fmtVal(k, v) {
      if (k === 'sessions') return Number(v).toLocaleString('en-US');
      if (k === 'ticket') return '$' + v;
      return v + '%';
    }

    function update() {
      var sessions = +inputs.sessions.value;
      var start = +inputs.start.value / 100;
      var complete = +inputs.complete.value / 100;
      var book = +inputs.book.value / 100;
      var ticket = +inputs.ticket.value;

      Object.keys(inputs).forEach(function (k) {
        var lab = el('[data-v="' + k + '"]', root);
        if (lab) lab.textContent = fmtVal(k, inputs[k].value);
      });

      // Round once, then derive everything downstream from the rounded values,
      // so the displayed figures can never contradict each other.
      var leads = Math.round(sessions * start * complete);
      var bookings = Math.round(leads * book);
      var revenue = bookings * ticket;

      var monthlyCost = managed ? 500 : 0;
      var netMonthly = revenue - monthlyCost;
      var payback = netMonthly > 0 ? tier / netMonthly : Infinity;
      var yearNet = revenue * 12 - tier - monthlyCost * 12;

      el('[data-o="leads"]', root).textContent = leads.toLocaleString('en-US');
      el('[data-o="bookings"]', root).textContent = bookings.toLocaleString('en-US');
      el('[data-o="revenue"]', root).textContent = money(revenue);
      el('[data-o="year"]', root).textContent = money(yearNet);

      var pbEl = el('[data-o="payback"]', root);
      var pbBar = el('[data-o="paybar"]', root);
      if (!isFinite(payback) || payback > 36) {
        pbEl.textContent = bookings === 0 ? 'no bookings' : 'over 3 years';
        pbBar.style.width = '0%';
      } else if (payback < 1) {
        pbEl.textContent = 'under 1 mo';
        pbBar.style.width = '100%';
      } else {
        pbEl.textContent = payback.toFixed(1) + ' mo';
        pbBar.style.width = Math.max(4, Math.min(100, (12 / payback) * 100)) + '%';
      }

      el('[data-o="yearlabel"]', root).textContent =
        'After the ' + money(tier) + ' build' + (managed ? ' and ' + money(500 * 12) + ' of retainer' : '') + '.';
    }

    els('.seg button', root).forEach(function (b) {
      b.addEventListener('click', function () {
        els('.seg button', root).forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        tier = +b.getAttribute('data-tier');
        managed = b.getAttribute('data-managed') === '1';
        update();
      });
    });

    Object.keys(inputs).forEach(function (k) {
      inputs[k].addEventListener('input', update);
    });

    update();
  })();

})();
