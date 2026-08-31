/* ═══════════════════════════════════════════════════════════════════════════
   BRAND — the white-label layer
   ═══════════════════════════════════════════════════════════════════════════

   Both the scanner and the dashboard read this file and NOTHING else for
   identity. Standing up a new salon is one object in SALONS plus a logo; no
   markup, no CSS, no build step. That is the whole white-label claim, and it
   has to survive contact with a salon owner who wants their own colour.

   Why the derived colours are computed rather than authored: an owner picks
   ONE hex in the settings screen. Every hover state, glow, focus ring and
   translucent wash has to follow from it, and asking them for nine hexes would
   turn a two-minute setup into a support call.

   The service menu lives here too, because the routing rules in Verdict Core
   return a service KEY, never a price. The salon owns the prices. Two salons
   can run identical logic and quote different numbers, which is exactly what
   a $95 studio and a $180 studio both need.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (root) {
  'use strict';

  /* ---------------------------------------------------------------------
     Colour helpers. Everything derives from one accent hex.
     --------------------------------------------------------------------- */

  function hex2rgb(h) {
    h = h.replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgb2hex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    }).join('');
  }

  // Mix toward white (t > 0) or black (t < 0). Perceptually rough but stable,
  // and it never produces the muddy midpoint that a naive HSL lighten does.
  function shade(hex, t) {
    var c = hex2rgb(hex), to = t > 0 ? 255 : 0, a = Math.abs(t);
    return rgb2hex(c[0] + (to - c[0]) * a, c[1] + (to - c[1]) * a, c[2] + (to - c[2]) * a);
  }

  function rgba(hex, a) {
    var c = hex2rgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  // Relative luminance, for deciding whether text on the accent should be
  // black or white. A salon that picks pale yellow must not get white-on-yellow.
  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  function luminance(hex) {
    return hex2rgb(hex).map(function (v) {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }).reduce(function (a, v, i) { return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }

  /* ---------------------------------------------------------------------
     The service menu.

     Keys are FIXED — Verdict Core returns one of these four and nothing else.
     Names and prices are the salon's. A salon that does not offer a rebuild
     can point that key at whatever it does offer; it cannot delete the key,
     because then a routed client would have nothing to book.
     --------------------------------------------------------------------- */

  var SERVICE_KEYS = ['full_set', 'tone_prep_set', 'edge_rebuild_set', 'strength_prep_set'];

  /* ---------------------------------------------------------------------
     Typefaces.

     Four stacks that need no network, plus 'custom' for an uploaded file.
     Everything here has to work offline in a salon with bad wifi, so no
     preset reaches for a font CDN — a webfont that fails to load silently
     reflows the whole report on the client's phone.
     --------------------------------------------------------------------- */

  var FONTS = {
    'default': {
      label: 'NailScan default',
      ui: '"UI", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      display: '"Display", "Iowan Old Style", Georgia, serif'
    },
    'system': {
      label: 'System sans',
      ui: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      display: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
    },
    'serif': {
      label: 'Classic serif',
      ui: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif',
      display: 'Georgia, "Iowan Old Style", "Times New Roman", serif'
    },
    'mono': {
      label: 'Technical',
      ui: '"Data", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      display: '"Data", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    }
  };

  /* ---------------------------------------------------------------------
     The salons. `demo` is the reference tenant used in every screenshot.
     --------------------------------------------------------------------- */

  var SALONS = {
    demo: {
      id: 'demo',
      name: 'Lumière Nail Studio',
      short: 'Lumière',
      monogram: 'L',
      logo: null,          // data URL; replaces the monogram when set
      font: 'default',     // key into FONTS, or 'custom' with fontData
      fontData: null,
      fontName: null,
      accent: '#FF5233',
      city: 'Houston, TX',
      phone: '(713) 555-0142',
      address: '2210 Westheimer Rd, Houston, TX 77098',
      site: 'lumierenails.com',
      bookingUrl: '#book',
      currency: '$',
      services: {
        full_set:          { name: 'Full gel set',              price: 95,  minutes: 75,  rebook: 4 },
        tone_prep_set:     { name: 'Tone-correcting prep + set', price: 130, minutes: 95,  rebook: 4 },
        edge_rebuild_set:  { name: 'Edge rebuild + set',         price: 145, minutes: 105, rebook: 5 },
        strength_prep_set: { name: 'Strengthening prep + set',   price: 140, minutes: 100, rebook: 4 }
      }
    },

    aurelia: {
      id: 'aurelia',
      name: 'Aurelia Beauty Bar',
      short: 'Aurelia',
      monogram: 'A',
      logo: null, font: 'serif', fontData: null, fontName: null,
      accent: '#C9A227',
      city: 'Los Angeles, CA',
      phone: '(323) 555-0188',
      address: '8420 Melrose Ave, Los Angeles, CA 90069',
      site: 'aureliabeautybar.com',
      bookingUrl: '#book',
      currency: '$',
      services: {
        full_set:          { name: 'Signature gel set',        price: 140, minutes: 80,  rebook: 4 },
        tone_prep_set:     { name: 'Brightening prep + set',    price: 185, minutes: 100, rebook: 4 },
        edge_rebuild_set:  { name: 'Structural rebuild + set',  price: 210, minutes: 110, rebook: 5 },
        strength_prep_set: { name: 'Fortifying prep + set',     price: 195, minutes: 105, rebook: 4 }
      }
    },

    kova: {
      id: 'kova',
      name: 'KOVA Nail Lab',
      short: 'KOVA',
      monogram: 'K',
      logo: null, font: 'system', fontData: null, fontName: null,
      accent: '#3B82F6',
      city: 'Houston, TX',
      phone: '(281) 555-0119',
      address: '1105 Studemont St, Houston, TX 77007',
      site: 'kovanaillab.com',
      bookingUrl: '#book',
      currency: '$',
      services: {
        full_set:          { name: 'Lab set',              price: 78,  minutes: 60, rebook: 3 },
        tone_prep_set:     { name: 'Tone reset + lab set',  price: 105, minutes: 80, rebook: 3 },
        edge_rebuild_set:  { name: 'Rebuild + lab set',     price: 118, minutes: 90, rebook: 4 },
        strength_prep_set: { name: 'Strength + lab set',    price: 112, minutes: 85, rebook: 4 }
      }
    }
  };

  /* ---------------------------------------------------------------------
     A BAKED-IN TENANT.

     tenant.js runs before this file. If it set window.NS_TENANT, this is a
     salon's own build rather than the demo: the three sample salons are
     removed from the registry entirely and the switcher disappears from both
     products. Removing them rather than merely defaulting past them matters —
     a salon's client must never be one URL parameter away from a competitor's
     name and prices.

     SALONS is mutated in place, never reassigned, because it is exported by
     reference on root.Brand.
     --------------------------------------------------------------------- */

  var DEFAULT_ID = 'demo';
  var single = false;

  /* A frozen copy of the reference menu, taken BEFORE anything can remove it.
     adopt() reads it to fill in whatever a tenant left blank, and it used to
     read SALONS.demo directly — which adopt() itself had just deleted. The
     first adopt worked and every one after it threw, so the portal's live
     preview updated once and then silently stopped. */
  var REFERENCE_SERVICES = JSON.parse(JSON.stringify(SALONS.demo.services));

  var DEFAULTS = {
    short: null, monogram: null, logo: null, font: 'default', fontData: null,
    fontName: null, city: '', phone: '', address: '', site: '',
    bookingUrl: '#book', currency: '$'
  };

  function adopt(t) {
    if (!t || !t.id || !t.name || !t.accent) return false;
    var s = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      s[k] = t[k] === undefined || t[k] === null || t[k] === '' ? DEFAULTS[k] : t[k];
    });
    s.id = t.id; s.name = t.name; s.accent = t.accent;
    if (!s.short) s.short = t.name.split(/[\s—-]+/)[0];
    if (!s.monogram) s.monogram = s.short.charAt(0).toUpperCase();

    // Every service key must exist and carry a number, whatever the portal
    // sent. A missing price renders "$NaN" on the one card the whole funnel
    // ends at, so the fallback is the reference tenant's own menu.
    var base = REFERENCE_SERVICES;
    s.services = {};
    SERVICE_KEYS.forEach(function (k) {
      var v = (t.services && t.services[k]) || {};
      s.services[k] = {
        name: v.name || base[k].name,
        price: Number(v.price) >= 0 ? Number(v.price) : base[k].price,
        minutes: Number(v.minutes) > 0 ? Number(v.minutes) : base[k].minutes,
        rebook: Number(v.rebook) > 0 ? Number(v.rebook) : base[k].rebook
      };
    });

    Object.keys(SALONS).forEach(function (k) { delete SALONS[k]; });
    SALONS[s.id] = s;
    DEFAULT_ID = s.id;
    single = true;
    return true;
  }

  /* ---------------------------------------------------------------------
     Applying a brand.

     Writes CSS custom properties onto <html>. Everything downstream is
     authored against var(--accent) and friends, so a brand change is one
     repaint with no reflow and no re-render.
     --------------------------------------------------------------------- */

  var current = null;

  function apply(salon, doc) {
    doc = doc || document;
    var s = doc.documentElement.style;
    var a = salon.accent;

    s.setProperty('--accent', a);
    s.setProperty('--accent-hi', shade(a, 0.18));
    s.setProperty('--accent-lo', shade(a, -0.24));
    s.setProperty('--accent-glow', rgba(a, 0.14));
    s.setProperty('--accent-line', rgba(a, 0.32));
    s.setProperty('--accent-wash', rgba(a, 0.07));
    // Pick the label colour by MEASURED contrast, not by a luminance guess.
    // A luminance threshold put white on #FF5233 at 3.2:1 — a real AA failure
    // on the primary button of every screen. Black on that same orange is
    // 6.1:1, and it matches how the marketing site already draws its buttons.
    s.setProperty('--on-accent', contrast(a, '#0A0B0D') >= contrast(a, '#FFFFFF') ? '#0A0B0D' : '#FFFFFF');

    applyFont(salon, doc);

    doc.title = doc.title.replace(/^[^—]*—/, salon.name + ' —');
    current = salon;
    doc.documentElement.setAttribute('data-salon', salon.id);
    try {
      doc.dispatchEvent(new CustomEvent('brandchange', { detail: salon }));
    } catch (e) { /* older engines: listeners just do not fire */ }
    return salon;
  }

  /* An uploaded font is registered once per document under a fixed family
     name, so swapping the file re-points the same name and every element
     using it re-renders without touching a single rule. */
  function applyFont(salon, doc) {
    var st = doc.documentElement.style;
    var preset = FONTS[salon.font] || FONTS['default'];

    if (salon.font === 'custom' && salon.fontData) {
      var tag = doc.getElementById('ns-tenant-font');
      if (!tag) {
        tag = doc.createElement('style');
        tag.id = 'ns-tenant-font';
        (doc.head || doc.documentElement).appendChild(tag);
      }
      tag.textContent = '@font-face{font-family:"TenantFont";' +
        'src:url(' + salon.fontData + ');font-weight:100 900;font-display:swap;}';
      st.setProperty('--sans', '"TenantFont", ' + FONTS['default'].ui);
      st.setProperty('--display', '"TenantFont", ' + FONTS['default'].display);
    } else {
      st.setProperty('--sans', preset.ui);
      st.setProperty('--display', preset.display);
    }
  }

  /* Paint the salon's mark wherever a lockup is. An uploaded logo replaces the
     monogram tile entirely — including its gradient, which would otherwise
     tint a transparent PNG. */
  function paintMark(node, salon) {
    salon = salon || current;
    if (!salon) return;
    if (salon.logo) {
      node.classList.add('has-logo');
      node.innerHTML = '<img src="' + salon.logo + '" alt="">';
    } else {
      node.classList.remove('has-logo');
      node.textContent = salon.monogram;
    }
  }

  /* Resolve which salon to run as. Order: explicit ?salon=, then whatever the
     settings screen last saved, then the demo tenant. The URL wins so a rep
     can send a prospect a link that opens already wearing their brand. */
  function resolve() {
    var q = null;
    try {
      q = new URLSearchParams(location.search).get('salon');
    } catch (e) { /* no URLSearchParams: fall through to storage */ }
    var saved = null;
    try { saved = sessionStorage.getItem('ns.salon'); } catch (e) { /* private mode */ }
    return SALONS[q] || SALONS[saved] || SALONS[DEFAULT_ID];
  }

  function set(id) {
    var salon = SALONS[id];
    if (!salon) return current;
    try { sessionStorage.setItem('ns.salon', id); } catch (e) { /* private mode */ }
    return apply(salon);
  }

  /* Live edit from the settings screen. Does not persist to SALONS — this is
     a mockup, and a real deployment would PATCH the tenant record here. */
  function patch(fields) {
    if (!current) return;
    Object.keys(fields).forEach(function (k) {
      if (k === 'services') Object.assign(current.services, fields.services);
      else current[k] = fields[k];
    });
    return apply(current);
  }

  function money(n, salon) {
    salon = salon || current || SALONS[DEFAULT_ID];
    return salon.currency + Number(n).toLocaleString('en-US');
  }

  // Run last, so a baked tenant can fall back to the reference service menu
  // for anything the portal left blank.
  adopt(root.NS_TENANT);

  root.Brand = {
    SALONS: SALONS,
    adopt: adopt,
    get single() { return single; },
    get defaultId() { return DEFAULT_ID; },
    SERVICE_KEYS: SERVICE_KEYS,
    FONTS: FONTS,
    applyFont: applyFont,
    paintMark: paintMark,
    apply: apply,
    resolve: resolve,
    set: set,
    patch: patch,
    money: money,
    shade: shade,
    rgba: rgba,
    get current() { return current; }
  };
}(window));
