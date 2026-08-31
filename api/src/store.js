// NailScan — the client-file store.
//
// The scanner's own record lives in KV: fast, edge-local, and the thing
// /api/lead reads back a few seconds later. This module is the other half — the
// durable file the salon actually works from, in Postgres.
//
// Two calls, both Postgres functions, both one transaction each:
//
//   ingest_scan          — every reading, the moment it exists, unattached
//   attach_lead_to_scan  — when she gives her details, the reading becomes hers
//
// Everything here is BEST-EFFORT and must stay that way. A database that is
// slow, down, or misconfigured cannot be allowed to cost somebody her reading:
// the report is already computed and already on her phone. Failures are logged
// loudly and swallowed, and KV remains the source the front end depends on.

const REST_TIMEOUT_MS = 4000;

// TENANT_SLUG is the fallback tenant, not the only one: with hostname
// resolution on, the caller passes whichever salon the request belongs to.
// What this checks is only whether Postgres is reachable at all.
function configured(env) {
  return !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

// One POST to a Postgres function. Times out rather than holding the request.
async function rpc(env, fn, payload) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REST_TIMEOUT_MS);
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'content-type': 'application/json',
        'accept': 'application/json',
        // The Worker is the only writer here; no row is ever returned to a
        // browser, so ask for the minimum.
        'prefer': 'return=representation'
      },
      // Every function in this schema takes a single argument. Most take a
      // jsonb object called `p`; resolve_tenant_by_host takes a text host.
      body: JSON.stringify(fn === 'resolve_tenant_by_host' ? { p_host: payload } : { p: payload })
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      console.log(`[store] ${fn} HTTP ${res.status} ${text.slice(0, 300)}`);
      return null;
    }
    try { return JSON.parse(text); } catch (e) { return text || true; }
  } catch (e) {
    console.log(`[store] ${fn} FAILED ${e && e.name === 'AbortError' ? 'timeout' : (e && e.message)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Positive findings are findings. The copy bank knows which are which, so the
// caller passes the lookup in rather than this module re-deriving it.
function findingRows(record, isPositive) {
  const p = record.perception;
  if (!p || !Array.isArray(p.findings)) return [];
  return p.findings.map(f => ({
    code: f.code,
    fingers: Array.isArray(f.fingers) ? f.fingers : [],
    zone: f.zone || 'whole',
    severity: f.severity || 'mild',
    is_positive: !!isPositive(f.code)
  }));
}

function milestoneRows(record) {
  const cal = record.display && record.display.calendar;
  if (!cal || !Array.isArray(cal.milestones)) return [];
  return cal.milestones.map(m => ({
    due_on: m.date,
    label: m.label,
    sub: m.sub || null,
    kind: m.kind || 'check',
    service_slug: m.service || null,
    is_primary: !!m.primary
  }));
}

function photoRows(record) {
  const a = record.assets || {};
  const rows = [];
  if (a.image)  rows.push({ kind: 'capture', storage: 'r2', path: `scans/${record.id}/photo.jpg`,  public_url: a.image,  content_type: 'image/jpeg' });
  if (a.report) rows.push({ kind: 'report',  storage: 'r2', path: `scans/${record.id}/report.html`, public_url: a.report, content_type: 'text/html' });
  return rows;
}

// Store the reading. Called on every scan, before anyone has given a name.
export async function ingestScan(env, tenantSlug, record, isPositive, summary) {
  if (!configured(env) || !tenantSlug) return null;
  const p = record.perception || {};
  return rpc(env, 'ingest_scan', {
    tenant_slug:   tenantSlug,
    public_id:     record.id,
    source:        record.source || 'try-demo',
    captured_at:   record.created_at,
    tier:          record.tier,
    wear:          record.wear || 'unknown',
    confidence:    p.confidence,
    photo_quality: p.photo_quality ? p.photo_quality.score : null,
    nails_visible: p.nails_visible,
    hand:          p.hand || 'unknown',
    undertone:     p.undertone || 'unknown',
    nail_bed:      p.nail_bed || 'unknown',
    summary:       summary || null,
    record:        record,
    record_version: record.v || 2,
    findings:      findingRows(record, isPositive),
    flags:         Array.isArray(p.flags) ? p.flags : [],
    photos:        photoRows(record),
    milestones:    milestoneRows(record)
  });
}

// Claim the reading for a person. Phone is the identity; the function handles
// matching a returning client, including one whose number has changed.
export async function attachLead(env, tenantSlug, publicId, lead, consentText) {
  if (!configured(env) || !tenantSlug) return null;
  return rpc(env, 'attach_lead_to_scan', {
    tenant_slug:  tenantSlug,
    public_id:    publicId,
    phone:        lead.phone || null,
    email:        lead.email || null,
    name:         lead.name  || null,
    salon:        lead.salon || null,
    source:       lead.source || 'try-demo',
    consent_text: consentText || null
  });
}

// She put the dates in her own phone. That is the strongest signal this product
// produces — somebody who read the reading, believed it, and told us when her
// wedding is. It belongs on her file, not only in the CRM.
export async function recordPlanSaved(env, tenantSlug, publicId, summary) {
  if (!configured(env) || !tenantSlug) return null;
  return rpc(env, 'record_plan_saved', {
    tenant_slug: tenantSlug,
    public_id:   publicId,
    total:       summary.total || 0,
    event_date:  summary.event_date || null,
    event_label: summary.event_label || null,
    payload:     summary.payload || {}
  });
}

// Hostname to salon. Returns null for an unknown host so the caller falls back
// to its configured tenant — see the TENANCY note in index.js.
export async function rpcResolveHost(env, host) {
  if (!configured(env)) return null;
  const out = await rpc(env, 'resolve_tenant_by_host', host);
  return out && out.slug ? out : null;
}

export { configured as storeConfigured };
