/* NailScan Studio — deployment config.
 *
 * WHITE-LABEL BOUNDARY, same idea as the scanner's: this file is the only thing
 * that changes between the NailScan-branded book and a salon-branded install.
 * Authored by us, per deployment, shipped as a static file.
 *
 * The key below is the PUBLISHABLE key and nothing else. It is meant to be in a
 * browser — every row it can reach is decided by row-level security in
 * Postgres, not by keeping this string quiet. The secret key never appears in
 * this repo, in this folder, or on any page.
 */
window.NAILSCAN_STUDIO_CONFIG = {
  supabaseUrl: 'https://rwerqcitegpivpzdjsik.supabase.co',
  supabaseKey: 'PASTE_SB_PUBLISHABLE_KEY',

  brand: {
    mark: 'NailScan',
    name: 'Studio',
    locale: 'en-US'
  },

  /* Where a reading opens when someone taps a photo in the client file. */
  reportBase: 'https://try.nailscan.ai/report'
};
