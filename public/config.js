/* NailScan Try — deployment config.
 *
 * WHITE-LABEL BOUNDARY. This object is the only thing that changes between a
 * NailScan-branded demo and a salon-branded install. It is authored by us, per
 * deployment, and shipped as a static file. Nothing here is editable by the
 * client, and nothing in the app reads branding from anywhere else.
 *
 * `theme` keys are written straight onto :root as CSS custom properties, so a
 * new palette needs no CSS edit.
 */
window.NAILSCAN_CONFIG = {
  brand: {
    name:     'NailScan',
    mark:     'NAILSCAN',
    unit:     'FIELD UNIT 01',              // mono eyebrow, top left
    intro:    'Photograph your nails. Get the reading your clients would get.',
    logo:     null,                          // optional URL; falls back to the wordmark
    locale:   'en-US',
    // Identifies this install inside the calendar files it produces. Stable for
    // the life of a deployment: change it and every event already in somebody's
    // phone stops matching, so her next download duplicates instead of updating.
    domain:   'nailscan.ai'
  },

  /* The palette is NOT client-configurable, and that is a decision rather than
   * an omission. What a salon is buying is an instrument; instruments carry
   * their maker's livery, and a reading that says "worth a check" holds
   * authority in NailScan's colours that it loses in a salon's own pink.
   *
   * A salon gets its name, its logo, its services and its booking links — the
   * content is theirs. The chassis is ours. Anything set here is still written
   * onto :root at boot, so a one-off override remains possible; the default is
   * deliberately empty.
   */
  theme: {},

  api: {
    // Same-origin in production (Worker is routed at try.nailscan.ai/api/*).
    // Point `base` at the workers.dev URL to run the front-end locally.
    base:    'https://nailscan-try-api.maya-bff.workers.dev',
    analyze: '/api/analyze-nails',
    lead:    '/api/lead',
    plan:    '/api/plan'
  },

  /* Client-side lighting gate. A photo that fails never leaves the device.
   * Thresholds are luma units on 0..255 (Rec. 709) unless noted.
   * Tune these against real photos — they are deliberately in config, not code. */
  gate: {
    sampleWidth:      320,   // downscale before measuring; keeps the pass instant
    minMeanLuma:      60,    // reject below
    shadowLumaCutoff: 25,    // "shadow" pixel definition
    maxShadowPct:     40,    // reject when more than this % of pixels are shadow
    minLaplacianVar:  55,    // BELOW THIS = soft warn only in v1, never a reject
    blurWarn:         true
  },

  capture: {
    facingMode:   'environment',
    idealWidth:   1440,
    uploadMaxKb:  500,       // JPEG re-encode target before upload
    uploadMaxPx:  1280
  },

  lead: {
    consent: 'By submitting, you agree NailScan may contact you about your scan.',
    countries: [
      { code: 'US', dial: '+1',  label: 'United States' },
      { code: 'CA', dial: '+1',  label: 'Canada' },
      { code: 'GB', dial: '+44', label: 'United Kingdom' },
      { code: 'AU', dial: '+61', label: 'Australia' },
      { code: 'IN', dial: '+91', label: 'India' }
    ],
    defaultCountry: 'US'
  },

  /* ------------------------------------------------------------- the plan --
   * What the interactive calendar is built from.
   *
   * `weeks` is how long each finish actually looks good for before it starts
   * lifting or showing grow-out — the point at which rebooking protects the
   * natural nail rather than just refreshing the colour. These are a salon's
   * numbers and belong to the salon: retune them here, never in code.
   *
   * `why` is shown to the client on the calendar entry. It is the difference
   * between a date she trusts and a date she ignores.
   */
  plan: {
    services: [
      { slug: 'gel-polish', label: 'Gel polish', weeks: 3,
        rebookLabel: 'Next gel appointment',
        why: 'Around three weeks is where gel stops looking fresh and starts lifting at the edges. Booking before that is what keeps the nail underneath intact \u2014 a lifted edge that catches is how the layers come away.' },
      { slug: 'gel-extensions', label: 'Gel extensions', weeks: 3,
        rebookLabel: 'Next fill',
        why: 'Extensions need a fill about every three weeks. Left longer, the balance point moves past the fingertip and the whole set starts levering on your own nail.' },
      { slug: 'poly-gel', label: 'Poly gel', weeks: 3,
        rebookLabel: 'Next fill',
        why: 'Poly gel holds beautifully for about three weeks. After that the grown-out base is doing the work, and that is where breaks start.' },
      { slug: 'acrylic', label: 'Acrylic', weeks: 3,
        rebookLabel: 'Next fill',
        why: 'A fill every three weeks or so. The gap at the base is the weak point \u2014 the longer it gets, the more leverage on the plate underneath.' },
      { slug: 'biab', label: 'BIAB', weeks: 4,
        rebookLabel: 'Next BIAB appointment',
        why: 'BIAB is the long one \u2014 about four weeks. It is doing structural work, so the appointment is a re-balance rather than a redo.' },
      { slug: 'classic-manicure', label: 'Classic manicure', weeks: 2,
        rebookLabel: 'Next manicure',
        why: 'Regular polish gives you a good two weeks. This is maintenance rather than repair \u2014 move it freely.' },
      { slug: 'gel-pedicure', label: 'Gel pedicure', weeks: 6,
        rebookLabel: 'Next gel pedicure',
        why: 'Toes grow far slower than fingers. Six weeks is normal, and pushing well past it is where thickening and ingrowth start.' },
      { slug: 'pedicure', label: 'Pedicure', weeks: 5,
        rebookLabel: 'Next pedicure',
        why: 'About five weeks. Less about the polish, more about keeping the skin and the nail edge in good order.' },
      { slug: 'press-on', label: 'Press-ons', weeks: 0,
        why: 'Press-ons come off on your own schedule \u2014 nothing to book.' },
      { slug: '', label: 'Nothing today', weeks: 0 }
    ],

    /* How often she actually comes in. Bends the interval and decides how far
       ahead the calendar projects \u2014 nobody wants four appointments from a
       studio they visit twice a year. */
    rhythms: [
      { slug: 'often',  label: 'Every couple of weeks', factor: 0.85, repeats: 3 },
      { slug: 'usual',  label: 'About once a month',    factor: 1.00, repeats: 2 },
      { slug: 'rarely', label: 'Now and then',          factor: 1.25, repeats: 1 }
    ],
    defaultRhythm: 'usual',

    /* Days before an event to aim the appointment at. Two to five days out:
       past the setting window, short of any grow-out. */
    eventLeadDays: 3,

    /* --------------------------------------------------------- home care --
     *
     * Reminders she can put in her phone. The bar for being on this list is
     * that it CHANGES WHAT SHE DOES \u2014 "use cuticle oil" is not a reminder,
     * it is a thing she already knows and already ignores. Every line here is
     * either a piece of timing she is probably getting wrong, or a fact that
     * reverses what she currently believes.
     *
     * Two rules for anything added here:
     *   1. It is a BEHAVIOUR, never a supplement, a diagnosis, or a dose.
     *      Biotin is deliberately absent: it does nothing outside real
     *      deficiency, and it skews thyroid and cardiac blood tests \u2014 a nail
     *      studio has no business recommending it.
     *   2. It says WHY in one sentence. A reminder without a reason gets
     *      deleted in week two, and takes the brand with it.
     *
     * `on` is whether it starts ticked. Keep that list short \u2014 a picker where
     * everything is pre-selected is not a choice, it is a default nobody read.
     */
    habits: [
      { slug: 'oil-damp', label: 'Oil while your nails are still damp',
        line: 'One drop, at night, straight after you wash.',
        why: 'Almost everyone oils dry nails, where most of it sits on the surface and wipes off. A nail that has just been in water is swollen and open \u2014 oil goes in. Jojoba is the one worth buying: its molecules are small enough to actually reach the plate rather than sit on it.',
        cadence: 'daily', time: '21:00', weeks: 8, on: true },

      { slug: 'no-file-after-bath', label: 'File before a shower, never after',
        line: 'Wet nails tear instead of cutting cleanly.',
        why: 'Nails absorb far more water than skin does and swell while they are wet. Filing or clipping a swollen nail leaves a ragged edge that peels back as it dries \u2014 which is where a lot of "my nails just split" comes from. Give it an hour.',
        cadence: 'weekly', day: 0, time: '10:00', weeks: 8, on: true },

      { slug: 'sanitiser-cream', label: 'Cream after sanitiser, not just after soap',
        line: 'Alcohol gel strips more than soap does.',
        why: 'Hand gel takes the oils out of the plate faster than washing does, and most people use it far more often. The bottle by the door needs a hand cream sitting next to it.',
        cadence: 'weekly', day: 1, time: '10:00', weeks: 8, on: false },

      { slug: 'hardener-check', label: 'Check your nail hardener for formaldehyde',
        line: 'The fix that makes it worse by week three.',
        why: 'Formaldehyde hardeners work beautifully for a fortnight \u2014 they cross-link the plate, and it feels strong. Kept up, that same cross-linking makes the nail rigid and brittle, so it shatters instead of bending. If the label says formaldehyde or tosylamide, that is the bottle to retire.',
        cadence: 'once', inDays: 2, time: '18:00', on: false },

      { slug: 'push-never-cut', label: 'Push back, never cut',
        line: 'The fold at the base is a seal, not a cuticle.',
        why: 'That rim of skin is what keeps bacteria out of the nail matrix. Cutting it is the most common way a cosmetic nail problem turns into a medical one \u2014 and it is the thing this scan flags for.',
        cadence: 'weekly', day: 3, time: '19:00', weeks: 8, on: false },

      { slug: 'lamp-spf', label: 'Sunscreen on your hands before the lamp',
        line: 'Thirty seconds, before every gel appointment.',
        why: 'A gel lamp is a UV source held very close to the backs of your hands, repeatedly, for years. The nails are fine; the skin around them is what ages. Sunscreen or fingerless gloves, either works.',
        cadence: 'once', inDays: 5, time: '18:00', on: false,
        when: { wear: ['gel', 'acrylic', 'extensions'] } },

      { slug: 'short-while-recovering', label: 'Keep them short until it has grown past',
        line: 'Length is leverage on a plate that is already thin.',
        why: 'Every millimetre past the fingertip multiplies the force on the weakest part of the nail. Short is not a compromise while you recover \u2014 it is the thing that lets the damage grow out instead of re-tearing.',
        cadence: 'weekly', day: 6, time: '10:00', weeks: 8, on: false,
        when: { tier: ['manageable'] } }
    ],

    /* Daily reminders that never end get deleted, and the brand goes with them.
       Eight weeks is roughly one growth cycle: long enough to become a habit,
       short enough to feel like a course rather than a subscription. */
    habitWeeks: 8
  },

  crossLink: {
    label: 'See what this does for your salon',
    href:  'https://go.nailscan.ai/watch'
  },

  legal: 'A cosmetic assessment, not a medical diagnosis. For any health concern, consult a doctor.'
};
