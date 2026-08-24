/* NailScan Try — flow controller.
 *
 * Stage machine: intro -> capture -> (reject) -> analyzing -> report -> done.
 * Target is one tap from landing to camera, and one form, once, at the reveal.
 *
 * HTML note: `display.headline`, `verdict.line` and `checks[].v` carry markup
 * from the Worker's copy bank (<b>, <span class="italic">). That bank is ours,
 * server-side, and closed — it is never user input. Everything that does come
 * from a person is written with textContent.
 */
(function () {
  'use strict';

  var CFG = window.NAILSCAN_CONFIG;
  var GATE = window.NailScanGate;
  var $ = function (id) { return document.getElementById(id); };
  var REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = {
    dataUrl: null,      // full-res capture, for display
    uploadUrl: null,    // re-encoded, for the wire
    record: null,
    stream: null,
    warnings: []
  };

  /* ------------------------------------------------------------- theme -- */

  (function applyConfig() {
    var r = document.documentElement;
    Object.keys(CFG.theme || {}).forEach(function (k) { r.style.setProperty(k, CFG.theme[k]); });

    if (CFG.brand.logo) {
      $('wordmark').innerHTML = '';
      var img = new Image(); img.src = CFG.brand.logo; img.alt = CFG.brand.name;
      $('wordmark').appendChild(img);
    } else {
      $('wordmark').textContent = CFG.brand.mark;
    }
    $('unit-meta').textContent = CFG.brand.unit;
    $('intro-lede').textContent = CFG.brand.intro;
    $('consent-line').textContent = CFG.lead.consent;
    $('legal-line').textContent = CFG.legal;
    $('foot-brand').textContent = CFG.brand.name + ' · cosmetic nail assessment';
    $('cross-t').textContent = CFG.crossLink.label;
    $('cross').href = CFG.crossLink.href;
    document.title = CFG.brand.name + ' — scan your own nails';

    var sel = $('in-country');
    CFG.lead.countries.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.code;
      o.textContent = c.dial + ' ' + c.code;
      o.dataset.dial = c.dial;
      if (c.code === CFG.lead.defaultCountry) o.selected = true;
      sel.appendChild(o);
    });
  })();

  /* ------------------------------------------------------------ stages -- */

  var current = 'intro';
  function stage(name) {
    if (current === 'capture' && name !== 'capture') stopCamera();
    ['intro', 'capture', 'reject', 'analyzing', 'report', 'error'].forEach(function (s) {
      $('stage-' + s).classList.toggle('is-active', s === name);
    });
    current = name;
    window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
  }

  /* ------------------------------------------------------------ camera -- */

  var video = $('cam');

  function stopCamera() {
    if (state.stream) { state.stream.getTracks().forEach(function (t) { t.stop(); }); state.stream = null; }
    video.style.display = 'none';
    $('brackets').style.display = 'none';
    $('cap-hint').style.display = 'none';
    $('viewport').classList.add('is-idle');
  }

  async function openCamera() {
    stage('capture');
    $('cap-status').textContent = 'Requesting camera…';
    $('btn-shutter').disabled = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return cameraUnavailable('This browser has no camera access.');
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: CFG.capture.facingMode },
          width: { ideal: CFG.capture.idealWidth },
          height: { ideal: CFG.capture.idealWidth }
        }
      });
      video.srcObject = state.stream;
      await video.play();
      video.style.display = 'block';
      $('brackets').style.display = 'block';
      $('cap-hint').style.display = 'block';
      $('viewport').classList.remove('is-idle');
      $('cap-status').textContent = 'Camera live · ' + video.videoWidth + '×' + video.videoHeight;
      $('btn-shutter').disabled = false;
    } catch (e) {
      cameraUnavailable(e && e.name === 'NotAllowedError'
        ? 'Camera blocked. Upload a photo instead.'
        : 'No camera available. Upload a photo instead.');
    }
  }

  function cameraUnavailable(msg) {
    $('cap-status').textContent = msg;
    $('btn-shutter').disabled = true;
    $('btn-upload').classList.add('btn');
    $('btn-upload').classList.remove('btn-quiet');
  }

  /* ------------------------------------------ capture -> gate -> upload -- */

  function frameToCanvas(source) {
    var sw = source.videoWidth || source.naturalWidth;
    var sh = source.videoHeight || source.naturalHeight;
    var c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(source, 0, 0, sw, sh);
    return c;
  }

  /* Re-encode to JPEG under the configured byte budget. The Worker stores this
   * exact image, so quality steps down rather than dimensions collapsing. */
  function encodeForUpload(canvas) {
    var maxPx = CFG.capture.uploadMaxPx;
    var scale = Math.min(1, maxPx / Math.max(canvas.width, canvas.height));
    var c = canvas;
    if (scale < 1) {
      c = document.createElement('canvas');
      c.width = Math.round(canvas.width * scale);
      c.height = Math.round(canvas.height * scale);
      c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
    }
    var budget = CFG.capture.uploadMaxKb * 1024;
    var q = 0.9, url = c.toDataURL('image/jpeg', q);
    while (url.length * 0.75 > budget && q > 0.4) {
      q -= 0.1;
      url = c.toDataURL('image/jpeg', q);
    }
    return url;
  }

  function handleFrame(source) {
    var canvas = frameToCanvas(source);
    var verdict;
    try {
      verdict = GATE.check(canvas, CFG.gate);
    } catch (e) {
      verdict = { pass: true, fails: [], warnings: [], metrics: null };   // never block on a gate bug
    }

    if (!verdict.pass) return showReject(verdict);

    state.warnings = verdict.warnings;
    state.dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    state.uploadUrl = encodeForUpload(canvas);
    stopCamera();
    analyze();
  }

  function fmt(n, d) { return (Math.round(n * Math.pow(10, d || 0)) / Math.pow(10, d || 0)).toFixed(d || 0); }

  function showReject(v) {
    var m = v.metrics;
    var shadowed = v.fails.some(function (f) { return f.code === 'shadowed'; });
    var dark = v.fails.some(function (f) { return f.code === 'too_dark'; });

    $('rej-h').textContent = shadowed && !dark
      ? 'Your nails are sitting in shadow.'
      : 'Too dark to read your nails.';
    $('rej-copy').textContent = shadowed && !dark
      ? 'Turn to face the light instead of standing in front of it, then retake.'
      : 'Face a window or turn on a light, then retake.';

    var rows = [
      ['Brightness', fmt(m.meanLuma) + ' / 255', m.meanLuma < CFG.gate.minMeanLuma],
      ['Needs at least', CFG.gate.minMeanLuma + ' / 255', false],
      ['In shadow', fmt(m.shadowPct, 1) + '%', m.shadowPct > CFG.gate.maxShadowPct],
      ['Limit', CFG.gate.maxShadowPct + '%', false]
    ];
    var dl = $('rej-readout');
    dl.innerHTML = '';
    rows.forEach(function (r) {
      var dt = document.createElement('dt'); dt.textContent = r[0];
      var dd = document.createElement('dd'); dd.textContent = r[1];
      dd.className = r[2] ? 'bad' : '';
      dl.appendChild(dt); dl.appendChild(dd);
    });

    stage('reject');
  }

  /* --------------------------------------------------------- analysing -- */

  var STEPS = ['Uploading frame', 'Reading plate surface', 'Checking cuticle line', 'Compiling record'];

  async function analyze() {
    $('an-photo').src = state.dataUrl;
    stage('analyzing');

    var t0 = Date.now(), done = false, i = 0;
    $('an-step').textContent = STEPS[0];
    $('an-fill').style.width = '4%';
    $('an-pct').textContent = '04%';

    // Progress is time-based and asymptotic — it approaches 92% and holds there
    // until the response actually lands. It never claims a step it cannot see.
    var tick = setInterval(function () {
      if (done) return;
      var t = (Date.now() - t0) / 1000;
      var pct = Math.min(92, 4 + 88 * (1 - Math.exp(-t / 7)));
      $('an-fill').style.width = pct + '%';
      $('an-pct').textContent = String(Math.round(pct)).padStart(2, '0') + '%';
      var want = Math.min(STEPS.length - 1, Math.floor(t / 3.2));
      if (want !== i) {
        i = want;
        $('an-step').style.opacity = 0;
        setTimeout(function () { $('an-step').textContent = STEPS[i]; $('an-step').style.opacity = 1; }, 180);
      }
    }, 220);

    try {
      var res = await fetch(CFG.api.base + CFG.api.analyze, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: state.uploadUrl, source: 'try-demo' })
      });
      var body = await res.json().catch(function () { return null; });
      if (!res.ok || !body || !body.record) throw new Error((body && body.error) || 'http_' + res.status);

      done = true; clearInterval(tick);
      $('an-fill').style.width = '100%';
      $('an-pct').textContent = '100%';
      $('an-step').textContent = 'Record complete';

      state.record = body.record;
      setTimeout(function () { renderReport(body.record); }, REDUCED ? 0 : 420);
    } catch (e) {
      done = true; clearInterval(tick);
      $('err-copy').textContent = e && /rate_limited/.test(e.message)
        ? 'Too many scans from this connection in the last hour. Try again shortly.'
        : 'The reading service did not answer. Your photo was not stored.';
      stage('error');
    }
  }

  /* ------------------------------------------------------------ report -- */

  function renderReport(rec) {
    var d = rec.display, v = d.verdict || {};

    $('rep-thumb').src = state.dataUrl;
    $('rep-badge-t').textContent = (v.num || '') + ' · ' + (v.label || '');
    $('rep-h').innerHTML = d.headline || '';
    $('rep-line').innerHTML = v.line || '';
    $('rep-sub').textContent = v.sub || '';

    var ul = $('rep-checks');
    ul.innerHTML = '';
    (d.checks || []).forEach(function (c) {
      var li = document.createElement('li');
      li.className = c.status === 'good' ? 'good' : 'note';
      var k = document.createElement('span'); k.className = 'k'; k.textContent = c.k;
      var val = document.createElement('span'); val.className = 'v'; val.innerHTML = c.v;
      li.appendChild(k); li.appendChild(val);
      ul.appendChild(li);
    });
    $('rep-checks-block').hidden = (d.checks || []).length === 0;
    $('rep-checks-n').textContent = (d.checks || []).length
      ? String((d.checks || []).length).padStart(2, '0') + ' OBSERVED' : '';

    if (d.medical) {
      $('rep-medical').textContent = d.medical;
      $('rep-medical-block').hidden = false;
    }

    // Soft-focus warning from the gate — surfaced, never hidden.
    if (state.warnings.length) {
      var w = document.createElement('p');
      w.className = 'callout';
      w.textContent = 'Focus read soft on that frame. The findings hold, but a sharper retake reads finer detail.';
      $('rep-checks-block').appendChild(w);
    }

    var hasCal = !!(d.calendar && d.calendar.milestones && d.calendar.milestones.length);
    if (hasCal) {
      $('rep-lock').hidden = false;
      $('rep-lockline').textContent = d.calendar.milestones.length + ' dated milestones'
        + (d.calendar.grown_out ? ' · grow-out date' : '')
        + (d.carry ? ' · what suits you' : '');
      $('rep-cal-intro').textContent = d.calendar.intro || '';
      var tl = $('rep-timeline'); tl.innerHTML = '';
      d.calendar.milestones.forEach(function (m) {
        var li = document.createElement('li');
        var dt = document.createElement('span'); dt.className = 'dt'; dt.textContent = shortDate(m.date);
        var bd = document.createElement('span'); bd.className = 'bd';
        var b = document.createElement('b'); b.textContent = m.label;
        bd.appendChild(b);
        if (m.sub) { var s = document.createElement('span'); s.textContent = m.sub; bd.appendChild(s); }
        li.appendChild(dt); li.appendChild(bd);
        tl.appendChild(li);
      });
      if (d.calendar.grown_out) {
        var p = document.createElement('p');
        p.className = 'callout';
        p.textContent = 'At normal growth, the wear in this photo is fully grown out around '
          + shortDate(d.calendar.grown_out) + '.';
        tl.parentNode.appendChild(p);
      }
      if (d.carry) {
        var c = $('rep-carry'); c.innerHTML = '';
        var head = document.createElement('div'); head.className = 'section-head';
        head.style.marginTop = '26px';
        var eb = document.createElement('p'); eb.className = 'eyebrow'; eb.textContent = 'What suits you';
        head.appendChild(eb); c.appendChild(head);
        [d.carry.now, d.carry.later].forEach(function (x) {
          var li = document.createElement('div'); li.className = 'timeline';
          li.innerHTML = '';
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;gap:16px;padding:13px 0;border-bottom:1px solid var(--line)';
          var tag = document.createElement('span'); tag.className = 'dt'; tag.textContent = x.tag;
          var bd = document.createElement('span'); bd.className = 'bd';
          var b = document.createElement('b'); b.textContent = x.name;
          var s = document.createElement('span'); s.textContent = x.line;
          bd.appendChild(b); bd.appendChild(s);
          row.appendChild(tag); row.appendChild(bd);
          li.appendChild(row); c.appendChild(li);
        });
      }
    } else {
      // No calendar (medical / unclear) — nothing to lock, so no form gate either.
      $('rep-form-block').hidden = true;
    }

    stage('report');
    revealIn();
  }

  function revealIn() {
    var els = document.querySelectorAll('#stage-report .reveal');
    Array.prototype.forEach.call(els, function (el) {
      if (!el.hidden) el.classList.add('is-in');
    });
  }

  function shortDate(iso) {
    try {
      return new Date(iso + 'T00:00:00Z').toLocaleDateString(CFG.brand.locale, {
        month: 'short', day: 'numeric', timeZone: 'UTC'
      });
    } catch (e) { return iso; }
  }

  /* -------------------------------------------------------------- lead -- */

  function bad(fieldId, on) { $(fieldId).classList.toggle('is-bad', !!on); }

  function dialFor(code) {
    var c = CFG.lead.countries.filter(function (x) { return x.code === code; })[0];
    return c ? c.dial : '+1';
  }

  function e164(country, raw) {
    var dial = dialFor(country);
    var digits = String(raw || '').replace(/\D/g, '');
    var cc = dial.replace('+', '');
    if (digits.indexOf('00') === 0) digits = digits.slice(2);
    if (digits.length > 10 && digits.indexOf(cc) === 0) digits = digits.slice(cc.length);
    if (country === 'US' || country === 'CA') {
      if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
      if (digits.length !== 10) return null;
    } else if (digits.length < 7 || digits.length > 14) {
      return null;
    }
    return dial + digits;
  }

  $('lead-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();

    var name = $('in-name').value.trim();
    var salon = $('in-salon').value.trim();
    var email = $('in-email').value.trim();
    var country = $('in-country').value;
    var phone = e164(country, $('in-phone').value);

    var okName = name.length > 1;
    var okSalon = salon.length > 1;
    var okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    bad('f-name', !okName); bad('f-salon', !okSalon);
    bad('f-email', !okEmail); bad('f-phone', !phone);
    if (!okName || !okSalon || !okEmail || !phone) {
      var firstBad = document.querySelector('#lead-form .field.is-bad input');
      if (firstBad) firstBad.focus();
      return;
    }

    var btn = $('btn-lead');
    btn.disabled = true;
    $('btn-lead-t').textContent = 'Sending…';

    try {
      var res = await fetch(CFG.api.base + CFG.api.lead, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: state.record.id,
          name: name, salon: salon, email: email,
          phone: phone, country: country,
          consent: true, source: 'try-demo'
        })
      });
      if (!res.ok) throw new Error('http_' + res.status);
      unlock(name, email);
    } catch (e) {
      // The calendar is already computed and already on this device. A CRM
      // failure is ours, not hers — never hold her report hostage to it.
      unlock(name, email);
    }
  });

  function unlock(name, email) {
    $('rep-lock').classList.add('is-open');
    $('rep-cal-body').setAttribute('aria-hidden', 'false');
    $('rep-cal-n').textContent = 'OPEN';
    $('rep-form-block').hidden = true;
    $('done-copy').textContent = 'A copy of this reading is on its way to ' + email
      + '. Your calendar is open below.';
    $('rep-done').hidden = false;
    $('rep-done').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
  }

  /* ------------------------------------------------------------- wiring -- */

  $('btn-start').addEventListener('click', openCamera);
  $('btn-retake').addEventListener('click', openCamera);
  $('btn-err-retry').addEventListener('click', openCamera);
  $('btn-again').addEventListener('click', function () { location.reload(); });

  $('btn-shutter').addEventListener('click', function () {
    if (!video.videoWidth) return;
    handleFrame(video);
  });

  $('btn-upload').addEventListener('click', function () { $('file').click(); });

  $('file').addEventListener('change', function (ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var img = new Image();
    img.onload = function () { URL.revokeObjectURL(img.src); handleFrame(img); };
    img.onerror = function () { $('cap-status').textContent = 'That file could not be read.'; };
    img.src = URL.createObjectURL(f);
    ev.target.value = '';
  });
})();
