/* NailScan Studio — the salon's book.
 *
 * A static page that talks to Supabase directly. There is no server of ours in
 * the middle, which is the whole point: every row this file can reach is decided
 * by row-level security in Postgres. If a query here asked for another salon's
 * clients it would come back empty, and that is by design rather than by our
 * good behaviour.
 *
 * Three screens, deliberately:
 *   the book    — search, who is due, who was in recently
 *   the file    — one client: readings, photos, what keeps coming back, notes, the story
 *   the gate    — sign in
 *
 * Nothing is rendered with innerHTML. Client names, notes and salon copy are all
 * written with textContent; the only markup this file creates is its own.
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { FINDING_LABEL, FLAG_LABEL, TIER_LABEL, findingBand } from './vocab.js';
import { createHQ } from './hq.js';

const CFG = window.NAILSCAN_STUDIO_CONFIG;
const $ = id => document.getElementById(id);

const sb = createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const state = { tenant: null, member: null, clients: [], searchSeq: 0 };

/* ------------------------------------------------------------- utilities -- */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const DAY = 86400000;

function fmtDay(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(CFG.brand.locale, { month: 'short', day: 'numeric' });
  } catch (e) { return String(iso).slice(0, 10); }
}

function fmtMonthYear(iso) {
  try {
    return new Date(iso).toLocaleDateString(CFG.brand.locale, { month: 'long', year: 'numeric' });
  } catch (e) { return ''; }
}

/* "3 days ago", "in 2 weeks" — the salon reads time in distance, not dates. */
function relative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return '';
  const days = Math.round((then - Date.now()) / DAY);
  const a = Math.abs(days);
  if (a === 0) return 'today';
  const unit = a < 7 ? [a, 'day'] : a < 31 ? [Math.round(a / 7), 'week'] : a < 365 ? [Math.round(a / 30), 'month'] : [Math.round(a / 365), 'year'];
  const label = unit[0] + ' ' + unit[1] + (unit[0] === 1 ? '' : 's');
  return days < 0 ? label + ' ago' : 'in ' + label;
}

function clientName(c) {
  const first = c.preferred_name || c.first_name || '';
  const full = [first, c.last_name].filter(Boolean).join(' ').trim();
  return full || c.phone || 'Unnamed client';
}

function initialsOf(name) {
  return (name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '··';
}

function show(view) {
  ['book', 'file', 'hq'].forEach(v => { $('v-' + v).hidden = v !== view; });
  $('btn-back').hidden = view === 'book';
  window.scrollTo({ top: 0 });
}

function crash(msg) {
  $('crash').textContent = msg;
  $('crash').hidden = false;
}

/* ------------------------------------------------------------------ gate -- */

$('login-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const btn = $('btn-login');
  $('login-err').hidden = true;
  btn.disabled = true;

  const { error } = await sb.auth.signInWithPassword({
    email: $('in-email').value.trim(),
    password: $('in-pass').value
  });

  btn.disabled = false;
  if (error) {
    // Deliberately vague: a precise error here tells a stranger which emails
    // are real accounts at this salon.
    $('login-err').textContent = 'That email and password did not match.';
    $('login-err').hidden = false;
    return;
  }
  boot();
});

$('btn-magic').addEventListener('click', async () => {
  const email = $('in-email').value.trim();
  if (!email) { $('in-email').focus(); return; }
  await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
  // Always the same answer, sent or not — same reason as above.
  $('magic-note').hidden = false;
});

$('btn-seat').addEventListener('click', async () => {
  if (!confirm('Sign out of the book?')) return;
  await sb.auth.signOut();
  location.reload();
});

/* ------------------------------------------------------------------ boot -- */

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  document.body.dataset.view = session ? 'shell' : 'login';
  $('v-boot').hidden = true;
  $('v-login').hidden = !!session;
  $('v-shell').hidden = !session;
  if (!session) return;

  // One membership row is the whole authorisation story on this device.
  const { data: seats, error } = await sb
    .from('tenant_members')
    .select('id, role, display_name, tenant_id, tenants(id, slug, name, locale)')
    .eq('status', 'active')
    .limit(1);

  if (error) return crash('Could not open the book: ' + error.message);
  if (!seats || !seats.length) {
    return crash('This account is not on any salon yet. Ask the owner to add you.');
  }

  state.member = seats[0];
  state.tenant = seats[0].tenants;
  $('tenant-name').textContent = state.tenant.name;
  $('tenant-mark').textContent = CFG.brand.mark;
  $('seat-initials').textContent = initialsOf(state.member.display_name);

  loadCredits();
  detectHQ();
  route();
}

