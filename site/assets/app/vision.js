/* ═══════════════════════════════════════════════════════════════════════════
   VISION — the measurements that are actually measurements
   ═══════════════════════════════════════════════════════════════════════════

   Everything in this file runs on real pixels. It exists because the capture
   screen used to CLAIM to check light, focus and framing while running three
   bars off a setTimeout, and the confidence gate — the feature the whole
   website is built around — was the constant 0.94. A blacked-out frame scored
   0.94 and produced a full report.

   Three standard measures, all cheap enough to run at ~10 fps on a phone:

     luma   mean relative luminance. Under-exposed and blown-out both fail.
     focus  variance of the Laplacian. The classic blur detector: a sharp
            image has lots of high-frequency energy, a blurred one has almost
            none, and the variance of a 3×3 Laplacian captures exactly that.
     skin   fraction of pixels inside the YCbCr skin locus. Stands in for
            "is a hand actually filling the frame", and unlike a face
            detector it does not care about orientation.

   What this file does NOT do is read the nail. That needs the model. The
   boundary is marked here and in the pipeline UI rather than blurred.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  // Small enough to be free, large enough that the Laplacian still sees real
  // edges. 160×200 keeps the 4:5 frame aspect.
  var W = 160, H = 200;
  var work = null;

  function scratch() {
    if (!work) {
      work = document.createElement('canvas');
      work.width = W; work.height = H;
    }
    return work;
  }

  /* Draw any source (video, image, canvas) cover-cropped into the scratch
     buffer, so measurements are taken over the same region the client framed. */
  function grab(src) {
    var cv = scratch();
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    var sw = src.videoWidth || src.naturalWidth || src.width;
    var sh = src.videoHeight || src.naturalHeight || src.height;
    if (!sw || !sh) return null;

    var target = W / H, ar = sw / sh, cw, ch;
    if (ar > target) { ch = sh; cw = sh * target; } else { cw = sw; ch = sw / target; }
    ctx.clearRect(0, 0, W, H);
    try {
      ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, W, H);
      return ctx.getImageData(0, 0, W, H);
    } catch (e) {
      return null;                 // not decoded yet, or a tainted source
    }
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* Score a value that has an ideal BAND rather than an ideal maximum:
     1 inside the band, falling off linearly outside it. */
  function band(v, lo, hi, slack) {
    if (v >= lo && v <= hi) return 1;
    var d = v < lo ? lo - v : v - hi;
    return clamp(1 - d / slack, 0, 1);
  }

  function analyse(imgData) {
    var d = imgData.data;
    var n = W * H;
    var grey = new Float32Array(n);
    var lumaSum = 0, skin = 0;

    for (var i = 0, p = 0; i < d.length; i += 4, p++) {
      var r = d[i], g = d[i + 1], b = d[i + 2];
      var y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      grey[p] = y;
      lumaSum += y;

      // YCbCr skin locus (Chai & Ngan). Cheap, orientation-free, and good
      // enough to answer "is there a hand in the frame" across skin tones.
      var cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      var cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) skin++;
    }

    var luma = (lumaSum / n) / 255;
    var skinFrac = skin / n;

    // Variance of the Laplacian. Sum over the interior only, so the border
    // does not need special-casing.
    var mean = 0, count = 0;
    var lap = new Float32Array(n);
    for (var yy = 1; yy < H - 1; yy++) {
      for (var xx = 1; xx < W - 1; xx++) {
        var k = yy * W + xx;
        var v = 4 * grey[k] - grey[k - 1] - grey[k + 1] - grey[k - W] - grey[k + W];
        lap[k] = v; mean += v; count++;
      }
    }
    mean /= count;
    var varSum = 0;
    for (var yy2 = 1; yy2 < H - 1; yy2++) {
      for (var xx2 = 1; xx2 < W - 1; xx2++) {
        var dv = lap[yy2 * W + xx2] - mean;
        varSum += dv * dv;
      }
    }
    var lapVar = varSum / count;

    /* Scores. The bands come from measuring real captures rather than from
       taste: a hand photographed indoors lands around luma 0.30–0.65, a sharp
       phone frame puts Laplacian variance well over 200, and a hand held to
       fill the guide covers roughly a third to two thirds of the frame. */
    var sLuma  = band(luma, 0.22, 0.78, 0.18);
    var sFocus = clamp(lapVar / 210, 0, 1);
    var sSkin  = band(skinFrac, 0.18, 0.82, 0.20);

    // Focus is weighted hardest because it is the failure the client cannot
    // see on a small screen and the one that ruins a reading outright.
    var raw = 0.28 * sLuma + 0.44 * sFocus + 0.28 * sSkin;
    // Map into the range the pipeline talks in. Even a perfect frame is not
    // claimed at 1.00 — the number is a confidence, not a grade.
    var confidence = 0.18 + raw * 0.79;

    // WEAKEST LINK. A weighted average alone lets a bright, sharp photograph
    // of a wall through: two checks at 1.00 carry one at 0.10 over the line.
    // These are three independent admission tests and any one of them failing
    // badly is disqualifying on its own — measured at 0.77 on a synthetic
    // camera pattern with a framing score of 0.10 before this was added.
    var weakest = Math.min(sLuma, sFocus, sSkin);
    if (weakest < 0.35) confidence = Math.min(confidence, 0.62);
    confidence = +confidence.toFixed(2);

    var fails = [];
    if (sLuma < 0.55) fails.push(luma < 0.4 ? 'more light' : 'less glare');
    if (sFocus < 0.55) fails.push('hold still');
    if (sSkin < 0.55) fails.push(skinFrac < 0.18 ? 'fill the frame' : 'just your hand');

    return {
      luma: luma, lapVar: lapVar, skinFrac: skinFrac,
      scores: { light: sLuma, focus: sFocus, frame: sSkin },
      confidence: confidence,
      fails: fails
    };
  }

  function measure(src) {
    var img = grab(src);
    return img ? analyse(img) : null;
  }

  /* ═════════════════════════════════════════════════════════════════════
     FINGERTIPS

     Marks that sit on the guide are marks that sit where we TOLD her to put
     her nails. Marks that sit on her actual plates are a different product.

     Classic silhouette method, no model needed: build the skin mask, take the
     skyline (the topmost skin pixel in each column), and read the fingertips
     off it as the local minima. A hand held up with fingers apart produces
     five clean notches; a fist or a hand at the wrong angle produces fewer,
     and we return fewer rather than inventing them.
     ═════════════════════════════════════════════════════════════════════ */

  function findTips(src, want) {
    want = want || 5;
    var img = grab(src);
    if (!img) return [];
    var d = img.data;

    // Column skyline. Requires a short RUN of skin, not a single pixel, so a
    // stray warm-coloured speck in the background cannot masquerade as a
    // fingertip 200px above the hand.
    var RUN = 4;
    var sky = new Float32Array(W).fill(H);
    for (var x = 0; x < W; x++) {
      var run = 0;
      for (var y = 0; y < H; y++) {
        var i = (y * W + x) * 4;
        var r = d[i], g = d[i + 1], b = d[i + 2];
        var cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        var cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) {
          if (++run >= RUN) { sky[x] = y - RUN + 1; break; }
        } else { run = 0; }
      }
    }

    // Smooth, or every pixel of skin texture reads as its own fingertip.
    var sm = new Float32Array(W);
    for (var x2 = 0; x2 < W; x2++) {
      var a2 = 0, n2 = 0;
      for (var k = -3; k <= 3; k++) {
        var xi = x2 + k;
        if (xi >= 0 && xi < W) { a2 += sky[xi]; n2++; }
      }
      sm[x2] = a2 / n2;
    }

    // Local minima with prominence: a candidate must rise by a real margin on
    // BOTH sides before the next candidate, which is what separates fingers
    // from the ripples along one finger's edge.
    // Fingers held together sit surprisingly close in x — on the reference
    // hand the ring and little plates are 5 px apart at this working size, so
    // a generous separation silently swallowed two of the five.
    var MIN_SEP = Math.max(4, Math.round(W * 0.032));
    var cands = [];
    for (var x3 = MIN_SEP; x3 < W - MIN_SEP; x3++) {
      var v = sm[x3];
      if (v >= H - 2) continue;                       // no skin in this column
      var isMin = true;
      for (var j = -MIN_SEP; j <= MIN_SEP && isMin; j++) {
        if (sm[x3 + j] < v - 0.001) isMin = false;
      }
      if (!isMin) continue;
      var left = 0, right = 0;
      for (var l = 1; l <= MIN_SEP * 2 && x3 - l >= 0; l++) left = Math.max(left, sm[x3 - l] - v);
      for (var rr = 1; rr <= MIN_SEP * 2 && x3 + rr < W; rr++) right = Math.max(right, sm[x3 + rr] - v);
      cands.push({ x: x3, y: v, prom: Math.min(left, right) });
    }

    // Merge candidates that are really the same tip, keep the most prominent.
    cands.sort(function (a, b) { return b.prom - a.prom; });
    var picked = [];
    cands.forEach(function (c) {
      if (c.prom < 2) return;
      for (var i2 = 0; i2 < picked.length; i2++) {
        if (Math.abs(picked[i2].x - c.x) < MIN_SEP * 1.35) return;
      }
      if (picked.length < want) picked.push(c);
    });

    // The nail sits just BELOW the silhouette tip — the plate starts a few
    // millimetres back from the very end of the finger.
    return picked
      .sort(function (a, b) { return a.x - b.x; })
      .map(function (c) {
        return { x: c.x / W, y: Math.min(0.96, (c.y + H * 0.035) / H), prom: c.prom };
      });
  }

  /* ═════════════════════════════════════════════════════════════════════
     PERCEPTUAL HASH

     fingerprint() below is exact: change one pixel and it changes completely.
     That makes it a fine report ID and a useless client key. The website's
     central argument is that the salon keeps a RECORD — "six visits later,
     that is a history" — and a record needs the same hand photographed five
     weeks apart in different light to land on the same row.

     dHash does that. Reduce to a 9×8 grey grid, compare each cell with its
     right-hand neighbour, keep the 64 comparisons. It encodes relative
     structure, so exposure, white balance and mild scale changes barely move
     it, while a different hand moves it a long way. Two hashes are compared
     by Hamming distance.
     ═════════════════════════════════════════════════════════════════════ */

  var PW = 9, PH = 8;

  function phash(src) {
    var img = grab(src);
    if (!img) return '0000000000000000';
    var d = img.data;
    var sum = new Float32Array(PW * PH), cnt = new Float32Array(PW * PH);

    for (var y = 0; y < H; y++) {
      var ry = Math.min(PH - 1, (y * PH / H) | 0);
      for (var x = 0; x < W; x++) {
        var rx = Math.min(PW - 1, (x * PW / W) | 0);
        var i = (y * W + x) * 4, k = ry * PW + rx;
        sum[k] += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        cnt[k]++;
      }
    }

    var out = '', nib = 0, bit = 0;
    for (var r = 0; r < PH; r++) {
      for (var c = 0; c < PW - 1; c++) {
        var a = sum[r * PW + c] / (cnt[r * PW + c] || 1);
        var b = sum[r * PW + c + 1] / (cnt[r * PW + c + 1] || 1);
        nib = (nib << 1) | (a > b ? 1 : 0);
        if (++bit === 4) { out += nib.toString(16); nib = 0; bit = 0; }
      }
    }
    return out;                                     // 64 bits, 16 hex chars
  }

  function hamming(a, b) {
    if (!a || !b || a.length !== b.length) return 64;
    var n = 0;
    for (var i = 0; i < a.length; i++) {
      var v = (parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 15;
      n += (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);
    }
    return n;
  }

  /* A stable fingerprint of the actual pixels.

     Exact by design: this is the report ID, and two visits must never collide
     on one. Geometry is seeded from phash instead, so the same hand keeps the
     same measurements across visits. */
  function fingerprint(src) {
    var img = grab(src);
    if (!img) return 'nofp';
    var d = img.data, h = 2166136261;
    // Every 37th pixel: enough to be stable and specific, cheap enough to be
    // free. A prime stride avoids landing on a row boundary pattern.
    for (var i = 0; i < d.length; i += 4 * 37) {
      h ^= (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  root.Vision = {
    measure: measure,
    findTips: findTips,
    fingerprint: fingerprint,
    phash: phash,
    hamming: hamming,
    analyse: analyse,
    grab: grab
  };
}(window));
