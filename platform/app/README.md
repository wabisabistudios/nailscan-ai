# NailScan Studio — the salon's book

A static single-page app that talks to Supabase directly from the browser.

```
platform/app/
  index.html      three screens: the gate, the book, one client's file
  config.js       white-label boundary — brand, project URL, publishable key
  css/studio.css  the whole design language, no framework
  js/app.js       flow, queries, rendering
  js/vocab.js     finding codes in staff words, and the severity band each sits in
```

## Why there is no server

There isn't one because there doesn't need to be. Every row this app can reach
is decided by row-level security in Postgres — see `platform/supabase/0007_rls.sql`
and the deny-tests beside it. A query here that asked for another salon's clients
comes back empty. That is a property of the database, not of this code behaving
itself, which is the only version of that promise worth making.

The key in `config.js` is the **publishable** key and belongs in a browser. The
secret key is never in this folder, this repo, or any page — only the scanner
Worker holds it, as a Cloudflare secret.

## Deploying

```
wrangler pages deploy platform/app --project-name nailscan-studio
```

Before the first deploy, put the project's publishable key into `config.js`.

## Local

```
python3 -m http.server 8799     # from this folder
```

Sign-in needs a real Supabase project. To work on layout without one, swap the
`createClient` import for a stub that returns fixture rows — the app touches
Supabase in exactly one place.
