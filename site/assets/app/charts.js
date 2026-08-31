/* ═══════════════════════════════════════════════════════════════════════════
   CHARTS — inline SVG, no library
   ═══════════════════════════════════════════════════════════════════════════

   Four forms, each picked from the job the data is doing rather than from what
   looks impressive:

     line()    change over time            two series, same unit, ONE axis
     funnel()  ordered stages              one hue, ordinal ramp
     bars()    magnitude across categories one colour (identity lives elsewhere)
     spark()   a shape beside a number     no axes, no legend

   Rules held throughout, and worth not regressing:

   - NEVER a second y-axis. Scans and bookings are both counts, so they share
     one scale honestly. The moment a measure with a different unit is wanted
     here, it becomes its own chart.
   - Colour follows the ENTITY, not the rank. Filtering the range never
     repaints a series.
   - Gridlines and axes are solid hairlines one shade off the surface. Never
     dashed — dashing reads as "projection" when it is just a grid.
   - Labels are selective: endpoints and extremes, never a number on every
     point. The tooltip and the table view carry the rest.
   - Every chart ships a <title> and a table fallback, so identity is never
     carried by colour alone.

   The palette lives in app.css as --s1…--s5 and --o1…--o5 and was validated
   with the dataviz validator against the panel surface. Do not substitute
   colours here.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  /* Nice round tick values — a y-axis topping out at 17 reads as noise. */
  function ticks(max, count) {
    var raw = max / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw) || 0));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; })
      .filter(function (s) { return s >= raw; })[0] || mag * 10;
    var out = [], v = 0;
    while (v <= max + step * 0.01) { out.push(v); v += step; }
    return out;
  }

  /* ── Shared tooltip. One node for the whole page. ────────────────────── */

  var tip = null;
  function tipNode() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'charttip';
    tip.setAttribute('role', 'status');
    document.body.appendChild(tip);
    return tip;
  }
  function showTip(html, x, y) {
    var t = tipNode();
    t.innerHTML = html;
    t.classList.add('on');
    var r = t.getBoundingClientRect();
    // Flip before the tooltip runs off the right edge rather than after.
    var left = Math.min(x + 14, window.innerWidth - r.width - 10);
    t.style.left = Math.max(8, left) + 'px';
    t.style.top = Math.max(8, y - r.height - 12) + 'px';
  }
  function hideTip() { if (tip) tip.classList.remove('on'); }

  /* ═════════════════════════════════════════════════════════════════════
     LINE — change over time, up to two same-unit series
     ═════════════════════════════════════════════════════════════════════ */

  function line(host, opts) {
    host.innerHTML = '';
    var data = opts.data;                    // [{label, a, b}]
    var W = host.clientWidth || 720;
    // Height INCLUDES the x-axis band. Sizing the plot alone is what gives a
    // card its own tiny nested scrollbar.
    var H = opts.height || 240, padL = 44, padR = 14, padT = 14, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;

    var maxV = Math.max(1, data.reduce(function (m, d) {
      return Math.max(m, d.a || 0, opts.seriesB ? (d.b || 0) : 0);
    }, 0));
    var ts = ticks(maxV, 4);
    var top = ts[ts.length - 1];

    var x = function (i) { return padL + (data.length < 2 ? iw / 2 : i / (data.length - 1) * iw); };
    var y = function (v) { return padT + ih - (v / top) * ih; };

    var s = svg('svg', {
      viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H,
      role: 'img', 'aria-label': opts.aria || opts.title
    });
    s.appendChild(svg('title')).textContent = opts.aria || opts.title;

    // Grid — solid hairlines, recessive.
    ts.forEach(function (t) {
      s.appendChild(svg('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t),
        stroke: css('--grid'), 'stroke-width': 1 }));
      var lb = svg('text', { x: padL - 9, y: y(t) + 4, 'text-anchor': 'end', class: 'ax' });
      lb.textContent = fmt(t);
      s.appendChild(lb);
    });

    function path(key, close) {
      var d = data.map(function (p, i) {
        return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p[key] || 0).toFixed(1);
      }).join('');
      if (close) d += 'L' + x(data.length - 1).toFixed(1) + ' ' + y(0) + 'L' + x(0).toFixed(1) + ' ' + y(0) + 'Z';
      return d;
    }

    var cA = css('--s1'), cB = css('--s2');

    // Area under series A only. Two filled areas overlapping is mud.
    var grad = svg('linearGradient', { id: 'lg-' + (opts.id || 'a'), x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(svg('stop', { offset: '0%', 'stop-color': cA, 'stop-opacity': .22 }));
    grad.appendChild(svg('stop', { offset: '100%', 'stop-color': cA, 'stop-opacity': 0 }));
    var defs = svg('defs'); defs.appendChild(grad); s.appendChild(defs);
    s.appendChild(svg('path', { d: path('a', true), fill: 'url(#lg-' + (opts.id || 'a') + ')' }));

    if (opts.seriesB) {
      s.appendChild(svg('path', { d: path('b'), fill: 'none', stroke: cB,
        'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    }
    s.appendChild(svg('path', { d: path('a'), fill: 'none', stroke: cA,
      'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    // Baseline
    s.appendChild(svg('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0),
      stroke: css('--axis'), 'stroke-width': 1 }));

    // Selective x labels — first, middle, last. Never every point.
    [0, Math.floor(data.length / 2), data.length - 1].forEach(function (i, n, arr) {
      if (arr.indexOf(i) !== n) return;
      var t = svg('text', { x: x(i), y: H - 9,
        'text-anchor': i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle', class: 'ax' });
      t.textContent = data[i].label;
      s.appendChild(t);
    });

    // Endpoint markers, with a 2px surface ring so they read on the line.
    var last = data.length - 1;
    [[cA, 'a'], opts.seriesB ? [cB, 'b'] : null].filter(Boolean).forEach(function (p) {
      s.appendChild(svg('circle', { cx: x(last), cy: y(data[last][p[1]] || 0), r: 4,
        fill: p[0], stroke: css('--panel'), 'stroke-width': 2 }));
    });

    // Crosshair + hover. An SVG chart in a browser is interactive by default;
    // shipping one that is not is the omission, not the feature.
    var cross = svg('line', { y1: padT, y2: padT + ih, stroke: css('--line-3'),
      'stroke-width': 1, opacity: 0 });
    s.appendChild(cross);
    var dotA = svg('circle', { r: 4.5, fill: cA, stroke: css('--panel'), 'stroke-width': 2, opacity: 0 });
    var dotB = svg('circle', { r: 4.5, fill: cB, stroke: css('--panel'), 'stroke-width': 2, opacity: 0 });
    s.appendChild(dotA); if (opts.seriesB) s.appendChild(dotB);

    var hit = svg('rect', { x: padL, y: padT, width: iw, height: ih, fill: 'transparent' });
    s.appendChild(hit);

    function at(ev) {
      var r = s.getBoundingClientRect();
      var px = (ev.clientX - r.left) / r.width * W;
      var i = Math.round((px - padL) / iw * (data.length - 1));
      i = Math.max(0, Math.min(data.length - 1, i));
      var d = data[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', 1);
      dotA.setAttribute('cx', x(i)); dotA.setAttribute('cy', y(d.a || 0)); dotA.setAttribute('opacity', 1);
      if (opts.seriesB) {
        dotB.setAttribute('cx', x(i)); dotB.setAttribute('cy', y(d.b || 0)); dotB.setAttribute('opacity', 1);
      }
      showTip(
        '<b>' + (d.full || d.label) + '</b>' +
        '<span><i style="background:' + cA + '"></i>' + opts.seriesA + '<em>' + fmt(d.a || 0) + '</em></span>' +
        (opts.seriesB ? '<span><i style="background:' + cB + '"></i>' + opts.seriesB + '<em>' + fmt(d.b || 0) + '</em></span>' : ''),
        ev.clientX, ev.clientY);
    }
    hit.addEventListener('mousemove', at);
    hit.addEventListener('mouseleave', function () {
      cross.setAttribute('opacity', 0); dotA.setAttribute('opacity', 0);
      dotB.setAttribute('opacity', 0); hideTip();
    });

    host.appendChild(s);
    return s;
  }

  /* ═════════════════════════════════════════════════════════════════════
     FUNNEL — ordered stages, one hue
     ═════════════════════════════════════════════════════════════════════ */

  function funnel(host, rows) {
    host.innerHTML = '';
    var top = Math.max(1, rows[0].n);
    var ramp = ['--o1', '--o2', '--o3', '--o4', '--o5'].map(css);

    rows.forEach(function (r, i) {
      var pct = r.n / top;
      var wrap = document.createElement('div');
      wrap.className = 'fnl';
      wrap.innerHTML =
        '<span class="fs">' + r.stage + '</span>' +
        '<span class="fb"><i style="width:' + (pct * 100).toFixed(1) + '%;background:' + ramp[i] + '"></i></span>' +
        '<span class="fv">' + fmt(r.n) + '</span>' +
        '<span class="fp">' + (i === 0 ? '—' : Math.round(r.n / top * 100) + '%') + '</span>';
      wrap.addEventListener('mousemove', function (e) {
        var prev = i ? rows[i - 1].n : null;
        showTip('<b>' + r.stage + '</b><span>' + fmt(r.n) + ' of ' + fmt(top) + '</span>' +
          (prev ? '<span>' + Math.round(r.n / prev * 100) + '% of the step before</span>' : ''),
          e.clientX, e.clientY);
      });
      wrap.addEventListener('mouseleave', hideTip);
      host.appendChild(wrap);
    });
  }

  /* ═════════════════════════════════════════════════════════════════════
     BARS — magnitude across categories, ONE colour
     ═════════════════════════════════════════════════════════════════════

     One series, so one hue for every bar. Shading each bar by its own value
     double-encodes the length as colour and burns the only free channel on
     information the bar already carries.
     ═════════════════════════════════════════════════════════════════════ */

  function bars(host, rows, opts) {
    opts = opts || {};
    host.innerHTML = '';
    var top = Math.max(1, rows.reduce(function (m, r) { return Math.max(m, r.value); }, 0));
    var colour = css(opts.colour || '--s1');

    rows.forEach(function (r) {
      var wrap = document.createElement('div');
      wrap.className = 'barrow';
      wrap.innerHTML =
        '<span class="bl">' + r.label + '</span>' +
        '<span class="bb"><i style="width:' + (r.value / top * 100).toFixed(1) + '%;background:' + colour + '"></i></span>' +
        '<span class="bv">' + (opts.format ? opts.format(r.value) : fmt(r.value)) + '</span>';
      wrap.addEventListener('mousemove', function (e) {
        showTip('<b>' + r.label + '</b><span>' + (r.detail || (opts.format ? opts.format(r.value) : fmt(r.value))) + '</span>',
          e.clientX, e.clientY);
      });
      wrap.addEventListener('mouseleave', hideTip);
      host.appendChild(wrap);
    });
  }

  /* ═════════════════════════════════════════════════════════════════════
     SPARK — a shape beside a number. No axes, no legend, no tooltip.
     ═════════════════════════════════════════════════════════════════════ */

  function spark(host, values, colourVar) {
    host.innerHTML = '';
    var W = 100, H = 26, max = Math.max.apply(null, values) || 1;
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H,
      preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    var d = values.map(function (v, i) {
      return (i ? 'L' : 'M') + (i / (values.length - 1) * W).toFixed(1) + ' ' +
             (H - (v / max) * (H - 3) - 1.5).toFixed(1);
    }).join('');
    s.appendChild(svg('path', { d: d, fill: 'none', stroke: css(colourVar || '--s1'),
      'stroke-width': 1.5, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    host.appendChild(s);
  }

  /* A table view for every chart — the accessibility backstop, and the thing
     an owner actually copies into a spreadsheet. */
  function table(rows, cols) {
    return '<table class="dtable"><thead><tr>' +
      cols.map(function (c) { return '<th>' + c + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  root.Chart = { line: line, funnel: funnel, bars: bars, spark: spark, table: table, fmt: fmt, hideTip: hideTip };
}(window));
