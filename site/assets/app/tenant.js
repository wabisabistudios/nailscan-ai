/* ═══════════════════════════════════════════════════════════════════════════
   TENANT — the one file a white-label build replaces
   ═══════════════════════════════════════════════════════════════════════════

   This file is EMPTY in the reference deployment and that is deliberate. The
   demo site runs the three sample salons out of brand.js and its tenant
   switcher; a salon's own build gets exactly this file rewritten by the
   provisioning portal, and nothing else changes. One file diff between a
   demo and a shipped deployment is the whole white-label claim reduced to
   something you can verify by eye.

   When window.NS_TENANT is set, brand.js drops the sample salons entirely,
   runs single-tenant, and the demo switcher disappears from both the scanner
   and the console. A salon's client must never see another salon's name.

   Shape (all of it optional except id, name and accent):

     window.NS_TENANT = {
       id, name, short, monogram, logo, font, fontData, fontName,
       accent, city, phone, address, site, bookingUrl, currency,
       services: {
         full_set:          { name, price, minutes, rebook },
         tone_prep_set:     { ... },
         edge_rebuild_set:  { ... },
         strength_prep_set: { ... }
       }
     }

   The four service KEYS are fixed — Verdict Core returns one of them and
   nothing else. A salon that does not offer a rebuild points that key at
   whatever it does offer; it cannot delete the key, because then a routed
   client would have nothing to book.
   ═══════════════════════════════════════════════════════════════════════════ */

/* window.NS_TENANT = null; — no tenant baked in; running as the demo. */