/* Is this person NailScan rather than a salon?
 *
 * platform_admins is readable only by platform admins — that is its RLS policy
 * — so a non-empty read IS the check. No role string to spoof, no flag in a
 * JWT, nothing the browser can talk itself into. */
async function detectHQ() {
  const { data, error } = await sb.from('platform_admins').select('user_id').limit(1);
  if (error || !data || !data.length) return;
  state.isHQ = true;
  $('btn-hq').hidden = false;
  $('btn-hq').addEventListener('click', () => { location.hash = '#/hq'; });
}

async function loadCredits() {
  const { data, error } = await sb.rpc('credit_balance', { p_tenant: state.tenant.id });
  if (error || data == null) return;
  $('credit-pill').textContent = data + ' credits';
  $('credit-pill').hidden = false;
}

/* ------------------------------------------------------------------ book -- */

async function loadBook() {
  const [recent, due] = await Promise.all([
    sb.from('clients')
      .select('id, first_name, last_name, preferred_name, phone, status, last_seen_at, first_seen_at')
      .is('merged_into_id', null).is('archived_at', null)
      .order('last_seen_at', { ascending: false, nullsFirst: false })
      .limit(60),
    sb.from('care_milestones')
      .select('id, due_on, label, service_slug, client_id, clients(id, first_name, last_name, preferred_name, phone)')
      .eq('status', 'pending')
      .lte('due_on', new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10))
      .not('client_id', 'is', null)
      .order('due_on', { ascending: true })
      .limit(20)
  ]);

  if (recent.error) return crash('Could not load the book: ' + recent.error.message);
  state.clients = recent.data || [];

  // One extra query gives every row its last verdict. Worth it: "who is in a
  // medical tier and hasn't been called" is the question this list is for.
  await decorateWithLastTier(state.clients);
  renderRows($('book-rows'), state.clients);
  $('book-n').textContent = state.clients.length ? String(state.clients.length).padStart(2, '0') : '';
  $('book-empty').hidden = state.clients.length > 0;

  const dues = (due.data || []).filter(d => d.clients);
  $('due-band').hidden = dues.length === 0;
  $('due-n').textContent = dues.length ? String(dues.length).padStart(2, '0') : '';
  const ul = $('due-rows');
  ul.replaceChildren();
  dues.forEach(d => {
    const overdue = d.due_on < new Date().toISOString().slice(0, 10);
    ul.appendChild(rowFor(d.clients, {
      sub: d.label + (d.service_slug ? ' · ' + d.service_slug.replace(/-/g, ' ') : ''),
      when: fmtDay(d.due_on) + (overdue ? ' · overdue' : ''),
      alert: overdue
    }));
  });
}

/* PostgREST has no "latest row per group", so fetch the recent scans for these
   clients and keep the first one seen per client — the order clause makes that
   the newest. One round trip, not sixty. */
async function decorateWithLastTier(clients) {
  const ids = clients.map(c => c.id);
  if (!ids.length) return;
  const { data } = await sb.from('scans')
    .select('client_id, tier, captured_at')
    .in('client_id', ids)
    .order('captured_at', { ascending: false })
    .limit(400);
  const latest = new Map();
  (data || []).forEach(s => { if (!latest.has(s.client_id)) latest.set(s.client_id, s); });
  clients.forEach(c => { c._last = latest.get(c.id) || null; });
}

function rowFor(c, opts) {
  const li = el('li');
  const btn = el('button', 'row');
  btn.type = 'button';

  const body = el('div', 'row-body');
  body.appendChild(el('span', 'row-name', clientName(c)));
  body.appendChild(el('span', 'row-sub', opts.sub || c.phone || ''));

  const right = el('div', 'row-right');
  const when = el('span', 'row-when' + (opts.alert ? ' due' : ''), opts.when || '');
  right.appendChild(when);
  if (c._last) {
    // A word plus a mark. The mark alone would be colour-only meaning.
    right.appendChild(el('span', 'tier ' + c._last.tier, TIER_LABEL[c._last.tier] || c._last.tier));
  }

  btn.appendChild(body);
  btn.appendChild(right);
  btn.addEventListener('click', () => { location.hash = '#/c/' + c.id; });
  li.appendChild(btn);
  return li;
}

