/* NailScan — shared behaviour
   Nav, scroll reveal, counters, hero scan loop, demo form. */

(function () {
  'use strict';

  /* =====================================================================
     CONFIG — set this before you send traffic.
     Leave it empty and the form falls back to opening the visitor's mail
     client with the details pre-filled. It will never claim to have sent
     something it did not send.
     ===================================================================== */
  var FORM_ENDPOINT = '';                    // e.g. 'https://nailscan.ai/api/demo-request'
  var FALLBACK_EMAIL = 'hello@nailscan.ai';

  /* ---- helpers ---- */
  function el(sel, root) { return (root || document).querySelector(sel); }
  function els(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---- Mobile nav ---- */
  var burger = el('.burger');
  var nav = el('.nav');
  if (burger && nav) {
    burger.setAttribute('aria-controls', 'nav');
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var first = el('a', nav); if (first) first.focus(); }
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        nav.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        burger.focus();
      }
    });
  }

  /* ---- Reveal on scroll ----
     The `js` class is added by an inline head script, so content is visible
     when JS is absent. If IntersectionObserver is missing, reveal everything. */
  var revealables = els('.rv');
  if ('IntersectionObserver' in window && revealables.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var node = entry.target;
        var delay = parseInt(node.getAttribute('data-d') || '0', 10);
        setTimeout(function () { node.classList.add('in'); }, delay);
        io.unobserve(node);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    revealables.forEach(function (node) { io.observe(node); });
    // Safety net: if anything is still hidden after 3s, show it.
    setTimeout(function () { revealables.forEach(function (n) { n.classList.add('in'); }); }, 3000);
  } else {
    revealables.forEach(function (node) { node.classList.add('in'); });
  }

  /* ---- Count up ---- */
  var counters = els('[data-count]');
  if ('IntersectionObserver' in window && counters.length) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var node = entry.target;
        cio.unobserve(node);
        var target = parseFloat(node.getAttribute('data-count'));
        var suffix = node.getAttribute('data-suffix') || '';
        var prefix = node.getAttribute('data-prefix') || '';
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var dur = 1100, t0 = null;
        function tick(ts) {
          if (!t0) t0 = ts;
          var prog = Math.min((ts - t0) / dur, 1);
          var eased = 1 - Math.pow(1 - prog, 3);
          var val = target * eased;
          node.textContent = prefix + (target % 1 === 0 ? Math.round(val).toLocaleString('en-US') : val.toFixed(1)) + suffix;
          if (prog < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.4 });
    counters.forEach(function (node) { cio.observe(node); });
  }

  /* ---- Hero scanner readout loop ----
     Pauses when scrolled out of view and when the tab is hidden. */
  var stage = el('[data-scanloop]');
  if (stage) {
    var SETS = [
      [
        ['surface',    'Smooth plate, even right through the free edge',        'ready',    'ok'],
        ['color',      'Uniform pink bed, clear natural tone',                  'ready',    'ok'],
        ['structure',  'Even thickness, strong side walls',                     'ready',    'ok'],
        ['cuticle',    'Eponychium intact, ready for conditioning',             'ready',    'ok'],
        ['recommended','Full gel set · $95',                                    'quoted',   'ok']
      ],
      [
        ['surface',    'Texture across 3 of 5 plates',               'prep first','warn'],
        ['color',      'Warm tone in the outer third, both hands',   'prep first','warn'],
        ['structure',  'Side walls want reseating',                  'prep first','warn'],
        ['cuticle',    'Healthy, no work needed',                    'ready',     'ok'],
        ['recommended','Strengthening prep + new set · $140',        'quoted',    'ok']
      ],
      [
        ['surface',    'Smooth plate, prior gel wear cleared',       'ready',    'ok'],
        ['color',      'Uniform, holds colour beautifully',          'ready',    'ok'],
        ['structure',  'Thinner plate — builder gel suits it',       'prep first','warn'],
        ['cuticle',    'Well maintained',                            'ready',    'ok'],
        ['recommended','Builder gel overlay · $110',                 'quoted',   'ok']
      ]
    ];
    var rows = els('.fieldrow', stage);
    var idx = 0, timer = null, visible = true;

    function paint() {
      var set = SETS[idx % SETS.length];
      rows.forEach(function (row, i) {
        if (!set[i]) return;
        var fk = el('.fk', row), fv = el('.fv', row), fs = el('.fs', row);
        row.style.opacity = '0.25';
        setTimeout(function () {
          if (fk) fk.textContent = set[i][0];
          if (fv) fv.textContent = set[i][1];
          if (fs) { fs.textContent = set[i][2]; fs.className = 'fs ' + set[i][3]; }
          row.style.transition = 'opacity .45s ease';
          row.style.opacity = '1';
        }, 120 + i * 90);
      });
      idx++;
    }
    function start() { if (!timer && visible) { timer = setInterval(paint, 5200); } }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    paint();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        visible ? start() : stop();
      }, { threshold: 0.1 }).observe(stage);
    } else { start(); }
    document.addEventListener('visibilitychange', function () {
      document.hidden ? stop() : start();
    });
  }

  /* =====================================================================
     Demo form — validates, submits, and tells the truth about the outcome.
     ===================================================================== */
  var form = el('[data-demoform]');
  if (form) {
    var out = el('[data-formmsg]', form);
    var btn = el('button[type="submit"]', form);

    function setMsg(text, kind) {
      if (!out) return;
      out.hidden = false;
      out.textContent = text;
      out.className = 'formmsg ' + (kind || '');
    }
    function clearErrors() {
      els('.field', form).forEach(function (f) {
        f.classList.remove('err');
        var m = el('.errmsg', f);
        if (m) m.remove();
        var input = el('input, select, textarea', f);
        if (input) input.removeAttribute('aria-invalid');
      });
    }
    function fail(field, message) {
      var wrap = field.closest('.field');
      wrap.classList.add('err');
      field.setAttribute('aria-invalid', 'true');
      var m = document.createElement('span');
      m.className = 'errmsg';
      m.textContent = message;
      wrap.appendChild(m);
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErrors();

      var name = el('#fname', form);
      var salon = el('#fsalon', form);
      var email = el('#femail', form);
      var bad = [];

      if (!name.value.trim())  { fail(name,  'Please enter your name.'); bad.push(name); }
      if (!salon.value.trim()) { fail(salon, 'Please enter your business name.'); bad.push(salon); }
      if (!email.value.trim()) { fail(email, 'Please enter your email.'); bad.push(email); }
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) {
        fail(email, 'That email address does not look right.'); bad.push(email);
      }

      if (bad.length) {
        setMsg('Please correct the ' + bad.length + (bad.length === 1 ? ' field' : ' fields') + ' marked below.', 'err');
        bad[0].focus();
        return;
      }

      var data = {};
      els('input, select, textarea', form).forEach(function (i) {
        if (i.name) data[i.name] = i.value.trim();
      });
      data.page = location.pathname;
      data.referrer = document.referrer || '';

      var label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

      function done(msg, kind) {
        if (btn) { btn.disabled = false; btn.textContent = label; }
        setMsg(msg, kind);
      }

      if (!FORM_ENDPOINT) {
        // No endpoint configured. Do not pretend. Hand off to email instead.
        var subject = encodeURIComponent('Demo request — ' + data.salon);
        var body = encodeURIComponent(
          Object.keys(data).map(function (k) { return k + ': ' + data[k]; }).join('\n')
        );
        window.location.href = 'mailto:' + FALLBACK_EMAIL + '?subject=' + subject + '&body=' + body;
        done('Your email app should now be open with these details filled in — press send and we will reply within one business day. If nothing opened, email ' + FALLBACK_EMAIL + ' directly.', 'warn');
        return;
      }

      fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        form.reset();
        done('Received. We will reply to ' + data.email + ' within one business day.', 'ok');
      }).catch(function () {
        done('That did not go through — please email ' + FALLBACK_EMAIL + ' and we will pick it up from there. Nothing was lost on your end.', 'err');
      });
    });
  }

  /* ---- Year ---- */
  els('[data-year]').forEach(function (node) { node.textContent = new Date().getFullYear(); });

  /* ---- Reveal failsafe -------------------------------------------------
     `.js body { opacity: 0 }` in site.css is undone by `.js.ready`, which
     cinema.js normally adds on load. whitepaper.html shipped without
     cinema.js and was therefore invisible in any browser with JS enabled.
     site.js is on every page, so the guarantee belongs here: if nothing has
     added `.ready` shortly after load, add it. Harmless when cinema.js has
     already done so. Do not remove this because "cinema.js handles it". */
  (function () {
    var root = document.documentElement;
    function ready() { root.classList.add('ready'); }
    if (document.readyState === 'complete') setTimeout(ready, 40);
    else window.addEventListener('load', function () { setTimeout(ready, 120); });
    setTimeout(ready, 1800);
  })();
})();
