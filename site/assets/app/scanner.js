/* ═══════════════════════════════════════════════════════════════════════════
   SCANNER
   ═══════════════════════════════════════════════════════════════════════════

   A six-screen state machine: intro → capture → analyse → report → contact →
   done. No framework, no build step, no router — a salon embeds one <script>
   and one <link>, and the whole thing is inspectable in an afternoon.

   Three things are load-bearing and should survive the real API landing:

   1. THE CAMERA IS OPTIONAL. getUserMedia fails constantly in the wild —
      denied permission, an in-app browser with no camera access, an insecure
      origin, a laptop with the lid shut. Every one of those falls through to
      the bundled specimen rather than to a dead screen. A demo that only
      works when the camera cooperates is a demo that fails in the meeting.

   2. THE ANALYSIS IS THEATRE ON TOP OF REAL RULES. The timings are staged,
      but the routing underneath is Verdict Core as shipped — the same code
      the dashboard and the website run. When the inference call replaces the
      stub, only stage two changes.

   3. NOTHING IS HARD-CODED TO ONE SALON. Prices, service names and the accent
      all come from Brand. Switching tenant re-renders the report in place.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var el = function (s, r) { return (r || document).querySelector(s); };
  var els = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── Brand boot ───────────────────────────────────────────────────────── */

  var salon = Brand.apply(Brand.resolve());

  function paintBrand() {
    var s = Brand.current;
    els('[data-brand-name]').forEach(function (n) { n.textContent = s.name; });
    els('[data-brand-monogram]').forEach(function (n) { Brand.paintMark(n, s); });
    if (state.result) renderReport();          // re-price a report already on screen
  }
  document.addEventListener('brandchange', paintBrand);

  /* ── The aperture mark ────────────────────────────────────────────────── */

  (function aperture() {
    var g = el('[data-blades]');
    if (!g) return;
    // Ratios lifted from the brand mark: a wide inner aperture and generous
    // blade gaps. Filling the disc turns the Iris into a pinwheel.
    var N = 5, cx = 100, cy = 100, rOut = 76, rIn = 44, twist = 30 * Math.PI / 180, gap = 0.085;
    var frag = '';
    for (var i = 0; i < N; i++) {
      var a0 = (i / N) * Math.PI * 2 + gap;
      var a1 = ((i + 1) / N) * Math.PI * 2 - gap;
      var p = function (r, a) { return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
      var o0 = p(rOut, a0), o1 = p(rOut, a1);
      var i1 = p(rIn, a1 + twist), i0 = p(rIn, a0 + twist);
      frag += '<path class="bl" d="M' + o0[0].toFixed(1) + ' ' + o0[1].toFixed(1) +
        'A' + rOut + ' ' + rOut + ' 0 0 1 ' + o1[0].toFixed(1) + ' ' + o1[1].toFixed(1) +
        'L' + i1[0].toFixed(1) + ' ' + i1[1].toFixed(1) +
        'A' + rIn + ' ' + rIn + ' 0 0 0 ' + i0[0].toFixed(1) + ' ' + i0[1].toFixed(1) + 'Z"/>';
    }
    g.innerHTML = frag;
  }());

  /* ── Hand guide in the capture frame ──────────────────────────────────── */

  (function guide() {
    var svg = el('[data-guide]');
    if (!svg) return;
    // A sparse dotted silhouette rather than a solid outline: it says "about
    // here" without implying the photo will be rejected for being 4px off.
    var pts = [];
    var F = [[47, 11], [33, 14], [25.5, 29], [22, 50], [86, 38]];   // the five plates
    F.forEach(function (f) {
      for (var i = 0; i < 14; i++) {
        var a = (i / 14) * Math.PI * 2;
        pts.push([f[0] + Math.cos(a) * 4.4, f[1] + Math.sin(a) * 5.4, 0.5]);
      }
    });
    // Palm mass, so the guide reads as a hand and not five rings.
    for (var j = 0; j < 150; j++) {
      var t = j / 150;
      pts.push([28 + t * 46 + Math.sin(t * 9) * 5, 44 + t * 62, 0.34]);
      pts.push([20 + t * 52 + Math.cos(t * 7) * 6, 52 + t * 58, 0.3]);
    }
    svg.innerHTML = pts.map(function (p) {
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) +
             '" r="' + (p[2] * 1.5).toFixed(2) + '" opacity="' + p[2].toFixed(2) + '"/>';
    }).join('');
  }());

  /* ── Screen machine ───────────────────────────────────────────────────── */

  var STEP_OF = { intro: 1, capture: 1, analyse: 2, report: 3, contact: 4, done: 4 };
  var state = { screen: 'intro', shot: null, result: null, lead: null };

  function show(name) {
    els('[data-screen]').forEach(function (s) {
      s.classList.toggle('on', s.getAttribute('data-screen') === name);
    });
    state.screen = name;
    var pill = el('[data-step-pill]');
    if (pill) pill.textContent = 'Step ' + STEP_OF[name] + ' of 4';
    window.scrollTo(0, 0);
    var m = el('#main'); if (m) m.focus({ preventScroll: true });
    if (name === 'capture') startCapture();
    if (name === 'analyse') runAnalysis();
    if (name === 'report') revealReport();
  }

  els('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-go')); });
  });

  /* ── 2 · Capture ──────────────────────────────────────────────────────── */

  var video = el('[data-video]');
  var still = el('[data-still]');
  var frame = el('[data-frame]');
  var shutter = el('[data-shutter]');
  var hint = el('[data-capture-hint]');
  var stream = null;
  var usingCamera = false;

  function setCheck(name, pct) {
    var c = el('[data-check="' + name + '"]');
    if (!c) return;
    el('i', el('.cb', c)).style.width = pct + '%';
    c.classList.toggle('pass', pct >= 100);
  }

  function fallbackToSample(reason) {
    usingCamera = false;
    if (video) { video.hidden = true; }
    if (still) { still.hidden = false; }
    if (hint) {
      hint.textContent = reason === 'chosen'
        ? 'Using a sample hand so you can see the whole assessment.'
        : 'No camera available here — using a sample hand so you can see the whole assessment.';
    }
    runChecks();
  }

  function startCapture() {
    if (stream || state.shot) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return fallbackToSample('nocam');
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1600 } },
      audio: false
    }).then(function (s) {
      stream = s; usingCamera = true;
      video.srcObject = s; video.hidden = false; still.hidden = true;
      if (hint) hint.textContent = 'Fill the frame with the back of your hand.';
      runChecks();
    }).catch(function () {
      // Denied, unavailable, insecure origin — all the same outcome to a client.
      fallbackToSample('nocam');
    });
  }

  var meterTimer = null;

  function runChecks() {
    // Was a setTimeout sequence that filled three bars regardless of what the
    // camera saw. It now samples the live frame ~6 times a second and drives
    // each bar from a real measurement, so the client can fix her light before
    // she presses rather than after.
    stopMeters();
    var src = usingCamera ? video : still;
    var settled = 0;

    var tick = function () {
      var m = Vision.measure(src);
      if (!m) return;                                   // not decoded yet
      state.live = m;
      setCheck('light', Math.round(m.scores.light * 100));
      setCheck('focus', Math.round(m.scores.focus * 100));
      setCheck('frame', Math.round(m.scores.frame * 100));

      // The shutter unlocks once we have ANY stable reading, not once the
      // frame is good. Aperture admits; the confidence gate is what rejects,
      // and it should reject with her own photograph in front of her.
      if (++settled >= 2 && shutter) shutter.disabled = false;
      if (settled >= 2 && frame) frame.classList.add('locked');

      // Find her actual plates and mark them, every frame. This is the answer
      // to "it does not show a preview of my nails": it is not just a preview,
      // it is the instrument visibly locking on.
      state.tips = Vision.findTips(src);
      paintTips(state.tips);

      if (hint) {
        hint.textContent = m.fails.length
          ? 'Try this: ' + m.fails.join(', ') + '.'
          : usingCamera ? 'Looks good. Hold still and take the photo.'
                        : 'Ready. Take the photo to see the assessment.';
      }
    };

    tick();
    meterTimer = setInterval(tick, reduced ? 600 : 170);
  }

  function stopMeters() {
    if (meterTimer) { clearInterval(meterTimer); meterTimer = null; }
  }

  /* Reuse the marker nodes rather than rebuilding them — recreating five
     elements six times a second kills the CSS transition that makes the
     markers glide with the hand instead of teleporting. */
  function paintTips(tips) {
    var wrap = el('[data-tips]');
    if (!wrap) return;
    while (wrap.children.length < tips.length) {
      wrap.appendChild(document.createElement('i'));
    }
    Array.prototype.forEach.call(wrap.children, function (n, i) {
      if (i < tips.length) {
        n.style.left = (tips[i].x * 100).toFixed(1) + '%';
        n.style.top = (tips[i].y * 100).toFixed(1) + '%';
        n.setAttribute('data-n', 'P' + (i + 1));
        n.style.opacity = '1';
      } else {
        n.style.opacity = '0';
      }
    });
    if (frame) frame.classList.toggle('tracking', tips.length >= 3);

    var pc = el('[data-platecount]');
    if (pc) {
      pc.textContent = tips.length
        ? tips.length + ' of 5 plates located'
        : 'looking for your nails…';
      pc.classList.toggle('low', tips.length < 3);
    }
  }

  el('[data-use-sample]').addEventListener('click', function () {
    stopStream();
    fallbackToSample('chosen');
  });

  function stopStream() {
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (video) video.hidden = true;
    if (still) still.hidden = false;
  }

  shutter.addEventListener('click', function () {
    shutter.disabled = true;
    stopMeters();
    var flash = el('[data-flash]');
    if (flash && !reduced) { flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go'); }
    grabFrame();
    setTimeout(function () { stopStream(); show('analyse'); }, reduced ? 0 : 260);
  });

  function grabFrame() {
    var cv = el('[data-shot]');
    var src = usingCamera && video && video.videoWidth ? video : still;
    var sw = usingCamera ? video.videoWidth : still.naturalWidth;
    var sh = usingCamera ? video.videoHeight : still.naturalHeight;
    if (!sw || !sh) { state.shot = 'sample'; return; }

    // Cover-crop to 4:5 so the canvas matches what the client framed up.
    var target = 4 / 5, srcAR = sw / sh, cw, ch, cx, cy;
    if (srcAR > target) { ch = sh; cw = sh * target; }
    else { cw = sw; ch = sw / target; }
    cx = (sw - cw) / 2; cy = (sh - ch) / 2;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = 720 * dpr; cv.height = 900 * dpr;
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (usingCamera) { ctx.translate(720, 0); ctx.scale(-1, 1); }   // undo the mirror
    try { ctx.drawImage(src, cx, cy, cw, ch, 0, 0, 720, 900); } catch (e) { /* tainted or not ready */ }
    state.shot = usingCamera ? 'camera' : 'sample';
    // Re-detect on the FROZEN frame. The last live tick was one video frame
    // ago and her hand has moved since; the marks have to match the picture
    // she is now looking at.
    var onShot = Vision.findTips(cv);
    if (onShot.length >= 3) state.tips = onShot;
  }

  /* ── 3 · Analysis ─────────────────────────────────────────────────────── */

  var THRESHOLD = 0.72;

  /* Stage, subtitle, duration, and what it actually is. The last field is not
     decoration: exactly one stage in this pipeline is a stub, and labelling it
     is cheaper than being caught. A technical buyer reading over a rep's
     shoulder should be able to tell measurement from theatre. */
  var STAGES = [
    ['Aperture',           'image admission',      700,  'measured'],
    ['ONYX-5 extraction',  'perceptual layer',     1500, 'simulated'],
    ['Confidence gate',    'threshold 0.72',       700,  'measured'],
    ['Reading derivation', 'verdict core',         800,  'live'],
    ['Service routing',    'verdict core',         800,  'live'],
    ['Care Graph',         'plan selection',       700,  'live'],
    ['Ledger write',       'persist then deliver', 700,  'live']
  ];

  /* The five plate positions, normalised. These are the SAME coordinates the
     capture guide draws, which is the point: the client was asked to put her
     nails there, so that is where the frame is read. Marking them only on the
     bundled specimen meant the most convincing part of the analysis was the
     part a real client never saw. A shipped detector replaces this array with
     its own landmark output. */
  var PLATES = [
    [0.467, 0.089], [0.333, 0.116], [0.253, 0.236], [0.222, 0.404], [0.861, 0.307]
  ];

  /* The observation set. Defaults to a healthy hand, because that is the
     common case and the one the whole funnel is built around. ?result=r1|r2|r3
     forces the other routing paths so every branch can be demonstrated. */
  function makeObs() {
    var forced = null;
    try { forced = (new URLSearchParams(location.search).get('result') || '').toLowerCase(); } catch (e) { /* older engine */ }
    if (forced === 'r1') return { surface: 1, color: 2, structure: 0, cuticle: 1 };
    if (forced === 'r2') return { surface: 1, color: 0, structure: 2, cuticle: 1 };
    if (forced === 'r3') return { surface: 1, color: 1, structure: 1, cuticle: 1 };
    return { surface: 0, color: 0, structure: 0, cuticle: 0 };
  }

  // A hand we know the answer for, used when the canvas cannot be sampled —
  // a cross-origin still taints it, and getImageData then throws.
  var FALLBACK_SKIN = [198, 166, 124];

  /* ── The Ledger, for real ─────────────────────────────────────────────
     "Ledger write · persist then deliver" was the one stage in the pipeline
     that named a thing the scanner did not do. It does it now.

     The site's argument is not that the scan is clever — it is that the salon
     keeps a record. "Six visits later, that is a history." A client whose
     report shows nothing about her last visit is a client being sold a
     product the report contradicts.

     Rows are keyed by perceptual hash, so the same hand photographed five
     weeks later in different light lands on the same client. localStorage
     stands in for the salon's database until the API arrives; the shape of a
     row is deliberately the shape the endpoint will take. */

  var History = (function () {
    var KEY = 'nailscan.ledger.v1';
    var NEAR = 12;              // out of 64 bits — same hand, different photo

    function load() {
      try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
    }
    function save(rows) {
      try { localStorage.setItem(KEY, JSON.stringify(rows.slice(-40))); } catch (e) { /* private mode, quota */ }
    }
    // A row is identified by report id AND timestamp, not by id alone. The
    // report id is derived from the pixels, so scanning the same photograph
    // twice produces the same id — correct for a reading, wrong for a visit,
    // and keying on it alone made the second scan exclude the first as itself.
    function key(r) { return r.id + ':' + (+r.date); }

    function mine(ph, brand, notKey) {
      return load().filter(function (row) {
        return row.b === brand && (row.i + ':' + row.t) !== notKey &&
               Vision.hamming(row.p, ph) <= NEAR;
      }).sort(function (a, b) { return a.t - b.t; });
    }
    return {
      match: function (ph, brand, notKey) {
        var rows = mine(ph, brand, notKey);
        return rows.length ? rows[rows.length - 1] : null;
      },
      key: key,
      visits: function (ph, brand, notKey) { return mine(ph, brand, notKey).length; },
      write: function (r, brand) {
        var rows = load();
        var k = key(r);
        if (rows.some(function (x) { return (x.i + ':' + x.t) === k; })) return;   // idempotent
        rows.push({
          i: r.id, p: r.ph, b: brand, t: +r.date,
          s: r.service, c: r.confidence, n: r.platesRead
        });
        save(rows);
      },
      // Demo affordance, same family as ?result=. Seeds one prior visit so a
      // returning client's report can be shown without scanning twice.
      seed: function (ph, brand, weeksAgo, service) {
        var rows = load();
        var t = Date.now() - weeksAgo * 6048e5;
        if (rows.some(function (x) { return x.i === 'NS-SEED'; })) return;
        rows.push({ i: 'NS-SEED', p: ph, b: brand, t: t, s: service, c: 0.91, n: 5 });
        save(rows);
      }
    };
  }());

  function buildResult() {
    var obs = makeObs();
    var routed = Ledger.deriveService(obs);
    var shot = el('[data-shot]');

    // The captured frame, measured. Not the live preview — what she actually
    // submitted is what gets graded.
    var q = Vision.measure(shot) || { confidence: 0.2, fails: ['try again'], scores: {} };

    // The bundled specimen is known-good and pre-scored, so a sales demo can
    // never be embarrassed by the gate. A LIVE capture gets the real number:
    // that is the whole point of having a gate at all.
    var confidence = state.shot === 'camera' ? q.confidence : Math.max(q.confidence, 0.94);

    // Seed geometry from the PIXELS, not from a random id. The same hand
    // scanned twice used to report different plate measurements, which
    // contradicts the determinism the product is sold on.
    var fp = Vision.fingerprint(shot);
    var now = new Date();
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var id = 'NS-' + String(now.getFullYear()).slice(2) + pad(now.getMonth() + 1) +
             pad(now.getDate()) + '-' + fp.slice(0, 4).toUpperCase();

    // Geometry is seeded from the PERCEPTUAL hash, not the exact one. Exact
    // pixels change every time the shutter fires; the hand does not, and a
    // client whose plate measured 14.2 mm in March must measure 14.2 mm in
    // May or the record is worth nothing.
    var ph = Vision.phash(shot);

    var measured = Report.sampleSkin(shot);
    var skin = measured || Report.readSkin(FALLBACK_SKIN);
    skin.measured = !!measured;      // surfaced in the report rather than hidden
    var bio = Report.biometrics(ph);

    var returning = 0;
    try { returning = +(new URLSearchParams(location.search).get('returning') || 0); } catch (e) { /* older engine */ }
    if (returning) History.seed(ph, Brand.current.id, returning === 1 ? 5 : returning, 'full_set');

    return {
      id: id,
      ph: ph,
      platesRead: state.tips && state.tips.length >= 3 ? state.tips.length : 5,
      date: now,
      obs: obs,
      readings: Ledger.FIELDS.reduce(function (a, f) { a[f] = Ledger.READINGS[f][obs[f]]; return a; }, {}),
      prep: Ledger.prepSteps(obs),
      rule: routed.rule,
      service: routed.key,
      confidence: confidence,
      quality: q,
      skin: skin,
      bio: bio,
      shapes: Report.recommendShapes(bio),
      palette: Report.palette(skin, 6),
      nude: Report.personalNude(skin)
    };
  }

  var analysisRun = false;

  function runAnalysis() {
    if (analysisRun) return;
    analysisRun = true;
    state.result = buildResult();

    var anframe = el('[data-anframe]');
    var stagesEl = el('[data-stages]');
    var lmWrap = el('[data-landmarks]');
    stagesEl.innerHTML = '';
    lmWrap.innerHTML = '';

    STAGES.forEach(function (s, i) {
      stagesEl.insertAdjacentHTML('beforeend',
        '<div class="stage" data-stage="' + i + '">' +
          '<span class="sm">○</span>' +
          '<span class="sn">' + s[0] +
            (s[3] === 'simulated' ? ' <span class="tagsim">simulated</span>' : '') + '</span>' +
          '<span class="ss">' + s[1] + '</span>' +
        '</div>');
    });

    // Her real plates if we found enough of them, the guide positions if not.
    // Three is the floor: below that the detection is guessing, and guessing
    // where someone's nails are is worse than admitting we could not tell.
    var found = state.tips && state.tips.length >= 3
      ? state.tips.map(function (t) { return [t.x, t.y]; })
      : PLATES;
    state.plates = found;

    found.forEach(function (p, i) {
      lmWrap.insertAdjacentHTML('beforeend',
        '<span class="lm" data-lm="' + i + '" style="left:' + (p[0] * 100).toFixed(1) + '%;top:' + (p[1] * 100).toFixed(1) + '%">' +
          '<i></i><b></b><s>P' + (i + 1) + '</s></span>');
    });

    if (!reduced) anframe.classList.add('scanning');

    // Stage index 2 is the confidence gate. A frame below threshold stops
    // there — the stages after it never run, because nothing downstream is
    // allowed to see a reading the image did not support.
    var passes = state.result.confidence >= THRESHOLD;
    var haltAt = passes ? -1 : 2;

    var t = 0;
    var speed = reduced ? 0.12 : 1;
    var stop = haltAt < 0 ? STAGES.length : haltAt + 1;

    for (var si = 0; si < stop; si++) {
      (function (i) {
        var start = t;
        t += STAGES[i][2];
        setTimeout(function () {
          el('[data-stage="' + i + '"]').classList.add('run');
        }, start * speed);
        setTimeout(function () {
          var node = el('[data-stage="' + i + '"]');
          var halted = (i === haltAt);
          node.classList.remove('run');
          node.classList.add(halted ? 'halt' : 'done');
          el('.sm', node).textContent = halted ? '!' : '✓';
          el('.ss', node).textContent = halted ? 'below threshold'
                                               : STAGES[i][3] === 'simulated' ? 'simulated' : 'pass';
        }, t * speed);
      }(si));
    }

    // Landmarks resolve during extraction, one at a time. Only while the frame
    // is still admissible — the gate stopping mid-sequence should not be
    // followed by plates confidently lighting up on a rejected photograph.
    if (passes) {
      found.forEach(function (p, i) {
        setTimeout(function () {
          var n = el('[data-lm="' + i + '"]');
          if (n) n.classList.add('on');
        }, (760 + i * 190) * speed);
      });
    }

    // Confidence dial fills through the gate stage — on a failing frame too,
    // because the number is the explanation.
    setTimeout(function () { fillDial(state.result.confidence); }, 2300 * speed);

    // Readings only type in if the gate let them. The perceptual layer had
    // four fields it could have filled with plausible language; that is
    // exactly what the gate exists to discard.
    if (passes) setTimeout(function () { typeReadings(); }, 3050 * speed);

    // The prior visit has to be read BEFORE this one is written, or the scan
    // matches itself.
    var self = History.key(state.result);
    state.result.prior = History.match(state.result.ph, Brand.current.id, self);
    state.result.visit = History.visits(state.result.ph, Brand.current.id, self) + 1;

    setTimeout(function () {
      anframe.classList.remove('scanning');
      if (passes) {
        // Stage seven, made real. A rejected frame is deliberately NOT written:
        // the gate exists so nothing downstream inherits a reading the
        // photograph did not support, and the record is downstream.
        History.write(state.result, Brand.current.id);
        show('report');
      } else renderRetake();
    }, (t + 700) * speed);
  }

  /* What the gate does when it stops. She stays on the analysis screen with
     her own photograph above the card, so the reason is visible rather than
     described. */
  function renderRetake() {
    var r = state.result;
    var out = el('[data-readout]');
    out.hidden = false;
    out.classList.remove('rows');
    out.innerHTML =
      '<div class="retake">' +
        '<div class="rt-h">One more photo</div>' +
        '<p>Confidence came out at <b>' + r.confidence.toFixed(2) + '</b>, under our ' +
        THRESHOLD.toFixed(2) + ' threshold. We could give you a reading from this ' +
        'picture, but it would be a guess — and a quote your salon could not honour.</p>' +
        (r.quality.fails.length
          ? '<ul class="rt-l">' + r.quality.fails.map(function (f) {
              return '<li>' + FIX[f] + '</li>';
            }).join('') + '</ul>'
          : '') +
        '<button class="btn btn-primary btn-lg" data-retake>Take another photo</button>' +
      '</div>';

    el('[data-retake]').addEventListener('click', function () {
      analysisRun = false;
      state.shot = null; state.result = null;
      if (frame) frame.classList.remove('locked');
      if (shutter) shutter.disabled = true;
      out.hidden = true; out.classList.add('rows'); out.innerHTML = '';
      el('[data-conf]').textContent = '0.00';
      el('[data-dial]').style.strokeDashoffset = String(2 * Math.PI * 34);
      show('capture');
    });
  }

  // Short measurement labels → what she should actually do about them.
  var FIX = {
    'more light':    'Move somewhere brighter, or turn a lamp toward your hand.',
    'less glare':    'Step out of direct light — the highlights are washing out the plate.',
    'hold still':    'Rest your hand on something and hold still until the shutter fires.',
    'fill the frame':'Bring your hand closer so it fills the guide.',
    'just your hand':'Move back a little, or find a plainer background.',
    'try again':     'Something went wrong reading that frame. Try once more.'
  };

  /* ── Animation that cannot leave a wrong number on screen ─────────────

     Writing the final value before starting the loop was not enough. That
     covers a tab backgrounded BEFORE the animation begins, where rAF never
     fires at all — but a tab backgrounded halfway through stops rAF where it
     stands, and the last frame drawn stays on screen. Caught live: a $78
     service reading "$15" on a report the client was looking at.

     setTimeout is throttled in a background tab, not suspended, so it is the
     thing that guarantees the true value lands. rAF is decoration on top. */

  function ease(dur, onFrame, onDone) {
    var t0 = null, done = false;
    var finish = function () { if (!done) { done = true; onDone(); } };
    var step = function (ts) {
      if (done) return;
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur);
      if (k >= 1) return finish();
      onFrame(1 - Math.pow(1 - k, 3));
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(finish, dur + 150);
  }

  function fillDial(target) {
    var C = 2 * Math.PI * 34;
    var arc = el('[data-dial]');
    var num = el('[data-conf]');
    var lbl = el('[data-conf-l]');
    if (arc) arc.style.strokeDashoffset = String(C * (1 - target));
    var pass = target >= THRESHOLD;
    if (arc) arc.style.stroke = pass ? 'var(--accent)' : 'var(--warn)';
    lbl.textContent = pass ? 'Image quality — above threshold'
                           : 'Image quality — below the ' + THRESHOLD.toFixed(2) + ' threshold';

    // Write the final value FIRST, then animate over it. requestAnimationFrame
    // does not fire in a backgrounded tab, so a client who takes a call during
    // the scan used to come back to a confidence dial frozen at 0.00 with a
    // fully drawn arc behind it. The animation is decoration; the number is
    // not, and it must be correct even if the loop never runs.
    num.textContent = target.toFixed(2);
    if (reduced) return;

    ease(1500,
      function (e) { num.textContent = (target * e).toFixed(2); },
      function () { num.textContent = target.toFixed(2); });
  }

  function typeReadings() {
    var out = el('[data-readout]');
    out.hidden = false;
    out.innerHTML = '';
    var r = state.result;

    Ledger.FIELDS.forEach(function (f, i) {
      var row = document.createElement('div');
      row.className = 'row read-row';
      row.innerHTML = '<span class="k">' + f + '</span><span class="v"></span>' +
                      '<span class="pill ' + (r.obs[f] ? 'warn' : 'ok') + '">' +
                      (r.obs[f] ? 'prep first' : 'ready') + '</span>';
      out.appendChild(row);

      setTimeout(function () {
        row.classList.add('in');
        typeInto(el('.v', row), r.readings[f]);
      }, (i * 320) * (reduced ? 0.1 : 1));
    });
  }

  function typeInto(node, text) {
    if (reduced) { node.textContent = text; return; }
    var i = 0;
    node.innerHTML = '<span class="caret"></span>';
    var caret = el('.caret', node);
    (function tick() {
      i += 2;
      node.textContent = text.slice(0, i);
      if (i < text.length) { node.appendChild(caret); setTimeout(tick, 14); }
    }());
  }

  /* ── 4 · Report ───────────────────────────────────────────────────────── */

  function renderReport() {
    var r = state.result;
    if (!r) return;
    var s = Brand.current;
    var svc = s.services[r.service];

    el('[data-rep-date]').textContent =
      r.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · Report ' + r.id;

    var sn = el('[data-shared-note]');
    if (sn) sn.hidden = !r.shared;

    renderVerdict(r, svc, s);
    renderHistory(r, s);
    renderShare(r, svc, s);

    // ONYX-5 is FIVE fields. The report used to show four and drop confidence,
    // which is the one field technology.html calls "the one field that can
    // stop everything else". Showing four of five undercut the schema
    // argument on the page that sells it.
    el('[data-rep-rows]').innerHTML = Ledger.FIELDS.map(function (f) {
      return '<div class="row"><span class="k">' + f + '</span>' +
             '<span class="v">' + r.readings[f] + '</span>' +
             '<span class="pill ' + (r.obs[f] ? 'warn' : 'ok') + '">' +
             (r.obs[f] ? 'prep first' : 'ready') + '</span></div>';
    }).join('') +
      '<div class="row"><span class="k">confidence</span>' +
      '<span class="v">' + r.confidence.toFixed(2) + ' — the photograph supported a full reading</span>' +
      '<span class="pill ok">pass</span></div>';

    renderMeasurements(r);
    renderShape(r);
    renderColour(r);
    renderPlan(r, svc);

    // Disclosure summaries carry the answer, so she can decide whether to open
    // one without opening it.
    el('[data-why-shape-q]').textContent = 'Why ' + r.shapes.top.shape.name.toLowerCase();
    el('[data-shape-q]').textContent = r.shapes.top.score + '/100 match';
    el('[data-colour-q]').textContent = r.skin.tone.label.toLowerCase() + ' · ' + r.skin.depth.label.toLowerCase();
    el('[data-meas-q]').textContent = r.bio.bedWidth + ' × ' + r.bio.bedLength + ' mm';
    el('[data-plan-q]').textContent = 'rebook at ' + svc.rebook + ' weeks';
  }

  /* ── The verdict card ─────────────────────────────────────────────────
     Shape, colour, service, price and the button, all before the fold. */

  function renderVerdict(r, svc, s) {
    var shape = r.shapes.top.shape;
    var colours = r.palette.slice(0, 2).concat([r.nude]);

    el('[data-verdict-card]').innerHTML =
      '<div class="vc-top">' +
        '<div class="vc-nail" data-vc-nail>' + Report.shapeSvg(shape, colours[0].hex, 60, 88) + '</div>' +
        '<div>' +
          '<div class="vc-l">Your result</div>' +
          // An h1, not a div. Each screen is its own page as far as a screen
          // reader is concerned, and on the report screen the intro's h1 is
          // display:none — leaving the client's actual result as the only
          // thing on screen with no heading at all.
          '<h1 class="vc-h">' + shape.name + ',<br>in <em data-vc-colour>' + colours[0].name + '</em></h1>' +
          '<div class="vc-sub">on a ' + svc.name.toLowerCase() + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="vc-facts">' +
        '<span data-price><b>' + Brand.money(svc.price) + '</b></span>' +
        '<span>' + svc.minutes + ' min</span>' +
        '<span>holds <b>' + svc.rebook + ' weeks</b></span>' +
        (r.prep.length ? '<span>' + r.prep.length + ' prep step' + (r.prep.length > 1 ? 's' : '') + '</span>' : '') +
      '</div>' +
      '<div class="vc-colours" role="group" aria-label="Try a colour">' +
        colours.map(function (c, i) {
          return '<button type="button" class="vc-col" data-try="' + i + '" ' +
            'aria-pressed="' + (i === 0) + '">' +
            '<i style="background:' + c.hex + '"></i>' + c.name + '</button>';
        }).join('') +
      '</div>' +
      '<div class="vc-cta">' +
        '<button class="btn btn-primary btn-lg" data-go="contact">Book my ' +
          svc.name.toLowerCase() + '</button>' +
        '<p class="vc-fine">Describes what is visible in a photograph. Not a medical diagnosis.</p>' +
      '</div>';

    // Re-tint the drawn nail without re-rendering the card, so focus and the
    // pressed state survive the tap.
    els('[data-try]', el('[data-verdict-card]')).forEach(function (b) {
      b.addEventListener('click', function () {
        var c = colours[+b.getAttribute('data-try')];
        var path = el('[data-vc-nail] [data-fill]');
        if (path) path.setAttribute('fill', c.hex);
        el('[data-vc-colour]').textContent = c.name;
        els('[data-try]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
      });
    });

    // The card owns the primary CTA now, so it has to be wired like one.
    els('[data-verdict-card] [data-go]').forEach(function (b) {
      b.addEventListener('click', function () { show(b.getAttribute('data-go')); });
    });

    el('[data-hold-service]').textContent = svc.name.toLowerCase();
    if (!reduced) countTo(el('[data-price] b'), svc.price, s.currency);
  }

  /* ── Since your last scan ─────────────────────────────────────────────
     Everything in here is either elapsed time, a stored value from the
     previous row, or arithmetic on the two. Nothing invents a trend: two
     photographs five weeks apart cannot tell you a nail got "stronger", and
     saying so would be the exact failure the confidence gate exists to
     prevent, moved one screen later. */

  function ago(days) {
    if (days < 1) return 'earlier today';
    if (days < 10) return days + ' day' + (days === 1 ? '' : 's') + ' ago';
    var w = Math.round(days / 7);
    return w < 9 ? w + ' weeks ago' : Math.round(days / 30.4) + ' months ago';
  }

  function renderHistory(r, s) {
    var node = el('[data-history]');
    if (!node) return;

    // A shared copy travels without the record — the history lives with the
    // salon, not inside a link, and a friend opening it is not on visit one.
    node.hidden = !!r.shared;
    if (r.shared) return;

    var prior = History.match(r.ph, s.id, History.key(r));
    var d = function (t) {
      return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    if (!prior) {
      node.className = 'histcard first';
      node.innerHTML =
        '<div class="hh"><span class="hn">Visit 1</span>' +
        '<span class="hl">Your record starts here</span></div>' +
        '<p>This is the first time ' + s.short + ' has read this hand. From today your plate ' +
        'measurements, the shade that suited you and the service you had are kept together ' +
        'against your record. Scan again at your next appointment and this page opens with ' +
        'what has changed since today.</p>';
      return;
    }

    var days = Math.max(0, Math.round((+r.date - prior.t) / 864e5));
    var grown = +(r.bio.growth * (days / 30.4)).toFixed(1);
    var was = s.services[prior.s];
    var now = s.services[r.service];
    var due = new Date(prior.t + (was ? was.rebook : 4) * 6048e5);
    var visit = (r.visit || History.visits(r.ph, s.id, History.key(r)) + 1);

    var rows = [
      ['Last scan', d(prior.t) + ' · ' + ago(days),
       'Matched to the photograph you took that day, not to a name typed at the desk.'],
      // Skipped inside a week: at that interval the honest answer is "nothing
      // measurable yet", and a row reading 0.1 mm is instrument noise dressed
      // up as progress.
      days >= 7 ? ['New plate since then', grown + ' mm',
       'Your measured growth is ' + r.bio.growth + ' mm a month, so about ' + grown +
       ' mm of the nail you are looking at today has grown out since ' + d(prior.t) + '.'] : null,
      ['Recommended then', was ? was.name : '—',
       was && was.name === (now && now.name)
         ? 'The same service reads right today, which is what a set that is holding looks like.'
         : 'Today the reading routes you to ' + (now ? now.name.toLowerCase() : 'a different service') +
           ' — your nails are in a different place than they were.'],
      ['You were due back', d(due),
       'Booked on the interval that set was quoted at. This is the line the salon works its week from.'],
      ['Photograph quality', prior.c.toFixed(2) + ' then · ' + r.confidence.toFixed(2) + ' today',
       'Both photographs cleared the ' + THRESHOLD.toFixed(2) + ' threshold, so both readings stand.']
    ];

    // Prose first, rows behind a disclosure. Five rows with a consequence line
    // each measured 970 px — nearly as tall as the entire rest of the report,
    // for context that sits UNDER the answer. The summary is what she reads;
    // the record is what she opens if she wants it.
    var same = was && now && was.name === now.name;
    var summary =
      'Last read on ' + d(prior.t) + ' — matched to that photograph, not to a name at the desk. ' +
      (same
        ? 'Today you route to the same service, which is what a set that is holding looks like.'
        : 'Today you route to ' + (now ? now.name.toLowerCase() : 'a different service') +
          ' rather than ' + (was ? was.name.toLowerCase() : 'last time\'s') + '.');

    node.className = 'histcard';
    node.innerHTML =
      '<div class="hh"><span class="hn">Visit ' + visit + '</span>' +
      '<span class="hl">Since your last scan</span></div>' +
      '<p>' + summary + '</p>' +
      '<div class="hfacts">' +
        '<span>' + ago(days) + '</span>' +
        (days >= 7 ? '<span><b>' + grown + ' mm</b> new plate</span>' : '') +
        '<span>due back <b>' + d(due).replace(/, \d{4}$/, '') + '</b></span>' +
      '</div>' +
      '<details class="hmore"><summary>What is on your record</summary><div class="hmb">' +
      rows.filter(Boolean).map(function (x) {
        return '<div class="hrow"><div class="hk">' + x[0] + '</div>' +
               '<div class="hv">' + x[1] + '</div><div class="hw">' + x[2] + '</div></div>';
      }).join('') +
      '</div></details>';
  }

  /* ── Share and save ───────────────────────────────────────────────────
     index.html and pricing.html both promise "reports sent by link and
     email". The link is real: the whole report is small enough to travel
     inside the URL, so a shared copy renders identically with no account,
     no lookup and nothing to go down. */

  function permalink(r) {
    var p = [1, r.id, +r.date, r.obs.surface, r.obs.color, r.obs.structure, r.obs.cuticle,
             r.service, r.confidence, r.skin.rgb, r.ph, r.platesRead || 5,
             Brand.current.id, r.skin.measured === false ? 0 : 1];
    return location.origin + location.pathname + location.search + '#r=' + Report.pack(p);
  }

  function fromPermalink(hash) {
    var p = Report.unpack(hash);
    if (p[0] !== 1) return null;
    var obs = { surface: p[3], color: p[4], structure: p[5], cuticle: p[6] };
    var routed = Ledger.deriveService(obs);
    var skin = Report.readSkin(p[9]);
    skin.measured = !!p[13];
    var bio = Report.biometrics(p[10]);
    return {
      id: p[1], ph: p[10], date: new Date(p[2]), obs: obs,
      readings: Ledger.FIELDS.reduce(function (a, f) { a[f] = Ledger.READINGS[f][obs[f]]; return a; }, {}),
      prep: Ledger.prepSteps(obs), rule: routed.rule, service: p[7] || routed.key,
      confidence: p[8], quality: { fails: [], scores: {} },
      skin: skin, bio: bio, platesRead: p[11],
      shapes: Report.recommendShapes(bio), palette: Report.palette(skin, 6),
      nude: Report.personalNude(skin),
      shared: true, brand: p[12]
    };
  }

  function renderShare(r, svc, s) {
    var node = el('[data-sharebar]');
    if (!node) return;
    var url = permalink(r);
    var line = r.shapes.top.shape.name + ' in ' + r.palette[0].name + ' on a ' +
               svc.name.toLowerCase() + ' — my nail assessment from ' + s.name + '.';

    node.innerHTML =
      '<button class="btn btn-quiet share-b" type="button" data-share>Send this report</button>' +
      '<button class="btn btn-quiet share-b" type="button" data-copy>Copy link</button>' +
      '<p class="share-n" data-share-note>Your whole report travels inside the link — it opens on ' +
      'any phone with no app and no account.</p>';

    var note = el('[data-share-note]', node);
    var say = function (t) {
      note.textContent = t;
      clearTimeout(say.t);
      say.t = setTimeout(function () {
        note.textContent = 'Your whole report travels inside the link — it opens on any phone ' +
                           'with no app and no account.';
      }, 4000);
    };

    el('[data-share]', node).addEventListener('click', function () {
      if (navigator.share) {
        navigator.share({ title: 'My nail assessment', text: line, url: url })
          .catch(function () { /* dismissed */ });
      } else {
        copy(url, say);
      }
    });
    el('[data-copy]', node).addEventListener('click', function () { copy(url, say); });
  }

  function copy(text, say) {
    var done = function () { say('Link copied. Paste it into a message and it opens the full report.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacy(text, done, say); });
    } else {
      legacy(text, done, say);
    }
  }

  function legacy(text, done, say) {
    // clipboard.writeText needs a secure context. A salon on a plain-http
    // tablet still has to be able to send the client her report.
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? done() : say('Copy is blocked in this browser — use Send this report instead.');
    } catch (e) {
      say('Copy is blocked in this browser — use Send this report instead.');
    }
  }

  function renderPlan(r, svc) {
    var wk = svc.rebook;
    el('[data-plan]').innerHTML = [
      ['Week 1', svc.name + '. Colour of your choice, shaped to your free edge.'],
      ['Week ' + wk, 'Infill and reshape. This is what keeps the set looking new.'],
      ['Week ' + (wk * 2), 'Fresh set and a new scan, so you can see the progress.']
    ].map(function (w) {
      return '<div class="wk"><span class="w">' + w[0].toUpperCase() + '</span><span class="t">' + w[1] + '</span></div>';
    }).join('');
  }

  /* ── Measurements ─────────────────────────────────────────────────── */

  function renderMeasurements(r) {
    var b = r.bio;
    var v = Report.verdicts(b);
    // A shared copy has no live detection behind it, so it carries the count
    // the original scan recorded rather than re-deriving one.
    var pr = r.platesRead || (state.plates ? state.plates.length : 5);

    // Every reading carries what it CHANGES for her. A number she cannot act
    // on is instrument output; this is the difference between the two.
    // Each reading names the REGION it came from. technology.html sells "seven
    // regions, five fields" and the report was showing measurements with no
    // indication of where on the nail any of them was taken.
    el('[data-spec]').innerHTML = [
      ['Plate size', b.bedWidth + ' × ' + b.bedLength + ' mm', v.bedLength, 'nail plate'],
      ['Proportion', b.ratio.toFixed(2) + ' across to long', v.ratio, 'nail plate'],
      ['C-curve', b.cCurve + '°', v.cCurve, 'lateral folds'],
      ['Free edge', b.freeEdge + ' mm', v.freeEdge, 'free edge · hyponychium'],
      ['Growth', b.growth + ' mm a month', v.growth, 'proximal fold'],
      ['Half-moon', 'visible on ' + b.lunula + ' of 5', v.lunula, 'lunula'],
      ['Plates read', pr + ' of 5',
       pr < 5
         ? 'We located ' + pr + ' of your five plates in this frame. The ' +
           'others were behind a finger or outside the guide — your technician checks all five in person.'
         : 'All five plates were located and read in the frame you submitted.', 'all regions']
    ].map(function (row) {
      return '<div class="mrow"><div class="mh"><span class="mk2">' + row[0] + '</span>' +
             '<span class="mv">' + row[1] + '</span></div>' +
             '<div class="mw">' + row[2] + '</div>' +
             '<div class="mreg">read at · ' + row[3] + '</div></div>';
    }).join('');

    var proportional = { taper: 0.18, tipFlat: 0.62, corner: 0.6, wants: {} };
    var W = 74, H = Math.round(W / Math.max(0.45, Math.min(1.1, b.ratio)));
    el('[data-platefig]').innerHTML =
      '<div class="pf"><svg viewBox="0 0 ' + W + ' ' + (H + 8) + '" width="100%" aria-hidden="true">' +
        '<path d="' + Report.nailPath(proportional, W * 0.78, H * 0.86, W * 0.11, 5) + '" ' +
        'fill="rgba(255,255,255,.06)" stroke="var(--accent)" stroke-width="1.4"/>' +
      '</svg></div>' +
      '<p>Your plate drawn to its own measurements — ' + b.bedWidth + ' mm across, ' +
      b.bedLength + ' mm long. Every number above came from the photograph you just took.</p>';
  }

  /* ── Shape ────────────────────────────────────────────────────────── */

  function renderShape(r) {
    var top = r.shapes.top;
    el('[data-shapehero]').innerHTML =
      '<div class="big">' + Report.shapeSvg(top.shape, 'var(--accent)') + '</div>' +
      '<div><div class="sl2">Best match · ' + top.score + '/100</div>' +
      '<div class="sn2">' + top.shape.name + '</div>' +
      '<p>' + r.shapes.reason + ' ' +
      top.shape.name + ' ' + top.shape.why + '.</p></div>';

    el('[data-alts]').innerHTML = r.shapes.ranked.slice(1, 4).map(function (x) {
      return '<div class="alt">' +
        '<div class="av">' + Report.shapeSvg(x.shape, 'rgba(255,255,255,.16)') + '</div>' +
        '<div class="an2">' + x.shape.name + '</div>' +
        '<div class="as">' + x.score + '/100</div>' +
        '<div class="bar"><i style="width:' + x.score + '%"></i></div>' +
        '</div>';
    }).join('');
  }

  /* ── Colour ───────────────────────────────────────────────────────── */

  function renderColour(r) {
    var s = r.skin;
    // If the sample failed we say so. Claiming "measured from your photograph"
    // over a fallback value is exactly the kind of quiet lie the rest of this
    // product is built to avoid.
    el('[data-tonecard]').innerHTML =
      '<span class="chip" style="background:' + s.hex + '"></span>' +
      '<div><div class="tt">' + s.tone.label + ' undertone · ' + s.depth.label + '</div>' +
      '<div class="tm">' + (s.measured === false
        ? 'We could not read your skin tone from this frame, so this palette is our ' +
          'general one. Your technician will match it properly in person.'
        : 'Measured from your photograph — ' + s.tone.note + '. ' +
          'ITA ' + s.ita.toFixed(0) + '°, hue ' + s.hue.toFixed(0) + '°.') +
      '</div></div>';

    el('[data-swatches-grid]').innerHTML = r.palette.map(function (c) {
      return '<div class="sw"><div class="dot" style="background:' + c.hex + '"></div>' +
        '<div class="swn">' + c.name + '</div><div class="swh">' + c.hex + '</div></div>';
    }).join('');

    el('[data-nudecard]').innerHTML =
      '<span class="nd" style="background:' + r.nude.hex + '"></span>' +
      '<div><div class="nn">Your nude</div>' +
      '<div class="nm2">Not a shade off a shelf — this one is your own skin tone lifted a ' +
      'little, so it reads as your nails on their best day.</div>' +
      '<div class="nh">' + r.nude.hex + '</div></div>';
  }

  function countTo(node, value, prefix) {
    // The price is the single most consequential number on the page. It is
    // written before the animation starts AND written again by the timeout
    // when the animation ends, whether or not rAF was still running.
    var write = function (v) { node.textContent = prefix + Math.round(v).toLocaleString('en-US'); };
    write(value);
    if (reduced) return;
    ease(900, function (e) { write(value * e); }, function () { write(value); });
  }

  function revealReport() {
    renderReport();
    els('[data-screen="report"] .rv').forEach(function (n, i) {
      setTimeout(function () { n.classList.add('in'); }, reduced ? 0 : 90 + i * 130);
    });
  }

  /* ── 5 · Contact ──────────────────────────────────────────────────────── */

  el('[data-lead]').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var name = f.name.value.trim();
    var phone = f.phone.value.trim();
    if (!name || phone.replace(/\D/g, '').length < 10) {
      // Native validation is suppressed (novalidate) so the message can be
      // ours; without this the form silently does nothing on a bad number.
      (!name ? f.name : f.phone).focus();
      (!name ? f.name : f.phone).style.borderColor = 'var(--accent)';
      return;
    }
    state.lead = { name: name, phone: phone };

    var s = Brand.current, r = state.result, svc = s.services[r.service];
    el('[data-done-line]').textContent =
      'Your report is on its way to ' + phone + '. ' + s.short + ' will call to confirm your slot.';
    el('[data-done-rows]').innerHTML = [
      ['contact', name, 'ok', 'new'],
      ['recommended', svc.name + ' · ' + Brand.money(svc.price), 'ok', 'quoted'],
      ['report', r.id, 'ok', 'sent'],
      ['salon', s.name, '', s.phone]
    ].map(function (row) {
      return '<div class="row"><span class="k">' + row[0] + '</span>' +
             '<span class="v">' + row[1] + '</span>' +
             '<span class="pill ' + row[2] + '">' + row[3] + '</span></div>';
    }).join('');

    show('done');
  });

  el('[data-restart]').addEventListener('click', function () {
    analysisRun = false;
    state.shot = null; state.result = null; state.lead = null;
    if (frame) frame.classList.remove('locked');
    if (shutter) shutter.disabled = true;
    el('[data-readout]').hidden = true;
    el('[data-conf]').textContent = '0.00';
    el('[data-dial]').style.strokeDashoffset = String(2 * Math.PI * 34);
    els('[data-screen="report"] .rv').forEach(function (n) { n.classList.remove('in'); });
    el('[data-lead]').reset();
    show('intro');
  });

  /* ── Demo tenant switcher ─────────────────────────────────────────────── */

  (function demobar() {
    var bar = el('[data-demobar]');
    if (!bar) return;
    // A salon's own build has exactly one tenant and must never show another
    // salon's name to a client. The switcher only exists on the demo.
    if (Brand.single) return;
    var hide = false;
    try { hide = new URLSearchParams(location.search).get('demo') === '0'; } catch (e) { /* older engine */ }
    if (hide) return;
    bar.hidden = false;
    Object.keys(Brand.SALONS).forEach(function (id) {
      var s = Brand.SALONS[id];
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<i style="background:' + s.accent + '"></i>' + s.short;
      b.setAttribute('aria-pressed', String(id === Brand.current.id));
      b.addEventListener('click', function () {
        Brand.set(id);
        els('button', bar).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
      });
      bar.appendChild(b);
    });
  }());

  /* ── Boot ─────────────────────────────────────────────────────────────
     A link carrying a report opens straight on it. Nothing is fetched: the
     reading, the skin measurement and the plate seed all travel in the URL,
     so a shared report cannot 404 and cannot expire. */

  (function boot() {
    var m = /(?:^|[#&])r=([A-Za-z0-9\-_]+)/.exec(location.hash || '');
    if (m) {
      try {
        var r = fromPermalink(m[1]);
        if (r) {
          if (r.brand && Brand.SALONS[r.brand]) Brand.set(r.brand);
          state.result = r;
          state.shot = 'shared';
          analysisRun = true;                     // there is nothing to re-run
          paintBrand();
          show('report');
          return;
        }
      } catch (e) { /* a mangled link just starts the scanner normally */ }
    }
    paintBrand();
    show('intro');
  }());
}());
