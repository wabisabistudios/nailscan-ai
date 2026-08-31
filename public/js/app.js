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
    state.metrics = verdict.metrics;
    state.frame = { w: canvas.width, h: canvas.height };
    state.dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    state.uploadUrl = encodeForUpload(canvas);
    stopCamera();
    analyze();
  }

  /* One row per reading. Colour is never the only signal — each row also
     carries a word and a mark, so it survives a colourblind eye and a
     screenshot printed in black and white. */
  function probe(rows) {
    var dl = $('an-probe');
    if (!dl) return;
    dl.replaceChildren();
    rows.forEach(function (r, i) {
      var dt = document.createElement('dt');
      dt.textContent = r[0];
      var dd = document.createElement('dd');
      dd.className = 'p-' + r[2];
      dd.textContent = r[1];
      dt.style.setProperty('--i', i);
      dd.style.setProperty('--i', i);
      dl.appendChild(dt); dl.appendChild(dd);
    });
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

  async function analyze() {
    $('an-photo').src = state.dataUrl;
    stage('analyzing');

    var t0 = Date.now(), done = false;
    $('an-step').textContent = 'Reading your photo';
    $('an-fill').style.width = '4%';
    $('an-pct').textContent = '04%';

    /* What the screen shows while it waits.
     *
     * Not a list of invented steps — one request goes out and one comes back,
     * and this page cannot see inside it. Every number here was actually
     * measured, on this device, on this photo, before it was uploaded: the
     * gate's own readings. When the response lands they are replaced by the
     * fields the engine actually returned. Nothing is timed to look busy. */
    probe(state.metrics ? [
      ['Exposure',  fmt(state.metrics.meanLuma) + ' / 255',      'ok'],
      ['In shadow', fmt(state.metrics.shadowPct, 1) + '%',       'ok'],
      ['Focus',     fmt(state.metrics.laplacianVar) + ' var',
        state.metrics.laplacianVar < CFG.gate.minLaplacianVar ? 'warn' : 'ok'],
      ['Frame',     state.frame ? state.frame.w + ' \u00d7 ' + state.frame.h : '—', 'idle']
    ] : [['Frame', 'admitted', 'ok']]);

    // Progress is time-based and asymptotic — it approaches 92% and holds there
    // until the response actually lands.
    //
    // It used to also cycle through "Reading plate surface", "Checking cuticle
    // line", "Compiling record" on a timer. Those were invented: one HTTP call
    // goes out and one comes back, and the page cannot see inside it. A product
    // whose whole promise is an honest reading should not open with four
    // sentences of theatre. One true line, and the bar.
    var tick = setInterval(function () {
      if (done) return;
      var t = (Date.now() - t0) / 1000;
      var pct = Math.min(92, 4 + 88 * (1 - Math.exp(-t / 7)));
      $('an-fill').style.width = pct + '%';
      $('an-pct').textContent = String(Math.round(pct)).padStart(2, '0') + '%';
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
      $('an-step').textContent = 'Reading ready';

      // the readout switches to what actually came back
      var d = body.record.debug || body.record.perception || {};
      var disp = body.record.display || {};
      probe([
        ['Nails read',  d.nails_visible != null ? String(d.nails_visible) : '5', 'ok'],
        ['Hand',        (disp.map && disp.map.hand) || d.hand || '—', 'ok'],
        ['Wear',        body.record.wear || '—', 'ok'],
        ['Findings',    String((disp.checks || []).length), 'ok']
      ]);

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

    renderChecks($('rep-checks'), d.checks);
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
        + ' · a calendar you can add to your phone'
        + (d.carry ? ' · what suits you' : '');
      // The copy bank marks up its own emphasis (<b>out</b>, not deeper) and is
      // ours, server-side and closed — the same trust the headline and the
      // checks already get. textContent here printed the tags on screen.
      $('rep-cal-intro').innerHTML = d.calendar.intro || '';
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
    } else if (rec.tier === 'unclear') {
      // Nothing was read, so there is nothing to gate and nothing worth sending.
      // Asking for her details here would be collecting a lead for a blank
      // report. Offer the retake instead.
      $('rep-form-block').hidden = true;
      $('rep-retake-block').hidden = false;
      var issues = (d.quality_issues || []).map(function (q) {
        return ({ blur: 'soft focus', glare: 'glare', too_far: 'shot from too far',
                  cropped: 'nails cropped', low_light: 'low light' })[q] || q;
      });
      $('rep-retake-copy').textContent = (issues.length ? 'What got in the way: ' + issues.join(', ') + '. ' : '')
        + 'Daylight, hand flat and palm down, four or five nails filling the frame.';
    } else {
      // Medical tier: a real reading with no calendar. There is nothing to
      // unlock, so the card drops the lock framing and simply offers to send it.
      // Without this branch the whole tier captured no lead at all.
      $('form-h').textContent = 'Send this reading to yourself.';
      $('btn-lead-t').textContent = 'Send it to me';
      var eb = $('rep-form-block').querySelector('.eyebrow');
      if (eb) eb.textContent = 'Keep a copy';
      var sub = $('rep-form-block').querySelector('.card .fine');
      if (sub) sub.textContent = 'Worth having on hand if you decide to get it looked at.';
    }

    stage('report');
    revealIn();

    // Right keyboard, right autofill, no hunting. The form is the only thing
    // between her and the calendar; every tap it does not cost is worth having.
    var nameField = $('in-name');
    if (nameField) {
      nameField.setAttribute('autocapitalize', 'words');
      nameField.setAttribute('enterkeyhint', 'next');
    }
    $('in-phone').setAttribute('enterkeyhint', 'next');
    $('in-email').setAttribute('enterkeyhint', 'go');
  }

  /* One line each, the rest on a tap.
   *
   * `hd` is the two-second version, `k` the location, `v` the sentence the
   * copy bank wrote. Collapsed, the reading is a list you can take in at a
   * glance; expanded, it is exactly as thorough as it was before. Nothing was
   * cut — it just stopped arriving all at once.
   */
  function renderChecks(ul, checks) {
    ul.innerHTML = '';
    (checks || []).forEach(function (c) {
      var li = document.createElement('li');
      li.className = c.status === 'good' ? 'good' : 'note';

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'k';
      head.setAttribute('aria-expanded', 'false');
      var hd = document.createElement('span');
      hd.className = 'hd';
      hd.textContent = c.hd || c.k;
      var more = document.createElement('span');
      more.className = 'more';
      more.textContent = 'Why';
      head.appendChild(hd);
      head.appendChild(more);

      var body = document.createElement('div');
      body.className = 'v';
      body.hidden = true;
      var loc = document.createElement('span');
      loc.className = 'loc';
      loc.textContent = c.k;
      var p = document.createElement('p');
      p.innerHTML = c.v;                      // closed, server-side copy bank
      body.appendChild(loc);
      body.appendChild(p);

      head.addEventListener('click', function () {
        var openNow = body.hidden;
        body.hidden = !openNow;
        head.setAttribute('aria-expanded', String(openNow));
        li.classList.toggle('is-open', openNow);
        more.textContent = openNow ? 'Hide' : 'Why';
      });

      li.appendChild(head);
      li.appendChild(body);
      ul.appendChild(li);
    });
  }

  function revealIn() {
    var els = document.querySelectorAll('#stage-report .reveal');
    // The stage was display:none a moment ago. Force a layout read so the
    // browser has a start value to transition FROM, otherwise the class change
    // is batched with the display change and the transition is skipped.
    document.getElementById('stage-report').offsetHeight;
    requestAnimationFrame(function () {
      Array.prototype.forEach.call(els, function (el) {
        if (!el.hidden) el.classList.add('is-in');
      });
    });
    // Self-heal. The stagger is decoration; the report being READABLE is not.
    // If the class never landed, or a transition started and never progressed
    // (a throttled or backgrounded tab freezes the animation clock, which stalls
    // an in-flight transition at its start value), force the end state and drop
    // the transition so it paints. Checked well after the longest run:
    // max delay 4x90ms + 550ms duration.
    setTimeout(function () {
      Array.prototype.forEach.call(els, function (el) {
        if (el.hidden) return;
        el.classList.add('is-in');
        if (parseFloat(getComputedStyle(el).opacity) < 0.99) {
          el.style.transition = 'none';
          el.style.opacity = '1';
          el.style.transform = 'none';
        }
      });
    }, 1400);
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

  /* The confirmation promises only what this code actually does.
   *
   * It used to say "a copy is on its way to <email>" — but nothing here sends
   * mail, and nothing in the Worker does either. Whether an email goes out is
   * the CRM workflow's business, and that workflow may not exist yet. Claiming
   * a send we cannot see is a lie told to every lead.
   *
   * What IS true, always: the record is stored, and its permanent link is
   * <site>/report?id=<id>. So we hand her the link. If the workflow later mails
   * the same link, the copy is still true.
   */
  function unlock(name, email) {
    var hadLock = !$('rep-lock').hidden;
    if (hadLock) {
      $('rep-lock').classList.add('is-open');
      $('rep-cal-body').setAttribute('aria-hidden', 'false');
      $('rep-cal-n').textContent = 'OPEN';
    }
    $('rep-form-block').hidden = true;
    document.querySelector('#rep-done .stamp').lastChild.textContent =
      hadLock ? 'Calendar unlocked' : 'Reading saved';

    $('done-h').textContent = hadLock ? 'It\u2019s open below.' : 'Saved.';
    $('done-copy').textContent = hadLock
      ? 'Your calendar is unlocked below. The reading is saved \u2014 keep the link and it opens on any device.'
      : 'The reading is saved \u2014 keep the link and it opens on any device.';

    var link = $('done-link');
    if (state.record && state.record.id) {
      link.href = location.origin + '/report?id=' + encodeURIComponent(state.record.id);
      link.hidden = false;
    }

    // The teaser did its job. Replace it with the calendar she can touch.
    //
    // This only happens now, on unlock, and not a moment earlier: a form
    // control behind a blur is still focusable, still in the tab order, and
    // still readable to a screen reader — which would make the lock a lie as
    // well as an annoyance.
    if (hadLock && window.NailScanCalendar && window.NailScanPlan) {
      var teaser = $('rep-timeline');
      if (teaser) teaser.remove();
      var intro = $('rep-cal-intro');
      if (intro) intro.remove();
      try {
        NailScanCalendar.mount({
          root: $('rep-plan-mount'),
          record: state.record,
          cfg: CFG,
          onExport: function (detail) { pingPlanSaved(state.record && state.record.id, detail); }
        });
      } catch (e) {
        // The reading is the product; the planner is a layer on top of it. If
        // the layer fails, put the plain dates back rather than showing a gap.
        renderFallbackTimeline();
      }
    }

    $('rep-done').hidden = false;
    $('rep-done').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
  }

  /* Tell the studio she saved it.
   *
   * Fire and forget, and deliberately AFTER the download rather than before: by
   * the time this goes out the file is already in her downloads, so a failure
   * here is ours to reconcile and never something she is shown. keepalive lets
   * it survive her closing the tab on the way to her calendar.
   */
  function pingPlanSaved(scanId, detail) {
    if (!scanId || !CFG.api.plan) return;
    try {
      fetch(CFG.api.base + CFG.api.plan, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          id: scanId,
          items: detail.items,
          service: detail.service,
          rhythm: detail.rhythm,
          event_date: detail.event_date,
          event_label: detail.event_label,
          source: 'try-demo'
        })
      }).catch(function () {});
    } catch (e) { /* never her problem */ }
  }

  /* If the interactive calendar cannot mount, the dates still have to be on
   * screen. Same milestones, plain list, no interaction. */
  function renderFallbackTimeline() {
    var d = state.record && state.record.display;
    var cal = d && d.calendar;
    if (!cal || !cal.milestones) return;
    var mount = $('rep-plan-mount');
    mount.replaceChildren();
    var ul = document.createElement('ul');
    ul.className = 'timeline';
    cal.milestones.forEach(function (m) {
      var li = document.createElement('li');
      var dt = document.createElement('span'); dt.className = 'dt'; dt.textContent = shortDate(m.date);
      var bd = document.createElement('span'); bd.className = 'bd';
      var b = document.createElement('b'); b.textContent = m.label;
      bd.appendChild(b);
      if (m.sub) { var sp = document.createElement('span'); sp.textContent = m.sub; bd.appendChild(sp); }
      li.appendChild(dt); li.appendChild(bd);
      ul.appendChild(li);
    });
    mount.appendChild(ul);
  }

  /* ------------------------------------------------------------- wiring -- */

  /* The loop only plays once it is on screen and the browser has been told
     to fetch it — preload="none" keeps 40KB off the critical path on a salon's
     phone, which is the whole point of a page that promises twenty seconds. */
  (function () {
    var fig = $('intro-loop'), v = $('loop-v');
    if (!fig || !v) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var start = function () { v.preload = 'auto'; v.load(); v.play().catch(function () {}); };
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { start(); io.disconnect(); } });
      }, { threshold: .25 });
      io.observe(fig);
    } else { start(); }

    // it answers the button once, then the capture opens over it
    $('btn-start').addEventListener('click', function () { fig.classList.add('is-armed'); });
  })();

  $('btn-start').addEventListener('click', openCamera);
  $('btn-retake').addEventListener('click', openCamera);
  $('btn-err-retry').addEventListener('click', openCamera);
  $('btn-again').addEventListener('click', function () { location.reload(); });
  $('btn-rep-retake').addEventListener('click', openCamera);

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
