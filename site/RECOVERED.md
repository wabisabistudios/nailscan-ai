# site/ — www.nailscan.ai

Recovered on 31 Aug 2026 by fetching every asset the live site serves, after
it was found that this — the homepage, the white-label scanner, the salon
console and the provisioning screen — existed only in a Cloudflare Pages
project with no source control.

The files are unminified and keep their original comments, so what is here is
the source, not a build artifact. 6,116 lines of JavaScript across 29 files.

    index.html          the sales homepage
    scan/               the white-labelled scanner — four steps, brand switcher
    app/                the salon console — overview, leads, clients, scans, branding
    portal/             provisioning — name, logo, colour with live contrast
                        measurement, typeface, and a live preview of their scanner
    assets/app/*.js     tenant, brand, vision, scanner, report, dashboard,
                        charts, data, portal, zip
    assets/js/*.js      site, cinema, interactive
    assets/fonts/       Geist, Geist Mono, Instrument Serif

Known state at recovery: `assets/app/data.js` is a deterministic mock ledger.
Nothing in here talks to a Worker, to Supabase, or to any API. It is a
front end waiting to be joined to the one in `public/` and `api/`.
