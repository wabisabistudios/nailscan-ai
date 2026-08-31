/* ═══════════════════════════════════════════════════════════════════════════
   ZIP — a deployable archive, written in the browser
   ═══════════════════════════════════════════════════════════════════════════

   The provisioning portal has to hand back a file you can drag onto
   Cloudflare Pages. That means a real ZIP, and the options were: a server (a
   deploy pipeline to run and pay for, and a thing that can be down when a rep
   is mid-call), a CDN library (a third-party script on the one page that
   builds our customers' products), or ninety lines here.

   This is ninety lines here.

   Store-only — no DEFLATE. It is a legal ZIP either way, and the payload is
   already-compressed woff2, jpg and png plus a few hundred KB of text; the
   compression that matters happens on the wire when the salon's own visitors
   fetch the files, which Cloudflare does for us. Skipping it removes the
   CompressionStream feature-detect and any chance of a corrupt archive from a
   half-supported API.

   Two details that are easy to get wrong and produce an archive that opens
   fine in macOS Finder and fails everywhere else:

     · CRC-32 must be computed over the RAW bytes, and it appears in BOTH the
       local file header and the central directory. They have to agree.
     · Offsets in the central directory are counted from the start of the
       whole archive, not from the start of the file data.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  // Standard CRC-32 table (reversed polynomial 0xEDB88320), built once.
  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  }());

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  var enc = new TextEncoder();

  /* MS-DOS date and time. Two 16-bit fields, and the year is offset from
     1980 — a ZIP stamped with a raw year opens with a date in 3906. */
  function dosStamp(d) {
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31),
      date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
    };
  }

  function W(view, off, val, bytes) {
    for (var i = 0; i < bytes; i++) view.setUint8(off + i, (val >>> (i * 8)) & 0xFF);
  }

  /* files: [{ name: 'assets/app/tenant.js', data: Uint8Array | string }]
     Returns a Blob. Directory entries are implied by the paths, which is what
     every unzipper and Cloudflare's own uploader expects. */
  function build(files, when) {
    var stamp = dosStamp(when || new Date(2026, 0, 1, 12, 0, 0));

    var entries = files.map(function (f) {
      var data = typeof f.data === 'string' ? enc.encode(f.data)
               : f.data instanceof Uint8Array ? f.data
               : new Uint8Array(f.data);
      // Paths are stored UTF-8; bit 11 of the general-purpose flags says so,
      // and without it a salon name with an accent in a filename mojibakes.
      var name = enc.encode(f.name.replace(/^\.?\//, ''));
      return { name: name, data: data, crc: crc32(data), offset: 0 };
    });

    var LOCAL = 30, CENTRAL = 46, END = 22;
    var localSize = entries.reduce(function (a, e) { return a + LOCAL + e.name.length + e.data.length; }, 0);
    var centralSize = entries.reduce(function (a, e) { return a + CENTRAL + e.name.length; }, 0);

    var out = new Uint8Array(localSize + centralSize + END);
    var dv = new DataView(out.buffer);
    var p = 0;

    entries.forEach(function (e) {
      e.offset = p;
      W(dv, p, 0x04034B50, 4);              // local file header signature
      W(dv, p + 4, 20, 2);                  // version needed
      W(dv, p + 6, 0x0800, 2);              // flags: UTF-8 names
      W(dv, p + 8, 0, 2);                   // method: stored
      W(dv, p + 10, stamp.time, 2);
      W(dv, p + 12, stamp.date, 2);
      W(dv, p + 14, e.crc, 4);
      W(dv, p + 18, e.data.length, 4);      // compressed size
      W(dv, p + 22, e.data.length, 4);      // uncompressed size
      W(dv, p + 26, e.name.length, 2);
      W(dv, p + 28, 0, 2);                  // extra field length
      out.set(e.name, p + LOCAL);
      out.set(e.data, p + LOCAL + e.name.length);
      p += LOCAL + e.name.length + e.data.length;
    });

    var centralStart = p;
    entries.forEach(function (e) {
      W(dv, p, 0x02014B50, 4);              // central directory signature
      W(dv, p + 4, 20, 2);                  // version made by
      W(dv, p + 6, 20, 2);                  // version needed
      W(dv, p + 8, 0x0800, 2);
      W(dv, p + 10, 0, 2);
      W(dv, p + 12, stamp.time, 2);
      W(dv, p + 14, stamp.date, 2);
      W(dv, p + 16, e.crc, 4);
      W(dv, p + 20, e.data.length, 4);
      W(dv, p + 24, e.data.length, 4);
      W(dv, p + 28, e.name.length, 2);
      W(dv, p + 30, 0, 2);                  // extra
      W(dv, p + 32, 0, 2);                  // comment
      W(dv, p + 34, 0, 2);                  // disk number
      W(dv, p + 36, 0, 2);                  // internal attrs
      W(dv, p + 38, 0, 4);                  // external attrs
      W(dv, p + 42, e.offset, 4);           // offset from the START of the archive
      out.set(e.name, p + CENTRAL);
      p += CENTRAL + e.name.length;
    });

    W(dv, p, 0x06054B50, 4);                // end of central directory
    W(dv, p + 4, 0, 2);
    W(dv, p + 6, 0, 2);
    W(dv, p + 8, entries.length, 2);
    W(dv, p + 10, entries.length, 2);
    W(dv, p + 12, centralSize, 4);
    W(dv, p + 16, centralStart, 4);
    W(dv, p + 20, 0, 2);                    // comment length

    return new Blob([out], { type: 'application/zip' });
  }

  function save(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    // Appended to the document before the click: Firefox ignores a click on a
    // detached anchor, which is a download button that silently does nothing.
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  root.Zip = { build: build, save: save, crc32: crc32 };
}(window));
