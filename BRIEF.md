# NailScan Try — Build Brief

Rebuild of the white-label nail scanner as a NailScan-branded, big-company-grade
product. Owner: Bit Mystic · Prepared 24 Aug 2026 · Executed in Claude Code.

## What this is

A one-page scanner app at `try.nailscan.ai`: a salon owner photographs her own
nails, gets the real NailScan report, and becomes a captured lead. It is the live
demo for the NailScan sales funnel (`go.nailscan.ai/watch` sells; `/try` proves;
Maya calls in 5 minutes).

## Non-negotiables

1. **Reject low-light photos.** The current scanner's known flaw: it accepts
   bad-lighting shots and produces weak reads. Client-side gate before anything
   is sent.
2. **White-label config lives on OUR side.** Theming (logo, name, colors) is a
   config object we control per deployment. No client-facing branding controls
   anywhere.
3. **Fast, minimal clicks.** Land → tap once to open camera → capture →
   auto-checked → report. Contact form appears once, at the report reveal.
4. **Big-company polish.** Meaningful animation only: scan-line sweep during
   analysis, staggered report reveal, micro-transitions. No decorative motion.
   Respect `prefers-reduced-motion`.
5. **Git repo from day one.** The old white-label was lost because the Pages
   project is direct-upload with no source control. This build lives in a repo;
   every deploy comes from it.

## Step 0 — extract the existing contract

Done, from source rather than the live HTML. See [docs/api-contract.md](docs/api-contract.md).

Two corrections that came out of it:

- The brief points at `/scanner`; that page has no API call. The working scanner
  front-end is `/scan`.
- Lead capture does **not** route to WhatsApp. WhatsApp is only a manual fallback
  link on the error screen. Real capture is two server-side GHL webhook pushes,
  the first fired *before* the vision call.

## Architecture

- **Front-end:** single-page static app, vanilla, no build step. Cloudflare Pages
  project `nailscan-try` in the Ad@basedaesthetics.co account
  (`cb9d1952be3e0c9b91c3da6462bac872`). Custom domain `try.nailscan.ai` via a
  CNAME in GHL's DNS panel for `nailscan.ai`.
- **Backend:** `nailscan-try-api`, cloned from `based-nail-scanner`. The engine —
  perception prompt, finding/flag vocabulary, tier gate, calendar rules, copy
  bank, trends — is carried over unchanged. Cloned rather than reused because the
  original hard-codes Based Aesthetics: `+91` phone normalisation (this audience
  is US salon owners), Kilpauk booking CTAs, `basedaesthetics.co` report URLs,
  and a required `phone` field that would force the form in front of the camera.
- **Theming:** `public/config.js`. The sold product reuses the same app with
  per-salon config generated on our side. Nothing configurable client-side.

## The lighting gate

Runs on the captured frame before upload; a rejected photo never leaves the
device. Mean Rec. 709 luma (reject below ~60/255), shadow clipping (reject when
more than ~40% of pixels sit under luma 25), Laplacian variance as a blur proxy
(soft-warn only in v1). Thresholds live in config for tuning.

Rejection UX: instant, friendly, deadpan — *"Too dark to read your nails. Face a
window or turn on a light, then retake."* One tap back to camera. The measured
numbers are shown, because showing the reading is more convincing than asserting
it.

## Flow

1. Land: brand mark, one line, one button — *Scan your nails*.
2. Camera opens (`getUserMedia`, rear-facing on mobile; file-upload fallback).
3. Capture → lighting gate (instant) → pass: auto-continue. Fail: retake screen.
4. Analyzing: scan-line animation over the photo, honest progress copy.
5. Report reveals staggered — findings first.
6. Contact card to unlock the full care calendar: name, salon, phone, email +
   consent line: *"By submitting, you agree NailScan may contact you about your
   scan."*
7. Confirmation + the one cross-link: *"See what this does for your salon →
   go.nailscan.ai/watch"*.

## Lead capture → GHL

`POST /api/lead` → inbound-webhook workflow in the NailScan.ai sub-account
(location `cj1dKYGBhaLLrI6e0Jkg`): name, salon, phone, email, country, scan
summary, `source=try-demo`, tag `demo`. Workflow files the contact plus an
Opportunity (NailScan 28 pipeline, New lead, $199/mo + $399 setup context) and starts the Maya
5-minute call branch — built **disabled**, with a calling-hours guard, area-code
routing East/Pacific/Mountain, and v1 calling every scanner (no purchase check
yet). First-ever call goes to Bit Mystic's own number as the test.

## Brand + copy rules

Deadpan, forensic, specific. No exclamation marks; banned words: pamper, indulge,
luxurious, amazing, excited. Numbers stated flat. It must read like serious
infrastructure, not a promo page.

Design direction chosen: **porcelain / ink / lacquer, extended from the VSL
lander** — the lander's uppercase wordmark, mono `FIELD RECORD` eyebrow and green
CTA, carried into a field-instrument layout of hairline rules and tabular mono
data. Screenshots submitted for approval.

## Guardrails

- No medical or diagnostic claims anywhere (assessment is cosmetic).
- Consent line verbatim on the form.
- All-sales-final and pricing live on `/watch`, not here.
- Nothing auto-publishes: deploys go to a preview URL for approval before the
  domain flips.

## Definition of done

- [x] Repo with README + this brief + `docs/api-contract.md`
- [x] Lighting gate demonstrably rejects a dark photo and passes a window-lit one
- [ ] `try.nailscan.ai` live behind approval, Lighthouse mobile ≥ 90, < 2s on 4G
- [ ] A test scan lands a tagged contact + Opportunity in GHL, and the (disabled)
      Maya branch shows the correct routing decision in its execution log

The two open items need Cloudflare account access, an Anthropic key for this
Worker, and the GHL webhook URL. See [docs/deploy.md](docs/deploy.md).
