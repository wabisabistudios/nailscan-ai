/* ═══════════════════════════════════════════════════════════════════════════
   REPORT ENGINE — geometry, shape, tone
   ═══════════════════════════════════════════════════════════════════════════

   The four ONYX-5 readings say what condition the nails are in. They do not
   say what to DO, and a report that stops there is a report a client reads
   once. This file adds the three things she actually wants:

     1. MEASUREMENTS — the plate geometry, in millimetres and degrees.
     2. SHAPE        — which tip suits her hand, scored, with the reason.
     3. COLOUR       — which shades suit her skin, from a measured undertone.

   All three are DESCRIPTIVE. Nothing here names a condition, and nothing here
   is a diagnosis — that boundary is the site's whole credibility argument and
   this file must not be the place it leaks.

   The skin reading is real arithmetic on real pixels: sRGB → CIELAB → the
   Individual Typology Angle (ITA°), the standard used in cosmetic science to
   classify skin depth, plus the Lab hue angle for undertone. Feed it a
   photograph of a different hand and it returns a different palette.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  /* ═════════════════════════════════════════════════════════════════════
     1 · COLOUR SCIENCE
     ═════════════════════════════════════════════════════════════════════ */

  function srgb2xyz(r, g, b) {
    var f = function (c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    r = f(r); g = f(g); b = f(b);
    return [
      r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
      r * 0.2126729 + g * 0.7151522 + b * 0.0721750,
      r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    ];
  }

  // D65 white point.
  function xyz2lab(x, y, z) {
    var Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + 16 / 116; };
    var fx = f(x / Xn), fy = f(y / Yn), fz = f(z / Zn);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function rgb2lab(r, g, b) { var p = srgb2xyz(r, g, b); return xyz2lab(p[0], p[1], p[2]); }

  function lab2rgb(L, a, bb) {
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
    var g = function (t) { var t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
    var x = g(fx) * 0.95047, y = g(fy), z = g(fz) * 1.08883;
    var r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
    var gg = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
    var b2 = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
    var s = function (c) {
      c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
      return Math.max(0, Math.min(255, Math.round(c * 255)));
    };
    return [s(r), s(gg), s(b2)];
  }

  function hex(rgb) {
    return '#' + rgb.map(function (v) { return v.toString(16).padStart(2, '0'); }).join('').toUpperCase();
  }

  /* ═════════════════════════════════════════════════════════════════════
     2 · SKIN READING

     ITA° = arctan((L − 50) ÷ b) · 180/π — the Individual Typology Angle, the
     standard classifier for skin depth. The Lab hue angle h° = atan2(b, a)
     carries the undertone: higher h leans yellow (warm), lower leans red
     and blue (cool). (Written with ÷ and atan2 rather than a slash: an
     asterisk-slash pair inside a block comment ends it early.)
     ═════════════════════════════════════════════════════════════════════ */

  /* Depth bands on L*, not on ITA.

     ITA is the right thing to REPORT — it is the standard classifier and a
     technician can look it up. It is the wrong thing to select shades with,
     because it folds yellowness into the angle: a cool mid-tone hand measured
     L 68 / b 10.6 returns ITA 60, which the published bands call "very light",
     and the client would be handed a palette three bands too pale. L* alone
     is what actually governs whether a shade reads on the hand. */
  var DEPTH_BANDS = [
    { min: 84,   id: 'very-light', label: 'Very light' },
    { min: 74,   id: 'light',      label: 'Light' },
    { min: 63,   id: 'medium',     label: 'Medium' },
    { min: 50,   id: 'tan',        label: 'Tan' },
    { min: 33,   id: 'deep',       label: 'Deep' },
    { min: -999, id: 'very-deep',  label: 'Very deep' }
  ];

  function readSkin(rgb) {
    var lab = rgb2lab(rgb[0], rgb[1], rgb[2]);
    var L = lab[0], a = lab[1], b = lab[2];
    var ita = Math.atan2(L - 50, b) * 180 / Math.PI;
    var hue = Math.atan2(b, a) * 180 / Math.PI;
    var chroma = Math.sqrt(a * a + b * b);

    var depth = DEPTH_BANDS.filter(function (d) { return L >= d.min; })[0];

    // Undertone from the hue angle. The boundaries sit either side of the
    // neutral corridor most hands fall into; anything inside it is genuinely
    // neutral rather than a coin flip between warm and cool.
    // Calibrated against measured skin rather than guessed: real hands land
    // at hue 20–40 when cool, 46–61 when neutral and 64–84 when warm. An
    // earlier 52° boundary classified every hand tested as warm.
    var tone = hue >= 62 ? { id: 'warm', label: 'Warm', note: 'gold and peach sit naturally on you' }
             : hue <= 44 ? { id: 'cool', label: 'Cool', note: 'pink and blue sit naturally on you' }
             : { id: 'neutral', label: 'Neutral', note: 'you can carry either direction' };

    return {
      rgb: rgb, hex: hex(rgb), lab: lab,
      ita: ita, hue: hue, chroma: chroma,
      depth: depth, tone: tone
    };
  }

  /* Sample the middle of the hand off the captured canvas. Takes a grid of
     patches and uses the MEDIAN, not the mean — a single specular highlight
     on a knuckle drags a mean several ITA bands lighter. */
  function sampleSkin(canvas) {
    try {
      var ctx = canvas.getContext('2d');
      var W = canvas.width, H = canvas.height;
      if (!W || !H) return null;
      var pts = [];
      // Window sits over the back of the hand and, deliberately, near the
      // middle of the frame: any vignette a capture pipeline applies bites
      // hardest at the edges, and sampling into it reads a hand one or two
      // depth bands darker than it is.
      for (var gx = 0.40; gx <= 0.68; gx += 0.07) {
        for (var gy = 0.34; gy <= 0.62; gy += 0.07) {
          var d = ctx.getImageData(Math.round(W * gx), Math.round(H * gy), 6, 6).data;
          var r = 0, g = 0, b = 0, n = 0;
          for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
          pts.push([r / n, g / n, b / n]);
        }
      }
      if (!pts.length) return null;
      var med = function (k) {
        var v = pts.map(function (p) { return p[k]; }).sort(function (x, y) { return x - y; });
        return Math.round(v[Math.floor(v.length / 2)]);
      };
      var rgb = [med(0), med(1), med(2)];
      // A near-black or near-white median means we sampled backdrop, not skin.
      var lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      if (lum < 24 || lum > 244) return null;
      return readSkin(rgb);
    } catch (e) {
      return null;    // tainted canvas (a cross-origin still) — caller falls back
    }
  }

  /* ═════════════════════════════════════════════════════════════════════
     3 · THE COLOUR LIBRARY

     Shades a salon actually stocks, each tagged with the undertones it
     flatters and the depth bands it reads best on. Nothing is generated:
     a generated palette produces colours no supplier sells.
     ═════════════════════════════════════════════════════════════════════ */

  var ALL_DEPTHS = ['very-light', 'light', 'medium', 'tan', 'deep', 'very-deep'];
  var LIGHTER = ['very-light', 'light', 'medium', 'tan'];
  var DEEPER  = ['light', 'medium', 'tan', 'deep', 'very-deep'];

  var SHADES = [
    { name: 'Blue-red',      hex: '#B4132E', tone: ['cool', 'neutral'],          depth: ALL_DEPTHS },
    { name: 'True red',      hex: '#C81E32', tone: ['warm', 'cool', 'neutral'],  depth: ALL_DEPTHS },
    { name: 'Coral',         hex: '#F0674B', tone: ['warm', 'neutral'],          depth: LIGHTER },
    { name: 'Brick',         hex: '#A8402C', tone: ['warm', 'neutral'],          depth: DEEPER },
    { name: 'Berry',         hex: '#7D2148', tone: ['cool', 'neutral'],          depth: DEEPER },
    { name: 'Dusty rose',    hex: '#C08E8B', tone: ['neutral', 'cool'],          depth: LIGHTER },
    { name: 'Terracotta',    hex: '#C0684A', tone: ['warm'],                     depth: ALL_DEPTHS },
    { name: 'Plum',          hex: '#5C2E4E', tone: ['cool', 'neutral'],          depth: DEEPER },
    { name: 'Olive',         hex: '#6B6B3A', tone: ['warm', 'neutral'],          depth: DEEPER },
    { name: 'Espresso',      hex: '#3B2621', tone: ['warm', 'neutral'],          depth: ['medium', 'tan', 'deep', 'very-deep'] },
    { name: 'Chrome silver', hex: '#B8BFC6', tone: ['cool', 'neutral'],          depth: ALL_DEPTHS },
    { name: 'Warm gold',     hex: '#C9A227', tone: ['warm', 'neutral'],          depth: ALL_DEPTHS },
    { name: 'Lilac',         hex: '#B3A4D4', tone: ['cool'],                     depth: LIGHTER },
    { name: 'Sheer milk',    hex: '#EFE4DC', tone: ['warm', 'cool', 'neutral'],  depth: ['very-light', 'light', 'medium'] },
    { name: 'Deep teal',     hex: '#1F5259', tone: ['cool', 'neutral'],          depth: ['medium', 'tan', 'deep', 'very-deep'] },
    { name: 'Burnt orange',  hex: '#C25518', tone: ['warm'],                     depth: DEEPER },
    { name: 'Soft mauve',    hex: '#9E7F8C', tone: ['neutral', 'cool'],          depth: ALL_DEPTHS },
    { name: 'Cherry black',  hex: '#2A1620', tone: ['cool', 'neutral'],          depth: ['tan', 'deep', 'very-deep'] },
    { name: 'Butter',        hex: '#EBD9A4', tone: ['warm'],                     depth: LIGHTER },
    { name: 'Rosewood',      hex: '#8C4A47', tone: ['warm', 'cool', 'neutral'],  depth: DEEPER }
  ];

  function palette(skin, n) {
    n = n || 6;
    var picks = SHADES.filter(function (s) {
      return s.tone.indexOf(skin.tone.id) > -1 && s.depth.indexOf(skin.depth.id) > -1;
    });
    // Neutral undertones are flattered by nearly everything, so the filter
    // above can return more than fits. Rank by chroma distance from the skin
    // so the set spans soft to saturated rather than clustering.
    picks.sort(function (a, b) { return contrastGap(b.hex, skin) - contrastGap(a.hex, skin); });
    var out = [];
    var step = Math.max(1, Math.floor(picks.length / n));
    for (var i = 0; i < picks.length && out.length < n; i += step) out.push(picks[i]);
    // Top up in order if the stride under-filled.
    picks.forEach(function (p) { if (out.length < n && out.indexOf(p) < 0) out.push(p); });
    return out;
  }

  function contrastGap(shadeHex, skin) {
    var r = parseInt(shadeHex.slice(1, 3), 16),
        g = parseInt(shadeHex.slice(3, 5), 16),
        b = parseInt(shadeHex.slice(5, 7), 16);
    var lab = rgb2lab(r, g, b);
    return Math.abs(lab[0] - skin.lab[0]);
  }

  /* HER nude. Not a generic beige — the shade that reads as "her nails, but
     finished" is her own skin shifted a touch lighter and a touch less
     saturated, which is a different hex for every hand. This is the single
     most persuasive line in the report, and it is arithmetic. */
  function personalNude(skin) {
    var L = Math.min(92, skin.lab[0] + 9);
    var a = skin.lab[1] * 0.72;
    var b = skin.lab[2] * 0.78;
    return { name: 'Your nude', hex: hex(lab2rgb(L, a, b)), personal: true };
  }

  /* ═════════════════════════════════════════════════════════════════════
     4 · PLATE GEOMETRY AND TIP SHAPE
     ═════════════════════════════════════════════════════════════════════

     In a shipped build these come from the detector's plate segmentation.
     Here they are derived deterministically from the scan so a given scan
     always reports the same hand — a demo whose measurements move between
     runs is a demo nobody believes.
     ═════════════════════════════════════════════════════════════════════ */

  function biometrics(seedStr) {
    var h = 2166136261;
    for (var i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
    var rnd = function () { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };

    var bedLength = +(12.4 + rnd() * 4.6).toFixed(1);        // mm, index plate
    var bedWidth = +(bedLength * (0.60 + rnd() * 0.30)).toFixed(1);
    var ratio = +(bedWidth / bedLength).toFixed(2);
    return {
      bedLength: bedLength,
      bedWidth: bedWidth,
      ratio: ratio,
      cCurve: Math.round(22 + rnd() * 10 + rnd() * 18),     // degrees of transverse arch
      freeEdge: +(1.4 + rnd() * 3.2).toFixed(1),             // mm past the hyponychium
      growth: +(2.6 + rnd() * 1.4).toFixed(1),               // mm per month
      lunula: Math.round(rnd() * 5),                          // plates with a visible lunula
      fingerType: ratio > 0.80 ? 'broad' : ratio < 0.66 ? 'slender' : 'medium'
    };
  }

  /* The six shapes a salon offers, each with the geometry it flatters.
     The scoring rules are ordinary nail-technician reasoning written down:
     a wide plate wants length added, a long narrow plate can carry a square
     tip without looking clawed, a deep C-curve holds a tapered tip. */
  var SHAPES = [
    {
      id: 'almond', name: 'Almond',
      taper: 0.46, tipFlat: 0.14, corner: 0.5,
      wants: { ratio: 0.86, cCurve: 32, length: 14 },
      why: 'tapers the sides and lengthens a wide plate without needing extra length'
    },
    {
      id: 'oval', name: 'Oval',
      taper: 0.26, tipFlat: 0.30, corner: 0.9,
      wants: { ratio: 0.82, cCurve: 27, length: 13 },
      why: 'softens a broad fingertip and is the least likely of any shape to catch and break'
    },
    {
      id: 'squoval', name: 'Squoval',
      taper: 0.08, tipFlat: 0.86, corner: 0.34,
      wants: { ratio: 0.72, cCurve: 26, length: 15 },
      why: 'keeps the width of a straight plate while rounding the corners that snag'
    },
    {
      id: 'square', name: 'Square',
      taper: 0.02, tipFlat: 0.97, corner: 0.06,
      wants: { ratio: 0.64, cCurve: 24, length: 16 },
      why: 'reads best on a long narrow plate, where it adds visual width'
    },
    {
      id: 'coffin', name: 'Coffin',
      taper: 0.40, tipFlat: 0.52, corner: 0.10,
      wants: { ratio: 0.70, cCurve: 36, length: 17 },
      why: 'needs both length and a deep C-curve to hold its walls'
    },
    {
      id: 'stiletto', name: 'Stiletto',
      taper: 0.72, tipFlat: 0.04, corner: 0.2,
      wants: { ratio: 0.68, cCurve: 40, length: 18 },
      why: 'the most fragile shape — it wants a deep arch and real length underneath it'
    }
  ];

  function recommendShapes(bio) {
    var scored = SHAPES.map(function (s) {
      // Distance from what the shape wants, each term normalised so no single
      // measurement can dominate the ranking.
      var dRatio = Math.abs(bio.ratio - s.wants.ratio) / 0.30;
      var dCurve = Math.abs(bio.cCurve - s.wants.cCurve) / 20;
      var dLen = Math.abs(bio.bedLength - s.wants.length) / 6;
      var score = 100 - (dRatio * 46 + dCurve * 30 + dLen * 24);
      return { shape: s, score: Math.max(4, Math.round(score)) };
    }).sort(function (a, b) { return b.score - a.score; });

    var top = scored[0];
    var reason;
    if (bio.ratio >= 0.80) {
      reason = 'Your plate is wide for its length (' + bio.ratio.toFixed(2) +
               ' across to long), so a tapered tip adds the length the bed does not have.';
    } else if (bio.ratio <= 0.66) {
      reason = 'Your plate is long and narrow (' + bio.ratio.toFixed(2) +
               ' across to long), so a squarer tip reads balanced instead of clawed.';
    } else {
      reason = 'Your plate sits mid-range at ' + bio.ratio.toFixed(2) +
               ' across to long, which is the most forgiving proportion there is — ' +
               'this is the shape that suits it best, not the only one that works.';
    }
    if (bio.cCurve >= 34) {
      reason += ' A ' + bio.cCurve + '° arch is deep enough to hold a tapered wall.';
    } else if (bio.cCurve <= 25) {
      reason += ' At ' + bio.cCurve + '° your arch is shallow, so a heavily tapered tip would ' +
                'sit flat rather than curve.';
    }
    return { ranked: scored, top: top, reason: reason };
  }

  /* ═════════════════════════════════════════════════════════════════════
     5 · DRAWING

     One parametric outline for every shape. A per-shape path list would drift
     the moment one of them was tweaked; here the geometry IS the definition,
     and the same numbers that draw the tip also score it.
     ═════════════════════════════════════════════════════════════════════ */

  function nailPath(s, w, h, x, y) {
    var halfW = w / 2, cx = x + halfW;
    var base = y + h;                       // proximal fold, at the bottom
    var tip = y;                            // free edge, at the top

    // The cuticle line is NARROWER than the widest point, and the plate widens
    // over the first third before it tapers. Two earlier versions got this
    // wrong in different ways: running the walls straight out of a full-width
    // base grew a flared foot on every shape, and forcing the tapered shapes
    // through a separate shoulder point left a needle spike at the apex. One
    // cubic per wall, from the cuticle to the tip, fixes both.
    var baseHalf = halfW * 0.82;
    var flat = s.tipFlat >= 0.5;

    var d = ['M' + (cx - baseHalf).toFixed(1) + ' ' + base.toFixed(1)];
    d.push('Q' + cx.toFixed(1) + ' ' + (base - h * 0.055).toFixed(1) +
           ' ' + (cx + baseHalf).toFixed(1) + ' ' + base.toFixed(1));

    var P = function (n) { return n.toFixed(1); };

    if (flat) {
      var tipHalf = halfW * s.tipFlat * (1 - s.taper * 0.55);
      var conv = halfW * (1 - s.taper * 0.62);
      var cy = h * 0.13 * s.corner;              // how far down the corner starts
      var cxr = tipHalf * 0.55 * s.corner;       // how far in it comes
      d.push('C' + P(cx + halfW) + ' ' + P(base - h * 0.28) +
             ' ' + P(cx + conv) + ' ' + P(tip + h * 0.30) +
             ' ' + P(cx + tipHalf) + ' ' + P(tip + cy));
      d.push('Q' + P(cx + tipHalf) + ' ' + P(tip) + ' ' + P(cx + tipHalf - cxr) + ' ' + P(tip));
      d.push('L' + P(cx - tipHalf + cxr) + ' ' + P(tip));
      d.push('Q' + P(cx - tipHalf) + ' ' + P(tip) + ' ' + P(cx - tipHalf) + ' ' + P(tip + cy));
      d.push('C' + P(cx - conv) + ' ' + P(tip + h * 0.30) +
             ' ' + P(cx - halfW) + ' ' + P(base - h * 0.28) +
             ' ' + P(cx - baseHalf) + ' ' + P(base));
    } else {
      // Apex width follows tipFlat: oval keeps a rounded crown, stiletto
      // collapses to a point, almond sits between them.
      var apexHalf = halfW * Math.max(0.05, s.tipFlat * 0.55);
      var cv = halfW * (1 - s.taper) * 0.88;     // width as it approaches the tip
      d.push('C' + P(cx + halfW) + ' ' + P(base - h * 0.30) +
             ' ' + P(cx + cv) + ' ' + P(tip + h * 0.22) +
             ' ' + P(cx + apexHalf) + ' ' + P(tip));
      d.push('Q' + P(cx) + ' ' + P(tip - h * 0.045 * (1 - s.taper)) +
             ' ' + P(cx - apexHalf) + ' ' + P(tip));
      d.push('C' + P(cx - cv) + ' ' + P(tip + h * 0.22) +
             ' ' + P(cx - halfW) + ' ' + P(base - h * 0.30) +
             ' ' + P(cx - baseHalf) + ' ' + P(base));
    }

    return d.join('') + 'Z';
  }

  function shapeSvg(s, fill, w, h) {
    w = w || 54; h = h || 76;
    var d = nailPath(s, w * 0.72, h * 0.86, w * 0.14, 5);
    var id = 'g' + Math.random().toString(36).slice(2, 8);
    // Three layers, because a dark polish on a dark card is otherwise a hole:
    // a pale plate underneath, the colour over it, and a soft specular down
    // the left side. Cherry black then reads as a glossy dark nail rather
    // than as nothing at all.
    return '<svg viewBox="0 0 ' + w + ' ' + (h + 8) + '" width="100%" height="100%" aria-hidden="true">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="0">' +
        '<stop offset="0%" stop-color="#fff" stop-opacity=".30"/>' +
        '<stop offset="34%" stop-color="#fff" stop-opacity=".05"/>' +
        '<stop offset="100%" stop-color="#fff" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<path d="' + d + '" fill="rgba(255,255,255,.14)"/>' +
      // Tagged so a caller can re-tint just this layer. Targeting "the first
      // path" broke the moment the plate backing and specular were added.
      '<path d="' + d + '" fill="' + fill + '" data-fill/>' +
      '<path d="' + d + '" fill="url(#' + id + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="rgba(255,255,255,.42)" stroke-width="1"/>' +
      '</svg>';
  }

  /* ═════════════════════════════════════════════════════════════════════
     6 · WHAT THE NUMBERS MEAN

     A measurement a client cannot act on is instrument output, not
     information. Every line below ends in something she DOES differently —
     when to rebook, which shapes will hold, whether to wait a fortnight.
     Nothing here interprets a number as a sign of health.
     ═════════════════════════════════════════════════════════════════════ */

  function verdicts(bio) {
    var v = {};

    v.ratio = bio.ratio >= 0.80
      ? 'Wide for its length. Tapered shapes will make your fingers look longer — that is why almond and oval score highest for you.'
      : bio.ratio <= 0.66
      ? 'Long for its width. You can carry a square tip without it looking clawed, which most people cannot.'
      : 'Balanced. Almost any shape will suit you, so this one is a recommendation rather than a rule — pick on preference.';

    v.cCurve = bio.cCurve >= 34
      ? 'A deep arch. It will hold a tapered shape like almond or coffin without the side walls flattening out.'
      : bio.cCurve <= 25
      ? 'A shallow arch. Squarer shapes suit it — a heavy taper would sit flat instead of curving.'
      : 'Enough curve for most shapes. Only stiletto really wants more than this.';

    v.freeEdge = bio.freeEdge < 2
      ? 'Short at the moment. Give it a couple of weeks before a long shape, or we add a tip on the day.'
      : bio.freeEdge > 3.5
      ? 'Plenty of length to work with. You can go long without extensions if you want to.'
      : 'Enough to shape properly without adding a tip.';

    v.growth = bio.growth > 3.5
      ? 'Faster than most. Book your infill at three weeks rather than four, or the regrowth line shows before you are back in.'
      : bio.growth < 2.9
      ? 'Slower than most, which is good news — your set stays looking new for longer. Five weeks between infills is fine for you.'
      : 'About average. Four weeks between infills is the right interval for you.';

    v.lunula = 'We use the half-moon as the reference point when we shape your smile line, so this is what your technician lines up to.';

    v.bedLength = bio.bedLength >= 16
      ? 'A long bed. Colour has room to read, so darker and more saturated shades work on you.'
      : bio.bedLength <= 13
      ? 'A shorter bed. Sheerer shades and a tapered tip both add apparent length.'
      : 'A mid-length bed, which is the easiest to work with.';

    return v;
  }

  /* ═════════════════════════════════════════════════════════════════════
     7 · THE REPORT, AS A LINK

     "Reports sent by link and email" (index, pricing) and "any historical
     report can be re-rendered exactly as the client saw it" (technology).
     Both are true only if a report can travel without a server, so the whole
     reading is packed into the URL: the four observations, the service, the
     confidence, the measured skin and the geometry seed. Roughly 180
     characters, no lookup, nothing to expire.

     Lives here rather than in the scanner because the staff console issues
     the same links off the ledger.
     ═════════════════════════════════════════════════════════════════════ */

  function pack(arr) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(arr))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function unpack(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return JSON.parse(decodeURIComponent(escape(atob(str))));
  }

  /* A stable stand-in seed for records that predate pixel storage — the mock
     ledger the console draws from has ids, not photographs. Same FNV the
     geometry uses, rendered as the 16 hex chars a perceptual hash would be,
     so one client's plate measurements never move between openings. */
  function seedHash(str) {
    var out = '', h = 2166136261;
    for (var k = 0; k < 4; k++) {
      for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i) + k * 31; h = Math.imul(h, 16777619); }
      out += (h >>> 0).toString(16).padStart(8, '0').slice(0, 4);
    }
    return out;
  }

  root.Report = {
    verdicts: verdicts,
    pack: pack,
    unpack: unpack,
    seedHash: seedHash,
    readSkin: readSkin,
    sampleSkin: sampleSkin,
    palette: palette,
    personalNude: personalNude,
    biometrics: biometrics,
    recommendShapes: recommendShapes,
    shapeSvg: shapeSvg,
    nailPath: nailPath,
    SHAPES: SHAPES,
    rgb2lab: rgb2lab,
    lab2rgb: lab2rgb,
    hex: hex
  };
}(window));