function renderRows(ul, list) {
  ul.replaceChildren();
  list.forEach(c => ul.appendChild(rowFor(c, {
    sub: c.phone || '',
    when: c.last_seen_at ? relative(c.last_seen_at) : 'not seen yet'
  })));
}

/* Search runs against the database, not the loaded page — the book is bigger
   than the sixty rows on screen. Out-of-order responses are dropped. */
let searchTimer = null;
$('q').addEventListener('input', () => {
  const term = $('q').value.trim();
  $('q-clear').hidden = !term;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(term), 220);
});
$('q-clear').addEventListener('click', () => {
  $('q').value = '';
  $('q-clear').hidden = true;
  runSearch('');
  $('q').focus();
});

async function runSearch(term) {
  const seq = ++state.searchSeq;
  if (!term) {
    $('book-label').textContent = 'Recently in';
    renderRows($('book-rows'), state.clients);
    $('book-n').textContent = state.clients.length ? String(state.clients.length).padStart(2, '0') : '';
    $('due-band').hidden = $('due-rows').children.length === 0;
    return;
  }

  const safe = term.replace(/[,()*]/g, ' ');
  const digits = term.replace(/\D/g, '');
  const filters = [
    `first_name.ilike.*${safe}*`,
    `last_name.ilike.*${safe}*`,
    `preferred_name.ilike.*${safe}*`
  ];
  if (digits.length >= 3) filters.push(`phone.ilike.*${digits}*`);

  const { data, error } = await sb.from('clients')
    .select('id, first_name, last_name, preferred_name, phone, last_seen_at')
    .is('merged_into_id', null).is('archived_at', null)
    .or(filters.join(','))
    .order('last_seen_at', { ascending: false, nullsFirst: false })
    .limit(40);

  if (seq !== state.searchSeq) return;          // a newer keystroke already won
  if (error) return crash('Search failed: ' + error.message);

  $('due-band').hidden = true;
  $('book-label').textContent = 'Matches';
  $('book-n').textContent = String((data || []).length).padStart(2, '0');
  renderRows($('book-rows'), data || []);
  $('book-empty').hidden = (data || []).length > 0;
  if (!(data || []).length) $('book-empty').textContent = 'Nobody by that name or number.';
}

/* ----------------------------------------------------------- client file -- */

async function loadFile(id) {
  const [client, scans, photos, events, notes, milestones] = await Promise.all([
    sb.from('clients').select('*').eq('id', id).maybeSingle(),
    sb.from('scans')
      .select('id, public_id, tier, wear, captured_at, summary, scan_findings(code, zone, severity, is_positive), scan_flags(code, acknowledged_at)')
      .eq('client_id', id).order('captured_at', { ascending: false }).limit(40),
    sb.from('scan_photos').select('id, public_url, storage, path, taken_at, scan_id')
      .eq('client_id', id).eq('kind', 'capture').is('deleted_at', null)
      .order('taken_at', { ascending: false }).limit(40),
    sb.from('client_events').select('id, at, kind, title, detail')
      .eq('client_id', id).order('at', { ascending: false }).limit(80),
    sb.from('client_notes').select('id, body, pinned, created_at')
      .eq('client_id', id).is('deleted_at', null)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(40),
    sb.from('care_milestones').select('id, due_on, label, sub, kind, status')
      .eq('client_id', id).eq('status', 'pending').order('due_on', { ascending: true }).limit(10)
  ]);

  if (client.error || !client.data) return crash('That file could not be opened.');

  const c = client.data;
  const rows = scans.data || [];
  state.openClient = c;

  /* header */
  $('f-name').textContent = clientName(c);
  const bits = [];
  if (c.phone) bits.push(c.phone);
  if (c.email) bits.push(c.email);
  if (c.first_seen_at) bits.push('client since ' + fmtMonthYear(c.first_seen_at));
  $('f-meta').textContent = bits.join('  ·  ');

  const chips = $('f-chips');
  chips.replaceChildren();
  const openFlags = rows.flatMap(s => (s.scan_flags || []).filter(f => !f.acknowledged_at));
  if (openFlags.length) {
    const chip = el('span', 'chip alert', 'Worth a check · ' + (FLAG_LABEL[openFlags[0].code] || openFlags[0].code));
    chips.appendChild(chip);
  }
  if (c.status) chips.appendChild(el('span', 'chip', c.status));
  if (c.pronouns) chips.appendChild(el('span', 'chip', c.pronouns));

  /* three tiles */
  const last = rows[0];
  const nextDue = (milestones.data || [])[0];
  const overdue = nextDue && nextDue.due_on < new Date().toISOString().slice(0, 10);
  const tiles = $('f-tiles');
  tiles.replaceChildren();
  tiles.appendChild(tile('Last reading',
    last ? (TIER_LABEL[last.tier] || last.tier) : 'None yet',
    last ? fmtDay(last.captured_at) + ' · ' + relative(last.captured_at) : 'No scan on file'));
  tiles.appendChild(tile('Next due',
    nextDue ? fmtDay(nextDue.due_on) : '—',
    nextDue ? nextDue.label + (overdue ? ' · overdue' : '') : 'Nothing scheduled', overdue));
  tiles.appendChild(tile('Readings', String(rows.length),
    rows.length ? 'since ' + fmtMonthYear(rows[rows.length - 1].captured_at) : '—'));

  renderPhotos(photos.data || [], rows);
  renderFindings(rows);
  renderNotes(notes.data || []);
  renderStory(events.data || []);

  show('file');
}

