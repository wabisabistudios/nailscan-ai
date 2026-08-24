# Deploy

Nothing here auto-publishes. Deploys go to a preview URL for approval before the
domain flips.

## Blocked right now — read first

Three things need you, not me:

### 1. Cloudflare account access

The brief targets the **Ad@basedaesthetics.co** account,
`cb9d1952be3e0c9b91c3da6462bac872`. The wrangler OAuth token on this machine is
`wabisabi.chennai@gmail.com` and `wrangler whoami` lists exactly one account:

```
Wabisabi.chennai@gmail.com's Account   6fc1ea596c194da25f8a76d86a324ba4
```

It cannot see the target account, so every `wrangler` command in this repo fails
until you either re-auth as Ad@basedaesthetics.co, or issue a scoped API token on
that account and export it:

```bash
export CLOUDFLARE_API_TOKEN=...
```

Token needs: Workers Scripts (edit), Workers KV (edit), R2 (edit), Pages (edit).

### 2. An Anthropic API key for this Worker

`nailscan-try-api` must have **its own** key, not Based Aesthetics'. Different
product, different billing line, and a leak on the demo must not take the studio
down.

### 3. The GHL inbound webhook

Build the workflow in the **NailScan.ai** sub-account (location
`cj1dKYGBhaLLrI6e0Jkg`) and give me the inbound-webhook URL. Payload shape is at
the bottom of this file.

## A DNS fact that changes the architecture

`nailscan.ai` DNS is hosted **in GoHighLevel, not Cloudflare**. The zone does not
exist in the Cloudflare account, so:

- **A Worker route on `try.nailscan.ai/api/*` is not possible.** Worker routes
  require the zone to be on Cloudflare. This is why `api/wrangler.toml` has no
  `routes` block and uses `workers_dev = true` instead.
- The front-end therefore calls the Worker **cross-origin** at its workers.dev
  URL, which is exactly why `ALLOWED_ORIGINS` matters and why the brief asked for
  the CORS allow-list to gain `https://try.nailscan.ai`.
- Pages custom domains still work fine over a CNAME from external DNS.

If you would rather have same-origin `/api/*`, the options are: move `nailscan.ai`
DNS to Cloudflare, or port the Worker to Pages Functions inside the same project.
Say which and I will do it — the Worker code is unchanged either way.

## Order of operations

### 1. Worker

```bash
cd api
wrangler kv namespace create REPORTS
```

Paste the printed id into `wrangler.toml` and uncomment the block. **REPORTS is
required, not optional** — the scan writes the record there and `POST /api/lead`
reads it back; without it every lead submission returns `unknown_scan`. Records
are permanent, no TTL, ever.

Optional but recommended:

```bash
wrangler kv namespace create RATE_LIMIT     # 12 scans/hr, 20 lead posts/hr per IP
wrangler r2 bucket create nailscan-try-scans
```

Secrets:

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GHL_WEBHOOK_URL
```

Deploy and prove it is live — a real body, not a status code:

```bash
wrangler deploy
curl -s https://nailscan-try-api.<subdomain>.workers.dev/api/health
```

Expect `{"ok":true,"worker":"nailscan-try-api","brand":"NailScan",...}`.

### 2. Point the front-end at the Worker

Set `api.base` in `public/config.js` to the workers.dev origin, then redeploy the
Pages project. Leave `base` empty only if the API ever becomes same-origin.

### 3. Pages — preview first

```bash
cd public
wrangler pages deploy . --project-name=nailscan-try --branch=preview
```

**Deploy from `public/`, never from the repo root.** A parent-directory deploy on
the sibling Based project put the whole site one level down, 404'd every
canonical path, and served Worker source and config as public URLs. `public/` is
kept site-only for exactly this reason — `.assetsignore` does nothing, since it
is a Workers Assets feature that `wrangler pages deploy` ignores outright.

Review the preview URL. On approval:

```bash
wrangler pages deploy . --project-name=nailscan-try --branch=main
```

`main` is the production branch. Anything else is recorded as Preview and never
reaches the apex.

### 4. DNS

In GHL: **Settings → Domains → nailscan.ai → DNS records**. Add `try` as a CNAME
to `nailscan-try.pages.dev`, matching the existing `go` and `www` records. Then
add `try.nailscan.ai` as a custom domain on the Pages project so Cloudflare
issues the certificate.

### 5. Verify

Cache-bust with a **unique random** value per request — a reused buster gets
cached too and will happily show you a stale file:

```bash
curl -s "https://try.nailscan.ai/?bust=$RANDOM$RANDOM" | grep -o '<title>.*</title>'
```

Check the response **body**, never the status code.

## The GHL payload

One event, `nailscan_try_lead`, fired from `POST /api/lead`. Keys are snake_case;
the key→field mapping lives inside the GHL workflow, same convention as the
existing scanner. No custom-field IDs in the code.

```jsonc
{
  "event": "nailscan_try_lead",
  "source": "try-demo",
  "name": "...", "salon": "...", "email": "...",
  "phone": "+17135550142",          // E.164, normalised against `country`
  "country": "US",
  "consent": true, "consented_at": "ISO",
  "tags": "demo,try-scan,nail-scan-manageable,wear-gel,finding-peeling_free_edge,...",
  "scan_id": "k3f9a2p",
  "tier": "manageable", "wear": "gel", "scan_score": "manageable",
  "scan_result": "...", "scan_conditions": "... | ...", "scan_summary": "...",
  "scan_recommendation": "...", "recommended_service": "...",
  "next_action_date": "2026-09-21", "grown_out_date": "2026-11-02",
  "scan_image_url": "...", "report_url": "https://try.nailscan.ai/report?id=...",
  "scanned_at": "ISO", "submitted_at": "ISO"
}
```

The workflow should file the contact plus an Opportunity (NailScan 28 pipeline,
New lead, $798 context) and start the Maya five-minute call branch.

**Build the Maya branch DISABLED**, with:

- a calling-hours guard — call only inside the region agent's window, otherwise
  queue to the next opening;
- area-code routing across East / Pacific / Mountain;
- v1 calls every scanner, no purchase check yet;
- the first-ever call routed to Bit Mystic's own number as the test.

Note the ordering consequence of putting the form at the report reveal: a visitor
who scans and leaves before submitting produces **no lead at all**. The original
scanner captured the lead before the vision call precisely so a model failure
still left a contact. This build trades that for a lower-friction funnel, which
is what the brief asks for — but it is a real trade, and the scan record still
exists in KV under its id if you ever want to reconcile abandoned scans.
