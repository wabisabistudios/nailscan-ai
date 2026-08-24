# API contract — the existing nail scanner

Extracted 2026-08-24 from source, not from the live HTML. Sources of truth:

- Worker: `~/Desktop/Based Web Final/based_nail_worker/src/index.js` (745 lines) + `wrangler.toml`
- Front-end: `~/Desktop/Based Web Final/based_final_v2/scan.html`

## Correction to the brief

The brief points at `https://basedaesthetics.co/scanner`. That page (`scanner.html`, 80 KB) is the
**marketing page** for the scanner — it contains zero `fetch` calls and no API contract. The working
scanner front-end is **`/scan`** (`scan.html`, 62 KB); `/scan-direct` is the staff, in-studio variant.
Everything below comes from those.

## Deployment shape (existing)

| Piece | Value |
|---|---|
| Worker name | `based-nail-scanner` |
| Route | `basedaesthetics.co/api/*` (zone `basedaesthetics.co`) |
| Account | `wabisabi.chennai@gmail.com` — `6fc1ea596c194da25f8a76d86a324ba4` |
| Vision model | `claude-sonnet-4-6` (`VISION_MODEL` var) |
| Secrets | `ANTHROPIC_API_KEY`, `GHL_WEBHOOK_URL`, `GHL_RESULT_WEBHOOK_URL` |
| KV | `REPORTS` `0408e9e3ef0b495fa1b90583642e4593` — records are **permanent, no TTL** |
| KV | `RATE_LIMIT` — optional, commented out; code path is 12 req/IP/hour |
| R2 | `SCANS` → bucket `based-scans` |
| CORS | `ALLOWED_ORIGINS` var, comma-separated. Unlisted origins get **allowed[0] echoed back**, not a reject |

## Endpoints

### `POST /api/analyze-nails` — the one that matters

Request `Content-Type: application/json`:

```jsonc
{
  "image":   "data:image/jpeg;base64,...",  // REQUIRED. jpeg|png|webp only. Hard cap 3.5 MB of
                                            // base64 string length -> HTTP 413 `image_too_large`
  "phone":   "9884896963",     // REQUIRED unless mode === "in-studio"
  "name":    "",               // optional, truncated to 60 chars
  "email":   "",               // optional, truncated to 120
  "concern": "thinning",       // optional, [a-z] only, 20 chars. thinning|peeling|growth|curious
  "fbc":     "", "fbp": "",    // optional Meta attribution passthrough, 255 chars
  "mode":    "in-studio"       // optional. Suppresses BOTH GHL pushes and the phone requirement
}
```

No auth of any kind. The only gate is optional per-IP rate limiting.

Errors, all `{"error": "<code>"}`: `bad_json` 400, `missing_fields` 400, `bad_image` 400,
`image_too_large` 413, `rate_limited` 429, `not_found` 404.

Success is **200 with the legacy flat shape**, plus `id` and `record_version: 2`:

```jsonc
{
  "tier": "healthy|manageable|medical|unclear",
  "tierLabel": "Healthy" | "A little love" | "Worth a check" | "Couldn't read",
  "tierName": "...",            // one-line restatement
  "headline": "<html>",         // CONTAINS HTML (<span class="italic">) — never innerText it
  "summary":  "plain text",
  "conditions": ["plain text", ...],   // tags stripped; max 6; [] when tier === unclear
  "recommendation": "plain text",
  "medical": "",                // non-empty only when tier === medical
  "showCta": true, "ctaService": "biab-nail-strengthening-therapy",
  "ctaText": "...", "ctaMeta": "From your nail calendar",
  "report_url": "https://basedaesthetics.co/report.html?id=<id>",
  "id": "k3f9a2p", "record_version": 2
}
```

### `GET /api/report/{id}`

Returns the **full record** (below), `cache-control: private, max-age=300`. 404 `not_found` if absent.

### `GET /api/scans/{id}/photo.jpg` and `/report.html`

R2 passthrough, `public, max-age=31536000, immutable`. The `report.html` snapshot is archival —
deliberately never surfaced to clients.

## The full record schema (`v: 2`)

This is the real report schema; the flat response above is a lossy legacy projection of it.

