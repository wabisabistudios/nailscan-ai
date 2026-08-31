/* NailScan — cinematic layer
   One idea: the page is a scan. A beam travels with your scroll and reveals
   what it passes over. Everything here serves that and nothing else.

   Dependency-free. ~9KB. Disables itself for reduced-motion, and drops the
   expensive parts on touch devices so a phone on cellular is not punished. */

(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
  var root = document.documentElement;

  function el(s, r) { return (r || document).querySelector(s); }
  function els(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  /* =====================================================================
     1. SCROLL — deliberately NOT hijacked.

     An earlier build intercepted `wheel` and interpolated scrollTop. It was
     removed: it double-integrated trackpad momentum (which macOS has already
     applied), so one flick kept travelling after your fingers left the pad,
     and a single wheel notch took 1.6s to move 100px. Beyond the bug, taking
     over the scroll wheel fights the operating system's own scroll speed and
     makes some people motion sick.

     Native scroll it is. Everything below reads window.scrollY and works
     exactly the same without owning the input.
     ===================================================================== */

  /* =====================================================================
     2. THE BEAM
     A fixed light at 58% of the viewport. Everything reveals as it crosses.
     ===================================================================== */
  var BEAM = 0.58;

  if (!reduced) {
    var beam = document.createElement('div');
    beam.className = 'beamline';
    beam.setAttribute('aria-hidden', 'true');
    document.body.appendChild(beam);
  }

  /* =====================================================================
     3. SCROLL CHOREOGRAPHY
     Each [data-scan] gets --p (0→1) as it crosses the beam, and its children
     stagger. Rects are cached and only recomputed on resize.
     ===================================================================== */
  var scanned = els('[data-scan]');
  var rects = [];

  function measure() {
    rects = scanned.map(function (node) {
      var r = node.getBoundingClientRect();
      return { node: node, top: r.top + window.scrollY, h: r.height };
    });
  }

  function frame() {
    var vh = window.innerHeight;
    var line = window.scrollY + vh * BEAM;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      // 0 when the beam is one screen below the element, 1 once fully passed
      var p = clamp((line - r.top + vh * 0.18) / (r.h * 0.55 + vh * 0.24), 0, 1);
      r.node.style.setProperty('--p', p.toFixed(4));
      if (p > 0.02) r.node.classList.add('lit');
    }
    root.style.setProperty('--scrollp',
      (window.scrollY / Math.max(1, document.documentElement.scrollHeight - vh)).toFixed(4));
    requestAnimationFrame(frame);
  }

  if (scanned.length) {
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    if (reduced) {
      scanned.forEach(function (n) { n.style.setProperty('--p', '1'); n.classList.add('lit'); });
    } else {
      requestAnimationFrame(frame);
    }
  }

  /* =====================================================================
     4. DISPLAY TYPE — split into lines so they can rise independently
     ===================================================================== */
  function splitLines(node) {
    if (node.dataset.split) return;
    var text = node.textContent.trim();
    var words = text.split(/\s+/);
    node.textContent = '';
    var probe = [];
    words.forEach(function (w, i) {
      var s = document.createElement('span');
      s.className = 'w';
      s.textContent = w + (i < words.length - 1 ? ' ' : '');
      node.appendChild(s);
      probe.push(s);
    });
    // group spans into visual lines by offsetTop
    var lines = [], last = null;
    probe.forEach(function (s) {
      if (last === null || Math.abs(s.offsetTop - last) > 4) { lines.push([]); last = s.offsetTop; }
      lines[lines.length - 1].push(s);
    });
    node.textContent = '';
    lines.forEach(function (group, i) {
      var line = document.createElement('span');
      line.className = 'ln';
      line.style.setProperty('--i', i);
      var inner = document.createElement('span');
      inner.className = 'ln-i';
      group.forEach(function (s) { inner.appendChild(s); });
      line.appendChild(inner);
      node.appendChild(line);
    });
    node.dataset.split = '1';
  }

  if (!reduced) {
    els('[data-lines]').forEach(function (n) {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { splitLines(n); measure(); });
      } else { splitLines(n); }
    });
  }

  /* =====================================================================
     5. MAGNETIC BUTTONS + PARALLAX DEPTH
     ===================================================================== */
  if (!reduced && !touch) {
    els('[data-magnet]').forEach(function (b) {
      b.addEventListener('mousemove', function (e) {
        var r = b.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) / r.width;
        var y = (e.clientY - r.top - r.height / 2) / r.height;
        b.style.transform = 'translate(' + (x * 9).toFixed(2) + 'px,' + (y * 6).toFixed(2) + 'px)';
      });
      b.addEventListener('mouseleave', function () { b.style.transform = ''; });
    });

    var depths = els('[data-depth]');
    if (depths.length) {
      var mx = 0, my = 0, cx = 0, cy = 0;
      window.addEventListener('mousemove', function (e) {
        mx = (e.clientX / window.innerWidth - 0.5);
        my = (e.clientY / window.innerHeight - 0.5);
      });
      (function drift() {
        cx = lerp(cx, mx, 0.06); cy = lerp(cy, my, 0.06);
        depths.forEach(function (d) {
          var k = parseFloat(d.getAttribute('data-depth')) || 1;
          d.style.transform = 'translate3d(' + (cx * k * -22).toFixed(2) + 'px,' + (cy * k * -14).toFixed(2) + 'px,0)';
        });
        requestAnimationFrame(drift);
      })();
    }
  }

  /* =====================================================================
     6. HERO — point-cloud hand, swept by the beam
     Canvas 2D. ~1,250 points. Pauses offscreen and when the tab is hidden.

     The cloud is SAMPLED FROM A PHOTOGRAPH — assets/data/hand-cloud.json,
     built by photo/cloud.py, which places points by edge strength so they
     trace real contours: knuckles, tendons, the line where a finger turns
     away from the light. The hand that used to be drawn from maths is still
     below as synthetic(); it paints instantly and stays up if the fetch
     fails, so a dropped request degrades to the old drawing rather than to
     an empty hero. To revert permanently, delete the loadCloud() call.

     Why a photograph at all: a procedurally drawn hand reads as a cartoon at
     any size. Four capsules and a rectangle is a diagram of a hand, and the
     eye knows it in about a second. Sampled contours read as measurement,
     which is the whole claim the page is making.
     ===================================================================== */
  var cv = el('[data-herocanvas]');
  if (cv && !reduced) {
    var ctx = cv.getContext('2d', { alpha: true });
    var pts = [], W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var running = false, t = 0, pmx = 0, pmy = 0, cmx = 0, cmy = 0;

    // --- build the hand as a field of points -------------------------
    // Points are laid out in a normalised square and letterboxed into the
    // canvas, so the hand keeps its proportions at any aspect ratio.
    function ring(cx, cy, rx, ry, n, list, nail) {
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2;
        list.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry,
                    z: Math.random(), nail: nail, edge: true, s: 0 });
      }
    }
    function capsule(cx, top, bot, w, dens, list) {
      // outline
      var steps = Math.round(dens * 1.5);
      for (var i = 0; i <= steps; i++) {
        var ty = top + (bot - top) * (i / steps);
        var taper = 1 - Math.pow(Math.max(0, (ty - top) / (bot - top) - 0.55) / 0.45, 2) * 0.10;
        list.push({ x: cx - w / 2 * taper, y: ty, z: Math.random(), nail: false, edge: true, s: 0 });
        list.push({ x: cx + w / 2 * taper, y: ty, z: Math.random(), nail: false, edge: true, s: 0 });
      }
      // rounded tip
      for (var j = 0; j <= 16; j++) {
        var a = Math.PI + (j / 16) * Math.PI;
        list.push({ x: cx + Math.cos(a) * (w / 2), y: top + Math.sin(a) * (w / 2) * 0.72,
                    z: Math.random(), nail: false, edge: true, s: 0 });
      }
      // sparse fill
      for (var k = 0; k < dens; k++) {
        list.push({ x: cx + (Math.random() - 0.5) * w * 0.86,
                    y: top + Math.random() * (bot - top),
                    z: Math.random(), nail: false, edge: false, s: 0 });
      }
    }

    /* --- the shipped cloud ------------------------------------------- */
    function loadCloud() {
      // build_preview.py inlines the cloud as window.__handCloud, because the
      // single-file review artifact runs from file:// where fetch is refused.
      if (window.__handCloud) return adopt(window.__handCloud);
      if (!window.fetch) return;
      fetch('/assets/data/hand-cloud.json', { cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(adopt)
        .catch(function () { /* synthetic() is already on screen */ });
    }

    function adopt(d) {
      if (!d || !d.p || d.p.length < 200) return;       // keep synthetic()
      var k = 1 / (d.s || 4096), out = [];
      // Phones draw the same picture with fewer points. Drop every other FILL
      // point and keep every contour point — thinning the contour is what
      // makes a reduced cloud look broken rather than merely lighter.
      var skip = 0;
      for (var i = 0; i < d.p.length; i++) {
        var a = d.p[i], edge = !!(a[2] & 1), nail = !!(a[2] & 2);
        if (touch && !edge && (skip++ & 1)) continue;
        out.push({ x: a[0] * k, y: a[1] * k, z: Math.random(),
                   nail: nail, edge: edge, s: 0 });
      }
      pts = out;
    }

    /* --- fallback: the hand drawn from maths --------------------------- */
    function synthetic() {
      pts = [];
      var lo = touch ? 0.55 : 1;
      // x centre, tip y, base y, width, nail centre y, nail radii
      var F = [
        { x: 0.255, top: 0.300, bot: 0.760, w: 0.115, ny: 0.360, nrx: 0.044, nry: 0.056 },
        { x: 0.415, top: 0.180, bot: 0.760, w: 0.120, ny: 0.243, nrx: 0.046, nry: 0.058 },
        { x: 0.578, top: 0.215, bot: 0.760, w: 0.118, ny: 0.278, nrx: 0.045, nry: 0.058 },
        { x: 0.735, top: 0.330, bot: 0.760, w: 0.108, ny: 0.390, nrx: 0.042, nry: 0.053 }
      ];
      F.forEach(function (f) {
        capsule(f.x, f.top, f.bot, f.w, Math.round(60 * lo), pts);
        ring(f.x, f.ny, f.nrx, f.nry, Math.round(34 * lo), pts, true);
        ring(f.x, f.ny, f.nrx * 0.62, f.nry * 0.62, Math.round(20 * lo), pts, true);
        for (var i = 0; i < Math.round(34 * lo); i++) {
          var a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
          pts.push({ x: f.x + Math.cos(a) * r * f.nrx, y: f.ny + Math.sin(a) * r * f.nry,
                     z: Math.random(), nail: true, edge: false, s: 0 });
        }
      });

      // thumb, angled off to the left
      for (var t2 = 0; t2 <= Math.round(46 * lo); t2++) {
        var u = t2 / Math.round(46 * lo);
        var tx = 0.150 - u * 0.070, ty = 0.560 + u * 0.190;
        pts.push({ x: tx - 0.050, y: ty, z: Math.random(), nail: false, edge: true, s: 0 });
        pts.push({ x: tx + 0.050, y: ty, z: Math.random(), nail: false, edge: true, s: 0 });
        if (t2 % 2 === 0) pts.push({ x: tx + (Math.random() - 0.5) * 0.08, y: ty, z: Math.random(), nail: false, edge: false, s: 0 });
      }
      ring(0.140, 0.585, 0.040, 0.050, Math.round(26 * lo), pts, true);

      // palm — outline plus sparse fill
      var pl = 0.190, pr = 0.800, pt2 = 0.745, pb = 0.960;
      for (var e = 0; e <= Math.round(52 * lo); e++) {
        var f2 = e / Math.round(52 * lo);
        pts.push({ x: pl + (pr - pl) * f2, y: pt2, z: Math.random(), nail: false, edge: true, s: 0 });
        pts.push({ x: pl + (pr - pl) * f2, y: pb,  z: Math.random(), nail: false, edge: true, s: 0 });
      }
      for (var e2 = 0; e2 <= Math.round(18 * lo); e2++) {
        var g2 = e2 / Math.round(18 * lo);
        pts.push({ x: pl, y: pt2 + (pb - pt2) * g2, z: Math.random(), nail: false, edge: true, s: 0 });
        pts.push({ x: pr, y: pt2 + (pb - pt2) * g2, z: Math.random(), nail: false, edge: true, s: 0 });
      }
      for (var q = 0; q < Math.round(190 * lo); q++) {
        pts.push({ x: pl + Math.random() * (pr - pl), y: pt2 + Math.random() * (pb - pt2),
                   z: Math.random(), nail: false, edge: false, s: 0 });
      }
    }

    function size() {
      var r = cv.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
      if (!running) return;
      t += 0.0055;
      // letterbox the normalised square into the canvas
      var S = Math.min(W, H) * 0.98;
      var ox = (W - S) / 2, oy = (H - S) / 2;
      cmx = lerp(cmx, pmx, 0.05); cmy = lerp(cmy, pmy, 0.05);
      ctx.clearRect(0, 0, W, H);

      var by = (Math.sin(t) * 0.5 + 0.5) * 0.72 + 0.12;   // beam travel 0.12→0.84

      // the beam itself
      var beamY = oy + by * S;
      var g = ctx.createLinearGradient(0, beamY - 30, 0, beamY + 30);
      g.addColorStop(0, 'rgba(255,82,51,0)');
      g.addColorStop(0.5, 'rgba(255,82,51,0.34)');
      g.addColorStop(1, 'rgba(255,82,51,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, beamY - 30, W, 60);
      ctx.fillStyle = 'rgba(255,160,132,0.9)';
      ctx.fillRect(0, beamY - 0.6, W, 1.2);

      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var px = ox + (p.x + cmx * 0.030 * (0.25 + p.z)) * S;
        var py = oy + (p.y + cmy * 0.020 * (0.25 + p.z)) * S;
        var d = Math.abs((py - oy) / S - by);
        var hit = clamp(1 - d / 0.075, 0, 1);           // proximity to beam
        p.s = lerp(p.s, hit, 0.16);

        // Brighter than the synthetic hand needed. That one was mostly solid
        // fill, so it read as a mass; the sampled cloud is thin contour, and
        // at the old alphas it vanished into the background on a dark screen.
        var base = p.nail ? 0.62 : (p.edge ? 0.56 : 0.24);
        var alpha = base + p.s * (p.nail ? 0.38 : 0.44);
        var rad = (p.nail ? 1.4 : p.edge ? 1.25 : 0.9) + p.s * 1.6 + p.z * 0.45;

        if (p.s > 0.06) {
          ctx.fillStyle = 'rgba(255,' + Math.round(120 + 110 * (1 - p.s)) + ',' + Math.round(90 + 90 * (1 - p.s)) + ',' + alpha.toFixed(3) + ')';
        } else {
          ctx.fillStyle = 'rgba(206,220,236,' + (alpha * 0.9).toFixed(3) + ')';
        }
        ctx.beginPath();
        ctx.arc(px, py - p.s * 2.2, rad, 0, 6.2832);
        ctx.fill();
      }
      requestAnimationFrame(draw);
    }

    function start() { if (!running) { running = true; requestAnimationFrame(draw); } }
    function stop() { running = false; }

    synthetic(); size(); loadCloud();
    window.addEventListener('resize', function () { size(); });
    if (!touch) {
      window.addEventListener('mousemove', function (e) {
        pmx = e.clientX / window.innerWidth - 0.5;
        pmy = e.clientY / window.innerHeight - 0.5;
      });
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { en[0].isIntersecting ? start() : stop(); },
        { threshold: 0.02 }).observe(cv);
    } else { start(); }
    document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
  }

  /* =====================================================================
     7. LOAD SEQUENCE + PAGE TRANSITIONS
     ===================================================================== */
  function reveal() { root.classList.add('ready'); }
  if (document.readyState === 'complete') reveal();
  else window.addEventListener('load', function () { setTimeout(reveal, 60); });
  setTimeout(reveal, 1600);   // never trap the page behind a stalled asset

  if (!reduced) {
    els('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(https?:|mailto:|tel:)/.test(href)) return;
      if (a.hasAttribute('download') || a.target === '_blank') return;
      a.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        root.classList.add('leaving');
        setTimeout(function () { window.location.href = href; }, 320);
      });
    });
    window.addEventListener('pageshow', function (e) { if (e.persisted) root.classList.remove('leaving'); });
  }
})();
