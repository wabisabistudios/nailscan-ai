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
    locale:   'en-US'
  },

  theme: {
    '--porcelain': '#F1EFEA',
    '--paper':     '#FCFBF9',
    '--ink':       '#14120F',
    '--ink-2':     '#63594E',
    '--ink-3':     '#95897C',
    '--line':      'rgba(20,18,15,0.13)',
    '--line-2':    'rgba(20,18,15,0.26)',
    '--lacquer':   '#B0271C',
    '--field':     '#17301F',
    '--amber':     '#C08A22'
  },

  api: {
    // Same-origin in production (Worker is routed at try.nailscan.ai/api/*).
    // Point `base` at the workers.dev URL to run the front-end locally.
    base:    '',
    analyze: '/api/analyze-nails',
    lead:    '/api/lead'
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

  crossLink: {
    label: 'See what this does for your salon',
    href:  'https://go.nailscan.ai/watch'
  },

  legal: 'A cosmetic assessment, not a medical diagnosis. For any health concern, consult a doctor.'
};