function tile(label, value, sub, alert) {
  const d = el('div', 'tile' + (alert ? ' alert' : ''));
  d.appendChild(el('dt', null, label));
  const dd = el('dd', null, value);
  if (sub) { const s = el('small', null, sub); dd.appendChild(s); }
  d.appendChild(dd);
  return d;
}

/* Every reading she has ever had — the before and after, in her own hands.
 *
 * Oldest on the LEFT, same direction as the dot strip below it. Two strips on
 * one page running opposite ways is the kind of small wrongness that makes a
 * tool feel untrustworthy. The strip is then scrolled to its right-hand end on
 * open, so the newest photo is the one in view.
 */
function renderPhotos(photos, scans) {
  const wrap = $('f-photos');
  wrap.replaceChildren();
  const byScan = new Map(scans.map(s => [s.id, s]));
  const source = photos.length ? photos : scans.map(s => ({ scan_id: s.id, taken_at: s.captured_at, public_url: null }));
  const list = source.slice().sort((a, b) => new Date(a.taken_at) - new Date(b.taken_at));
  $('f-photos-band').hidden = list.length === 0;
  $('f-photos-n').textContent = String(list.length).padStart(2, '0');

  list.forEach(p => {
    const scan = byScan.get(p.scan_id);
    const b = el('button', 'shot');
    b.type = 'button';
    if (p.public_url) {
      const img = new Image();
      img.src = p.public_url;
      img.alt = 'Nail photo from ' + fmtDay(p.taken_at);
      img.loading = 'lazy';
      b.appendChild(img);
    } else {
      b.appendChild(el('div', 'noshot'));
    }
    b.appendChild(el('b', null, fmtDay(p.taken_at)));
    b.appendChild(el('span', null, scan ? (TIER_LABEL[scan.tier] || scan.tier) : ''));
    if (scan && scan.public_id) {
      b.addEventListener('click', () => window.open(CFG.reportBase + '?id=' + encodeURIComponent(scan.public_id), '_blank', 'noopener'));
    }
    wrap.appendChild(b);
  });

  // Land on the most recent reading, without stealing the page's scroll.
  requestAnimationFrame(() => { wrap.scrollLeft = wrap.scrollWidth; });
}

/* What keeps coming back.
 *
 * One row per finding she has ever had, one dot per reading, oldest on the
 * left. Filled means it was seen that day. That single strip answers the two
 * questions a technician actually has — is this the same problem as last time,
 * and is it getting better — without a chart, an axis, or a legend to decode.
 *
 * Colour reinforces the band; it never carries it alone. Every row is labelled,
 * the shapes differ (square for wear, ring for serious), and the sentence under
 * each label says the same thing in words.
 */