```jsonc
{
  "v": 2, "id": "k3f9a2p", "created_at": "ISO", "concern": null, "name": "",
  "tier": "healthy|manageable|medical|unclear",
  "wear": "bare|polish|gel|acrylic|extensions|unknown",
  "display": {
    "headline": "<html>",
    "verdict": { "num": "2/4", "label": "A LITTLE LOVE", "line": "<html>", "sub": "text" },
    "checks":  [ { "k": "Surface · index + ring, mid-plate", "v": "<html>", "status": "note|good" } ],
    "map":     { "hand": "left|right|unknown",
                 "marks": [ { "color": "red|marigold", "zone": "tip|mid|base",
                              "fingers": [0..4], "label": "Surface" } ],
                 "cuticle": "good|marigold|red" },
    "figures": { "cross_section": false, "growth": false },
    "calendar": {                       // null when tier is medical or unclear
      "intro": "text",
      "milestones": [ { "date": "2026-09-07", "label": "...", "sub": "...",
                        "kind": "action|check|goal", "primary": true,
                        "service": "slug", "cta": "...", "ctaSub": "..." } ],  // max 4
      "grown_out": "2026-12-28",        // ISO or null
      "book": { "label": "...", "sub": "...", "service": "slug", "date": "ISO" }
    },
    "carry":   { "now": {"tag","name","line","when"}, "later": {...} },  // null unless healthy/manageable
    "medical": "text|null",
    "quality_issues": ["blur","glare","too_far","cropped","low_light"]   // only when unclear
  },
  "perception": {                        // null if the model call or JSON parse failed
    "findings": [ { "code", "fingers": [], "zone", "severity": "mild|moderate|marked" } ],
    "flags": [], "photo_quality": { "score": 0..1, "issues": [] },
    "confidence": 0..1, "nails_visible": 0..5,
    "hand": "...", "undertone": "warm|cool|neutral|unknown",
    "nail_bed": "short_wide|long_narrow|balanced|unknown"
  }
}
```

**The model only perceives.** It returns strict JSON against a fixed vocabulary of 20 finding codes
and 9 flag codes. Tier, dates, copy and every decision are deterministic server code. That separation
is the product; carry it over verbatim.

Tier gate (`decideTier`), in order:

1. no perception at all → `unclear`
2. any flag → `medical`
3. `photo_quality.score < 0.45` **or** `nails_visible < 3` **or** `confidence < 0.5` → `unclear`
4. any care/note finding → `manageable`
5. otherwise → `healthy`

Note step 3: **the server already has a soft quality gate — but it fires only after a paid vision
call**, and it reports failure as a tier rather than as a retake. That is the flaw the brief's
client-side lighting gate fixes: reject before spending the call.

## Lead capture, as actually built

The brief says the current scanner "routes to WhatsApp". It does not. WhatsApp appears **only** as a
manual fallback link on the API-error screen (`wa.me/919884896963`). Real lead capture is
server-side, in two GHL webhook pushes:

1. **`nail_scan_started`** → `GHL_WEBHOOK_URL`, fired *before* the vision call so a model failure
   still leaves a lead. Payload: `name, email, phone, concern, fbc, fbp, source:'nail-scanner',
   tags:'nail-scan-started', scanned_at`.
2. **`nail_scan_result`** → `GHL_RESULT_WEBHOOK_URL`. Adds `tier, wear, tags` (comma-joined
   `nail-scan-<tier>`, `wear-<wear>`, `finding-<code>`…), `scan_result, scan_conditions,
   scan_recommendation, recommended_service, next_action_date, grown_out_date, report_url,
   scan_image_url, scan_score, scan_summary, scanned_at`.

Both are `await`ed but wrapped — a CRM failure logs and never blocks the response. There are **no
custom-field IDs in the code**; keys are snake_case and the key→field mapping lives inside the GHL
workflow.

Phone is normalised to E.164 **as +91 India** (`normalizePhone`) before either push, so both
converge on one contact.

**Ordering consequence:** because the lead push happens inside `analyze-nails`, the existing
front-end must collect name/email/phone **before** the scan runs. `scan.html` does exactly that —
form, then camera, then analysis.

## What this means for `try.nailscan.ai`

Facts, and what each forces:

1. **`mode:'in-studio'` is the only no-lead path,** and it also drops the phone requirement. Useful
   as a shape, but semantically wrong to reuse.
2. **Phone normalises to +91.** The NailScan audience is US salon owners (Houston/LA). Reusing this
   Worker would file every US lead as an Indian number.
3. **The copy bank is brand-neutral and should be kept verbatim** — it is the product a salon owner
   is being shown. Only the wrapper is Based-specific: `Kilpauk` in two `ctaSub` strings, `en-IN`
   date formatting, `basedaesthetics.co` throughout `renderReportHtml`, Based's fonts and palette in
   the snapshot, and Based's service slugs.
4. **The brief wants the contact form at report reveal, not before the scan.** The existing Worker
   cannot do that: it requires `phone` up front and pushes the lead inside the same call.

Conclusion: **clone, do not fork inline.** `nailscan-try-api` keeps the perception prompt, the tier
gate, the calendar rules, the copy bank and the trends list unchanged, and replaces the wrapper with
a `BRAND` config object. It splits lead capture out of the scan:

- `POST /api/analyze-nails` — `{ image }` only. No phone, no lead push. Returns the record.
- `POST /api/lead` — `{ id, name, salon, phone, email, country, consent }`. Loads the record from KV,
  pushes one enriched `nailscan_try_lead` event to the NailScan GHL webhook, returns `{ ok: true }`.

That split is what makes "contact form appears once, at the report reveal" possible at all.
