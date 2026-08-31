/* ═══════════════════════════════════════════════════════════════════════════
   PORTAL — where a new salon becomes a deployable build
   ═══════════════════════════════════════════════════════════════════════════

   Internal. This is not a salon's screen; it is ours, and it exists so that
   onboarding a customer is typing rather than editing source. Type their
   details, watch their scanner re-render beside the form, press one button
   and get a folder you drag onto Cloudflare Pages.

   The whole build happens IN THIS BROWSER. The portal fetches its own site's
   files from its own origin, swaps exactly one of them — tenant.js — and
   writes the ZIP locally. That means:

     · no build server to run, pay for, or have go down mid-call
     · no upload of a customer's logo to anything
     · the output is provably the same code this page is running, because it
       is literally the same files

   The one-file substitution is the point. If a white-label build differed
   from the demo by twelve patched files, "white label" would be a promise
   about a process. Differing by one file it is a promise you can verify with
   `diff`.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var el = function (s, r) { return (r || document).querySelector(s); };
  var els = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ── The aperture mark, same construction as the scanner's ───────────── */

  (function aperture() {
    var g = el('[data-blades]');
    if (!g) return;
    var N = 5, cx = 100, cy = 100, rOut = 76, rIn = 44, twist = 30 * Math.PI / 180, gap = 0.085;
    var frag = '';
    for (var i = 0; i < N; i++) {
      var a0 = (i / N) * Math.PI * 2 + gap, a1 = ((i + 1) / N) * Math.PI * 2 - gap;
      var p = function (r, a) { return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
      var o0 = p(rOut, a0), o1 = p(rOut, a1), i1 = p(rIn, a1 + twist), i0 = p(rIn, a0 + twist);
      frag += '<path d="M' + o0[0].toFixed(1) + ' ' + o0[1].toFixed(1) +
        'A' + rOut + ' ' + rOut + ' 0 0 1 ' + o1[0].toFixed(1) + ' ' + o1[1].toFixed(1) +
        'L' + i1[0].toFixed(1) + ' ' + i1[1].toFixed(1) +
        'A' + rIn + ' ' + rIn + ' 0 0 0 ' + i0[0].toFixed(1) + ' ' + i0[1].toFixed(1) + 'Z"/>';
    }
    g.innerHTML = frag;
  }());

  /* ── State ────────────────────────────────────────────────────────────── */

  var REF = Brand.SALONS.demo;          // the reference tenant, used for defaults

  var t = {
    id: '', name: '', short: '', monogram: '', logo: null,
    font: 'default', fontData: null, fontName: null,
    accent: '#FF5233', city: '', phone: '', address: '', site: '',
    bookingUrl: '', currency: '$',
    services: JSON.parse(JSON.stringify(REF.services))
  };

  function slug(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  }

  // What actually ships, with every blank filled the way brand.js would fill
  // it. Computed rather than stored so the preview and the download can never
  // disagree about what a blank field means.
  function resolved() {
    var name = t.name.trim() || REF.name;
    var short = t.short.trim() || name.split(/[\s—-]+/)[0];
    return {
      id: slug(t.id) || slug(name) || 'salon',
      name: name,
      short: short,
      monogram: (t.monogram.trim() || short.charAt(0)).toUpperCase().slice(0, 2),
      logo: t.logo,
      font: t.font, fontData: t.fontData, fontName: t.fontName,
      accent: t.accent,
      city: t.city.trim(), phone: t.phone.trim(), address: t.address.trim(),
      site: t.site.trim(), bookingUrl: t.bookingUrl.trim() || '#book',
      currency: t.currency.trim() || '$',
      services: t.services
    };
  }

  /* ── Fields ───────────────────────────────────────────────────────────── */

  var idTouched = false;

  els('[data-f]').forEach(function (input) {
    var key = input.getAttribute('data-f');
    input.value = t[key] == null ? '' : t[key];
    input.addEventListener('input', function () {
      t[key] = input.value;
      if (key === 'id') idTouched = input.value.trim() !== '';
      // The tenant id follows the salon name until someone edits it by hand,
      // and then it stops following — a slug that keeps rewriting itself under
      // an operator who deliberately set it is worse than no help at all.
      if (key === 'name' && !idTouched) {
        t.id = slug(input.value);
        el('[data-f="id"]').value = t.id;
      }
      if (key === 'accent') { el('[data-hex]').value = input.value.toUpperCase(); }
      sync();
    });
  });

  el('[data-hex]').addEventListener('input', function (e) {
    var v = e.target.value.trim();
    if (!/^#?[0-9a-fA-F]{6}$/.test(v)) { e.target.classList.add('bad'); return; }
    e.target.classList.remove('bad');
    t.accent = v[0] === '#' ? v : '#' + v;
    el('[data-f="accent"]').value = t.accent;
    sync();
  });

  /* ── Services ─────────────────────────────────────────────────────────── */

  function renderServices() {
    el('[data-services]').innerHTML = Brand.SERVICE_KEYS.map(function (k) {
      var v = t.services[k];
      return '<div class="svc">' +
        '<div class="svc-k">' + k + '</div>' +
        '<div class="svc-f">' +
          '<label><span>Name</span>' +
            '<input type="text" data-svc="' + k + '" data-p="name" value="' + esc(v.name) + '"></label>' +
          '<label><span>Price</span>' +
            '<input type="number" min="0" step="1" data-svc="' + k + '" data-p="price" value="' + v.price + '"></label>' +
          '<label><span>Minutes</span>' +
            '<input type="number" min="5" step="5" data-svc="' + k + '" data-p="minutes" value="' + v.minutes + '"></label>' +
          '<label><span>Rebook, weeks</span>' +
            '<input type="number" min="1" max="12" step="1" data-svc="' + k + '" data-p="rebook" value="' + v.rebook + '"></label>' +
        '</div></div>';
    }).join('');

    els('[data-svc]').forEach(function (input) {
      input.addEventListener('input', function () {
        var k = input.getAttribute('data-svc'), p = input.getAttribute('data-p');
        t.services[k][p] = p === 'name' ? input.value : Number(input.value);
        sync();
      });
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  /* ── Fonts ────────────────────────────────────────────────────────────── */

  function renderFonts() {
    var keys = Object.keys(Brand.FONTS);
    el('[data-fonts]').innerHTML = keys.map(function (k) {
      var f = Brand.FONTS[k];
      return '<button type="button" class="fontopt" data-font="' + k + '" ' +
        'aria-pressed="' + (t.font === k) + '">' +
        '<span class="fo-n">' + f.label + '</span>' +
        '<span class="fo-p" style="font-family:' + f.display.replace(/"/g, "'") + '">Aa</span></button>';
    }).join('') +
    (t.fontData
      ? '<button type="button" class="fontopt" data-font="custom" aria-pressed="' + (t.font === 'custom') + '">' +
        '<span class="fo-n">' + esc(t.fontName || 'Their font') + '</span>' +
        '<span class="fo-p" style="font-family:PortalFont">Aa</span></button>'
      : '');

    els('[data-font]').forEach(function (b) {
      b.addEventListener('click', function () {
        t.font = b.getAttribute('data-font');
        renderFonts(); sync();
      });
    });
  }

  /* ── Uploads ──────────────────────────────────────────────────────────── */

  function readAsDataUrl(file, limitKb, cb) {
    if (file.size > limitKb * 1024) {
      warn(file.name + ' is ' + Math.round(file.size / 1024) + ' KB — over the ' + limitKb + ' KB limit.');
      return;
    }
    var fr = new FileReader();
    fr.onload = function () { cb(fr.result); };
    fr.readAsDataURL(file);
  }

  function wireDrop(zoneSel, inputSel, handler) {
    var zone = el(zoneSel), input = el(inputSel);
    if (!zone || !input) return;
    input.addEventListener('change', function () { if (input.files[0]) handler(input.files[0]); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) handler(f);
    });
  }

  wireDrop('[data-logo-zone]', '[data-logo-input]', function (file) {
    // Data URLs, not object URLs. An object URL dies with the document that
    // created it, and this one has to survive being written into a file and
    // opened on someone else's machine next week.
    readAsDataUrl(file, 512, function (url) {
      t.logo = url;
      paintLogo(); sync();
    });
  });

  el('[data-logo-clear]').addEventListener('click', function () {
    t.logo = null; el('[data-logo-input]').value = ''; paintLogo(); sync();
  });

  function paintLogo() {
    el('[data-logo-prev]').innerHTML = t.logo ? '<img src="' + t.logo + '" alt="">' : '';
    el('[data-logo-t]').textContent = t.logo ? 'Logo set — drop another to replace it'
                                             : 'Drop a logo, or click to choose';
    el('[data-logo-clear]').hidden = !t.logo;
  }

  wireDrop('[data-font-zone]', '[data-font-input]', function (file) {
    readAsDataUrl(file, 1024, function (url) {
      t.fontData = url;
      t.fontName = file.name.replace(/\.[^.]+$/, '');
      t.font = 'custom';
      // Register it in THIS document too, so the option button can preview it.
      var tag = el('#portal-font') || (function () {
        var s = document.createElement('style'); s.id = 'portal-font';
        document.head.appendChild(s); return s;
      }());
      tag.textContent = '@font-face{font-family:"PortalFont";src:url(' + url + ');font-display:swap;}';
      el('[data-font-t]').textContent = t.fontName + ' loaded';
      renderFonts(); sync();
    });
  });

  /* ── Contrast note ────────────────────────────────────────────────────── */

  function lum(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }).reduce(function (a, v, i) { return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }

  function paintContrast() {
    var L = lum(t.accent);
    var onWhite = (Math.max(L, 1) + 0.05) / (Math.min(L, 1) + 0.05);
    var onBlack = (Math.max(L, 0.0074) + 0.05) / (Math.min(L, 0.0074) + 0.05);
    var dark = onBlack >= onWhite;
    var ratio = Math.max(onWhite, onBlack);
    var node = el('[data-contrast]');
    node.textContent = (dark ? 'dark' : 'white') + ' label · ' + ratio.toFixed(1) + ':1';
    node.className = 'pill ' + (ratio >= 4.5 ? 'ok' : 'warn');
  }

  /* ── Preview ──────────────────────────────────────────────────────────── */

  var previewScreen = 'intro';

  els('[data-prev-screen]').forEach(function (b) {
    b.addEventListener('click', function () {
      previewScreen = b.getAttribute('data-prev-screen');
      els('[data-prev-screen]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', 'true');
      var f = el('[data-preview]');
      if (previewScreen === 'console') {
        el('[data-phone]').classList.add('wide');
        f.src = '../app/index.html';
      } else {
        el('[data-phone]').classList.remove('wide');
        f.src = '../scan/index.html?demo=0' + (previewScreen === 'report' ? '&returning=6' : '');
      }
    });
  });

  el('[data-preview]').addEventListener('load', function () {
    pushBrand();
    if (previewScreen === 'report') runPreviewScan();
  });

  /* The iframe is parsed before this script runs, so on a fast connection it
     can finish loading before the listener above exists and the load event is
     simply missed — the preview then sits on the demo brand forever. Poll
     until its Brand is reachable, then push once. */
  (function catchUp(tries) {
    var f = el('[data-preview]');
    var ready = false;
    try { ready = !!(f.contentWindow && f.contentWindow.Brand); } catch (e) { ready = false; }
    if (ready) return pushBrand();
    if (tries > 0) setTimeout(function () { catchUp(tries - 1); }, 120);
  }(40));

  /* Drive the real scanner through a real scan so the operator can show the
     report. Automating the actual buttons rather than faking a screen means
     the preview cannot drift from the product. */
  function runPreviewScan() {
    var w = el('[data-preview]').contentWindow;
    var d = w && w.document;
    if (!d) return;
    var step = function (sel, delay) {
      setTimeout(function () { var n = d.querySelector(sel); if (n) n.click(); }, delay);
    };
    step('[data-go="capture"]', 300);
    step('[data-use-sample]', 900);
    step('[data-shutter]', 2200);
  }

  /* Same idea as the console's live preview: the iframe is same-origin, so
     the brand is pushed into its document instead of reloading it. A reload
     on every keystroke would drop the preview back to the intro screen and
     make the report tab useless. */
  function pushBrand() {
    var f = el('[data-preview]');
    var s = resolved();
    try {
      var w = f.contentWindow;
      if (!w || !w.Brand) return;
      w.Brand.adopt(s);
      w.Brand.apply(w.Brand.SALONS[s.id], w.document);
      var d = w.document;
      Array.prototype.forEach.call(d.querySelectorAll('[data-brand-name]'), function (n) {
        n.textContent = s.name;
      });
      Array.prototype.forEach.call(d.querySelectorAll('[data-brand-monogram]'), function (n) {
        w.Brand.paintMark(n, w.Brand.SALONS[s.id]);
      });
      // Anything already rendered from the old brand — a report on screen —
      // re-renders through the same event the tenant switcher uses.
      d.dispatchEvent(new w.CustomEvent('brandchange', { detail: w.Brand.SALONS[s.id] }));
    } catch (e) { /* preview not ready yet; the next keystroke covers it */ }
  }

  /* ── Sync ─────────────────────────────────────────────────────────────── */

  var syncTimer = null;

  function sync() {
    paintContrast();
    validate();
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushBrand, 90);   // one repaint per burst of typing
  }

  /* ── Validation ───────────────────────────────────────────────────────── */

  function issues() {
    var s = resolved(), out = [];
    if (!t.name.trim()) out.push('Salon name is empty — the build would ship as “' + REF.name + '”.');
    if (!/^[a-z0-9-]+$/.test(s.id)) out.push('Tenant ID must be lowercase letters, numbers and hyphens.');
    if (!t.phone.trim()) out.push('No phone number. The report tells her to call the salon and would have nothing to show.');
    if (!/^#[0-9a-fA-F]{6}$/.test(t.accent)) out.push('Brand colour is not a valid hex.');
    Brand.SERVICE_KEYS.forEach(function (k) {
      var v = s.services[k];
      if (!String(v.name).trim()) out.push('Service “' + k + '” has no name.');
      if (!(Number(v.price) >= 0)) out.push('Service “' + k + '” has no price.');
      if (!(Number(v.minutes) > 0)) out.push('Service “' + k + '” has no length.');
      if (!(Number(v.rebook) > 0)) out.push('Service “' + k + '” has no rebook interval.');
    });
    return out;
  }

  function validate() {
    var list = issues();
    var box = el('[data-issues]');
    box.hidden = !list.length;
    box.innerHTML = list.length
      ? '<div class="pi-h">' + list.length + ' thing' + (list.length > 1 ? 's' : '') +
        ' to fix before this ships</div><ul>' +
        list.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'
      : '';
    // Deliberately NOT disabled. An operator building a preview for a call
    // does not have the salon's phone number yet, and a dead button with no
    // explanation is worse than a warning she can read and overrule.
    el('[data-build-state]').textContent = list.length
      ? list.length + ' warning' + (list.length > 1 ? 's' : '')
      : 'Ready to build';
    el('[data-build-state]').className = 'pill ' + (list.length ? 'warn' : 'ok');
    el('[data-build-label]').textContent = 'Download ' + resolved().name;
  }

  function warn(msg) {
    var box = el('[data-issues]');
    box.hidden = false;
    box.innerHTML = '<div class="pi-h">' + msg + '</div>';
  }

  /* ── The generated tenant file ────────────────────────────────────────── */

  function tenantFile() {
    var s = resolved();
    var payload = {
      id: s.id, name: s.name, short: s.short, monogram: s.monogram,
      logo: s.logo, font: s.font, fontData: s.fontData, fontName: s.fontName,
      accent: s.accent, city: s.city, phone: s.phone, address: s.address,
      site: s.site, bookingUrl: s.bookingUrl, currency: s.currency,
      services: Brand.SERVICE_KEYS.reduce(function (a, k) {
        var v = s.services[k];
        a[k] = { name: String(v.name), price: Number(v.price),
                 minutes: Number(v.minutes), rebook: Number(v.rebook) };
        return a;
      }, {})
    };
    return '/* ' + s.name + ' — generated by NailScan provisioning.\n' +
      '   This is the ONLY file that differs from the reference build. Replace it to\n' +
      '   rebrand; delete it and the deployment falls back to the demo tenant. */\n\n' +
      'window.NS_TENANT = ' + JSON.stringify(payload, null, 2) + ';\n';
  }

  /* ── The build ────────────────────────────────────────────────────────── */

  /* Everything a salon deployment needs and nothing it does not. The
     marketing site is ours and is deliberately absent — a salon's domain
     serves their scanner and their console, not our sales pages. */
  var MANIFEST = [
    'scan/index.html',
    'app/index.html',
    'assets/app/app.css',
    'assets/app/scanner.css',
    'assets/app/dashboard.css',
    'assets/app/brand.js',
    'assets/app/data.js',
    'assets/app/vision.js',
    'assets/app/report.js',
    'assets/app/scanner.js',
    'assets/app/charts.js',
    'assets/app/dashboard.js',
    'assets/app/img/specimen.jpg',
    'assets/fonts/geist-var.woff2',
    'assets/fonts/geist-mono-var.woff2',
    'assets/fonts/instrument-serif.woff2',
    'favicon.svg'
  ];

  var BASE = location.pathname.replace(/portal\/[^/]*$/, '');

  function log(msg, cls) {
    var box = el('[data-log]');
    box.hidden = false;
    box.insertAdjacentHTML('beforeend', '<div class="' + (cls || '') + '">' + msg + '</div>');
    box.scrollTop = box.scrollHeight;
  }

  function fetchBytes(path) {
    return fetch(BASE + path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' → ' + r.status);
      return r.arrayBuffer().then(function (buf) {
        return { name: path, data: new Uint8Array(buf) };
      });
    });
  }

  el('[data-build-config]').addEventListener('click', function () {
    var s = resolved();
    Zip.save(new Blob([tenantFile()], { type: 'application/javascript' }), s.id + '-tenant.js');
  });

  el('[data-build-site]').addEventListener('click', function () {
    var btn = el('[data-build-site]');
    if (btn.disabled) return;
    btn.disabled = true;
    var s = resolved();
    el('[data-log]').innerHTML = '';
    log('Collecting ' + MANIFEST.length + ' files…');

    Promise.all(MANIFEST.map(fetchBytes)).then(function (files) {
      log('Writing ' + s.id + '-tenant.js…');
      files.push({ name: 'assets/app/tenant.js', data: tenantFile() });
      files.push({ name: 'index.html', data: rootRedirect(s) });
      files.push({ name: '_headers', data: HEADERS });
      files.push({ name: 'READ-ME-FIRST.txt', data: readme(s) });

      var bytes = files.reduce(function (a, f) {
        return a + (typeof f.data === 'string' ? f.data.length : f.data.length);
      }, 0);
      log('Packing ' + files.length + ' files, ' + Math.round(bytes / 1024) + ' KB…');

      var blob = Zip.build(files);
      Zip.save(blob, s.id + '-nailscan.zip');
      log('Done — ' + s.id + '-nailscan.zip, ' + Math.round(blob.size / 1024) + ' KB. ' +
          'Drag the unzipped folder onto Cloudflare Pages.', 'ok');
      btn.disabled = false;
    }).catch(function (e) {
      log('Build failed: ' + e.message, 'bad');
      log('Every file is fetched from this same site, so a failure here is almost ' +
          'always a stale cache. Hard-reload and try again.', '');
      btn.disabled = false;
    });
  });

  /* A salon's domain root has to land somewhere. Sending it to the scanner is
     the only sensible answer — it is the thing their customers are given the
     link to. */
  function rootRedirect(s) {
    return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
      '<meta http-equiv="refresh" content="0; url=./scan/">\n' +
      '<title>' + esc(s.name) + '</title>\n<meta name="robots" content="noindex">\n' +
      '<link rel="canonical" href="./scan/">\n</head>\n<body>\n' +
      '<p>Taking you to the nail assessment. <a href="./scan/">Continue</a>.</p>\n' +
      '</body>\n</html>\n';
  }

  var HEADERS =
    '# The console is the salon\'s, not the public\'s. This keeps it out of\n' +
    '# search results; put real authentication in front of it before launch.\n' +
    '/app/*\n  X-Robots-Tag: noindex, nofollow\n\n' +
    '/assets/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n\n' +
    '/assets/app/*\n  Cache-Control: public, max-age=600\n';

  function readme(s) {
    return [
      s.name + ' — NailScan build',
      '='.repeat((s.name + ' — NailScan build').length),
      '',
      'Generated by NailScan provisioning. Everything in this folder is static:',
      'no server, no database, no build step.',
      '',
      'TO DEPLOY',
      '  1. Unzip this folder.',
      '  2. Cloudflare Pages → Create a project → Upload assets.',
      '  3. Drag the folder in and deploy.',
      '  4. Point ' + (s.site || 'the salon domain') + ' at it.',
      '',
      'WHAT IS WHERE',
      '  /scan/               the client-facing scanner and report',
      '  /app/                the salon console',
      '  /assets/app/tenant.js  their branding — the ONLY file that differs',
      '                         from the reference build',
      '',
      'TO REBRAND LATER',
      '  Regenerate tenant.js in the portal and replace that one file.',
      '  Nothing else needs to change.',
      '',
      'BEFORE LAUNCH',
      '  · Put authentication in front of /app/. The _headers file keeps it out',
      '    of search results, which is not the same as keeping people out.',
      '  · Point the booking button at their real booking system.',
      '    Currently: ' + (s.bookingUrl || '#book'),
      '  · Confirm the phone number on the report: ' + (s.phone || 'NOT SET'),
      '',
      'Tenant ID: ' + s.id,
      ''
    ].join('\n');
  }

  /* ── Boot ─────────────────────────────────────────────────────────────── */

  renderServices();
  renderFonts();
  paintLogo();
  sync();
}());
