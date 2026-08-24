/* NailScan Try — client-side lighting gate.
 *
 * Requirement #1. The old scanner accepted bad-lighting shots and produced weak
 * reads; the server only noticed after it had already paid for a vision call,
 * and it reported the miss as a "couldn't read" tier rather than as a retake.
 *
 * This runs on the captured frame BEFORE upload. A photo that fails here never
 * leaves the device. Three measurements, one downscaled pass:
 *
 *   meanLuma      Rec. 709 luma, 0..255, averaged. Hard reject when too low.
 *   shadowPct     % of pixels under `shadowLumaCutoff`. Hard reject when too high —
 *                 this is what catches a bright window behind badly lit hands,
 *                 where the mean passes but the nails themselves sit in shadow.
 *   laplacianVar  variance of a 3x3 Laplacian over the luma plane. Blur proxy.
 *                 SOFT WARN ONLY in v1 — it is resolution-dependent and needs
 *                 tuning against real photos before it is allowed to reject.
 *
 * Pure and synchronous apart from the canvas draw. No network, no globals but one.
 */
(function (global) {
  'use strict';

  var DEFAULTS = {
    sampleWidth: 320,
    minMeanLuma: 60,
    shadowLumaCutoff: 25,
    maxShadowPct: 40,
    minLaplacianVar: 55,
    blurWarn: true
  };

  /* Draw `source` (video, image or canvas) into an offscreen canvas at
   * `sampleWidth` and return the luma plane plus its dimensions. */
  function lumaPlane(source, sampleWidth) {
    var sw = source.videoWidth || source.naturalWidth || source.width;
    var sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) throw new Error('gate: source has no dimensions');

    var w = Math.max(16, Math.min(sampleWidth, sw));
    var h = Math.max(16, Math.round(sh * (w / sw)));

    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);

    var px = ctx.getImageData(0, 0, w, h).data;
    var luma = new Float32Array(w * h);
    for (var i = 0, p = 0; i < luma.length; i++, p += 4) {
      // Rec. 709 on sRGB values as displayed — the perceptual quantity a person
      // means by "too dark", not linear-light luminance.
      luma[i] = 0.2126 * px[p] + 0.7152 * px[p + 1] + 0.0722 * px[p + 2];
    }
    return { luma: luma, w: w, h: h };
  }

  function measure(source, cfg) {
    var o = Object.assign({}, DEFAULTS, cfg || {});
    var plane = lumaPlane(source, o.sampleWidth);
    var luma = plane.luma, w = plane.w, h = plane.h, n = luma.length;

    var sum = 0, shadow = 0;
    for (var i = 0; i < n; i++) {
      sum += luma[i];
      if (luma[i] < o.shadowLumaCutoff) shadow++;
    }
    var meanLuma = sum / n;
    var shadowPct = (shadow / n) * 100;

    // 3x3 Laplacian, interior pixels only.
    var lsum = 0, lsq = 0, lcount = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var k = y * w + x;
        var v = luma[k - w] + luma[k + w] + luma[k - 1] + luma[k + 1] - 4 * luma[k];
        lsum += v; lsq += v * v; lcount++;
      }
    }
    var lmean = lcount ? lsum / lcount : 0;
    var laplacianVar = lcount ? (lsq / lcount) - (lmean * lmean) : 0;

    return {
      meanLuma: meanLuma,
      shadowPct: shadowPct,
      laplacianVar: laplacianVar,
      sample: { w: w, h: h }
    };
  }

  /* metrics -> verdict. Separated from measure() so thresholds can be re-run
   * against stored metrics without re-decoding the image. */
  function evaluate(m, cfg) {
    var o = Object.assign({}, DEFAULTS, cfg || {});
    var fails = [];
    var warnings = [];

    if (m.meanLuma < o.minMeanLuma) {
      fails.push({
        code: 'too_dark',
        metric: 'meanLuma',
        value: m.meanLuma,
        limit: o.minMeanLuma
      });
    }
    if (m.shadowPct > o.maxShadowPct) {
      fails.push({
        code: 'shadowed',
        metric: 'shadowPct',
        value: m.shadowPct,
        limit: o.maxShadowPct
      });
    }
    if (o.blurWarn && m.laplacianVar < o.minLaplacianVar) {
      warnings.push({
        code: 'soft_focus',
        metric: 'laplacianVar',
        value: m.laplacianVar,
        limit: o.minLaplacianVar
      });
    }

    return {
      pass: fails.length === 0,
      fails: fails,
      warnings: warnings,
      metrics: m
    };
  }

  function check(source, cfg) {
    return evaluate(measure(source, cfg), cfg);
  }

  global.NailScanGate = {
    DEFAULTS: DEFAULTS,
    lumaPlane: lumaPlane,
    measure: measure,
    evaluate: evaluate,
    check: check
  };
})(window);