function renderFindings(scans) {
  const list = $('f-findings');
  list.replaceChildren();

  const chron = scans.slice().reverse();           // oldest first
  const seen = new Map();                           // code -> {band, hits:Set(index)}
  chron.forEach((s, i) => {
    (s.scan_findings || []).forEach(f => {
      if (!seen.has(f.code)) seen.set(f.code, { band: findingBand(f.code, f.is_positive), hits: new Set() });
      seen.get(f.code).hits.add(i);
    });
  });

  $('f-findings-band').hidden = seen.size === 0 || chron.length === 0;
  if (!seen.size) return;
  $('f-findings-n').textContent = String(seen.size).padStart(2, '0') + ' TRACKED';

  const legend = $('f-legend');
  legend.replaceChildren();
  [['good', 'Doing well'], ['note', 'Wear'], ['serious', 'Damage']].forEach(([band, label]) => {
    const s = el('span');
    s.appendChild(el('i', 'lvl-' + band));
    s.appendChild(document.createTextNode(label));
    legend.appendChild(s);
  });

  // Most persistent first, then most recent.
  const ordered = [...seen.entries()].sort((a, b) => {
    const d = b[1].hits.size - a[1].hits.size;
    return d !== 0 ? d : Math.max(...b[1].hits) - Math.max(...a[1].hits);
  });

  ordered.forEach(([code, info]) => {
    const li = el('li', 'finding');
    const body = el('div', 'finding-body');
    body.appendChild(el('b', null, FINDING_LABEL[code] || code));

    const lastIdx = Math.max(...info.hits);
    const stillThere = lastIdx === chron.length - 1;
    const sentence = info.hits.size === 1
      ? 'Seen once · ' + fmtDay(chron[lastIdx].captured_at)
      : `Seen in ${info.hits.size} of ${chron.length} readings · ` +
        (stillThere ? 'still there at the last one' : 'not since ' + fmtDay(chron[lastIdx].captured_at));
    body.appendChild(el('span', null, sentence));

    const dots = el('div', 'dots');
    chron.forEach((s, i) => {
      dots.appendChild(el('span', 'dot' + (info.hits.has(i) ? ' on lvl-' + info.band : '')));
    });

    li.appendChild(body);
    li.appendChild(dots);
    list.appendChild(li);
  });

  $('f-findings-key').textContent =
    `One dot per reading, oldest on the left. A filled dot means we saw it that day. ${chron.length} readings on file.`;
}

function renderNotes(notes) {
  const ul = $('f-notes');
  ul.replaceChildren();
  notes.forEach(n => {
    const li = el('li', 'desk-note');
    li.appendChild(el('p', null, n.body));
    li.appendChild(el('span', null, (n.pinned ? 'pinned · ' : '') + fmtDay(n.created_at)));
    ul.appendChild(li);
  });
}

$('note-form').addEventListener('submit', async ev => {
  ev.preventDefault();
  const body = $('note-in').value.trim();
  if (!body || !state.openClient) return;
  $('note-in').value = '';

  const { error } = await sb.from('client_notes').insert({
    tenant_id: state.tenant.id, client_id: state.openClient.id, body
  });
  if (error) return crash('That note did not save: ' + error.message);

  // The note is staff-only, so it gets a timeline row the client never sees.
  await sb.from('client_events').insert({
    tenant_id: state.tenant.id, client_id: state.openClient.id,
    kind: 'note', title: 'Desk note added', detail: body.slice(0, 200),
    actor_label: state.member.display_name
  });
  loadFile(state.openClient.id);
});

/* The story. A ledger read downward, newest first, grouped by month. */
function renderStory(events) {
  const ol = $('f-events');
  ol.replaceChildren();
  $('f-events-n').textContent = String(events.length).padStart(2, '0');

  let month = null;
  events.forEach(e => {
    const m = fmtMonthYear(e.at);
    if (m !== month) {
      month = m;
      const head = el('li', 'band-head');
      head.style.marginTop = '18px';
      head.appendChild(el('p', 'eyebrow', m));
      ol.appendChild(head);
    }
    const li = el('li', 'ev' + (e.kind === 'flag_raised' ? ' alert' : ''));
    li.appendChild(el('span', 'ev-when', fmtDay(e.at)));
    const body = el('span', 'ev-body');
    body.appendChild(el('b', null, e.title));
    if (e.detail) body.appendChild(el('span', null, e.detail));
    li.appendChild(body);
    ol.appendChild(li);
  });
}

/* ---------------------------------------------------------------- routing -- */

function route() {
  const m = location.hash.match(/^#\/c\/([0-9a-f-]{36})$/i);
  $('crash').hidden = true;
  if (location.hash === '#/hq') { openHQ(); }
  else if (m) { loadFile(m[1]); }
  else { show('book'); loadBook(); }
}

let hq = null;
async function openHQ() {
  if (!state.isHQ) { location.hash = ''; return; }
  show('hq');
  if (!hq) hq = createHQ({ sb, cfg: CFG, root: $('v-hq') });
  try { await hq.open(); }
  catch (e) { crash('Could not open HQ: ' + e.message); }
}

$('btn-back').addEventListener('click', () => { location.hash = ''; });
window.addEventListener('hashchange', route);

boot();
