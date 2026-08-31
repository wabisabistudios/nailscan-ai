/* The finding vocabulary, in salon words.
 *
 * The Worker owns the closed code list and the client-facing sentence for each
 * one. This file is the STAFF-facing half: a short label a technician can scan
 * down a column, and the severity band that decides the dot.
 *
 * Codes must stay in step with api/src/index.js. Anything unknown renders as
 * its raw code rather than disappearing — a silent drop on a client file is
 * worse than an ugly one.
 */

export const FINDING_LABEL = {
  ridging_vertical:     'Vertical ridging',
  grooves_longitudinal: 'Lengthwise grooves',
  lines_transverse:     'Lines across the plate',
  peeling_free_edge:    'Peeling tips',
  splitting_lateral:    'Side split',
  white_spots_surface:  'White patches',
  surface_rough_patches:'Rough surface',
  thinning_plate:       'Thin plate',
  dryness_dull:         'Dry and dull',
  micro_cracks:         'Hairline cracks',
  breakage_chips:       'Chips and breaks',
  cuticle_dry:          'Dry cuticles',
  cuticle_overgrown:    'Overgrown cuticles',
  cuticle_picked:       'Picked cuticles',
  shape_uneven_length:  'Uneven lengths',
  polish_grow_out:      'Grow-out',
  staining_yellow_mild: 'Mild staining',
  healthy_plate:        'Healthy plate',
  healthy_cuticle:      'Healthy cuticles',
  even_structure:       'Even structure'
};

/* Mirrors the copy bank's mark colour: the findings it marks red are the ones
 * that mean damage rather than dryness. */
const RED = new Set([
  'peeling_free_edge','splitting_lateral','white_spots_surface','surface_rough_patches',
  'thinning_plate','micro_cracks','breakage_chips','cuticle_picked'
]);

export function findingBand(code, isPositive) {
  if (isPositive) return 'good';
  return RED.has(code) ? 'serious' : 'note';
}

export const FLAG_LABEL = {
  pigment_band_dark:          'Dark band in the plate',
  onycholysis_lifting:        'Plate lifting from the bed',
  lifting_with_discoloration: 'Lifting with colour change',
  green_discoloration:        'Green tint',
  plate_crumbling:            'Crumbling plate',
  fold_inflammation_pus:      'Inflamed nail fold',
  blisters_fluid:             'Fluid blisters',
  exposed_bed_or_bleeding:    'Exposed bed or bleeding',
  pitting_oil_drop_debris:    'Pitting with oil-drop patches'
};

export const TIER_LABEL = {
  healthy:    'Healthy',
  manageable: 'A little love',
  medical:    'Worth a check',
  unclear:    'Unreadable'
};
