/* NailScan Studio — HQ.
 *
 * Every salon on the platform, and everything about one of them, editable in
 * place. This is the screen that lets a salon be onboarded and fixed without a
 * deploy, a terminal, or a Supabase login — which is the whole reason the
 * hostname-to-tenant table exists.
 *
 * Two editing patterns, and only two:
 *
 *   CLICK TO EDIT   for every value. Click it, it becomes an input, Enter or
 *                   blur saves, Escape cancels. No modals, no per-field save
 *                   buttons, no form that has to be submitted as a whole.
 *   DRAG            for the service menu, and nowhere else — because order IS
 *                   the data there. Dragging things whose order means nothing
 *                   is decoration pretending to be a feature.
 *
 * Every write goes through the logged-in user's own session, so row-level
 * security still decides. Nothing here holds a service key, and the screen is
 * only reachable by somebody in platform_admins — which is itself a table RLS
 * only lets platform admins read.
 */

const $ = id => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/* A price in the salon's own currency. A menu that reads $55.00 to a salon
   billing in rupees is not a rounding error, it is the wrong number. */
const money = (cents, currency, locale) => {
  const amount = (cents || 0) / 100;
  try {
    return new Intl.NumberFormat(locale || 'en-US',
      { style: 'currency', currency: currency || 'USD' }).format(amount);
  } catch (e) { return (currency || '') + ' ' + amount.toFixed(2); }
};
const shortDate = (iso, locale) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch (e) { return String(iso).slice(0, 10); }
};

/* --------------------------------------------------------- click to edit -- */

/* One value, editable in place.
 *
 * `save` returns a promise. While it runs the field is disabled; if it rejects
 * the old value comes back and the reason is shown. A field that silently
 * keeps a value the database refused is worse than one that never saved. */
function editable(opts) {
  const wrap = el('span', 'ed');
  const view = el('button', 'ed-view');
  view.type = 'button';

  function paint() {
    const v = opts.get();
    view.textContent = (opts.format ? opts.format(v) : v) || opts.placeholder || '—';
    view.classList.toggle('is-empty', !v);
  }
  paint();

  view.addEventListener('click', () => {
    const current = opts.get() || '';
    let input;
    if (opts.choices) {
      input = el('select', 'ed-input');
      opts.choices.forEach(c => {
        const o = el('option', null, c.label || c);
        o.value = c.value != null ? c.value : c;
        if (String(o.value) === String(current)) o.selected = true;
        input.appendChild(o);
      });
    } else {
      input = el('input', 'ed-input');
      input.type = opts.type || 'text';
      input.value = current;
      if (opts.placeholder) input.placeholder = opts.placeholder;
    }

    let done = false;
    async function commit(next) {
      if (done) return;
      done = true;
      if (String(next) === String(current)) { wrap.replaceChildren(view); return; }
      input.disabled = true;
      try {
        await opts.save(next);
        wrap.replaceChildren(view);
        paint();
        wrap.classList.add('is-saved');
        setTimeout(() => wrap.classList.remove('is-saved'), 1200);
      } catch (err) {
        input.disabled = false;
        done = false;
        const msg = el('span', 'ed-err', (err && err.message) || 'That did not save');
        wrap.replaceChildren(input, msg);
        input.focus();
      }
    }

    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(input.value.trim()); }
      if (ev.key === 'Escape') { done = true; wrap.replaceChildren(view); }
    });
    input.addEventListener('blur', () => commit(input.value.trim()));
    if (opts.choices) input.addEventListener('change', () => commit(input.value));

    wrap.replaceChildren(input);
    input.focus();
    if (input.select) input.select();
  });

  wrap.appendChild(view);
  wrap.refresh = paint;
  return wrap;
}

function row(label, control, hint) {
  const r = el('div', 'hq-row');
  const l = el('div', 'hq-label');
  l.appendChild(el('span', null, label));
  if (hint) l.appendChild(el('small', null, hint));
  r.appendChild(l);
  r.appendChild(control);
  return r;
}

/* ------------------------------------------------------------------ mount -- */

export function createHQ({ sb, cfg, root, onBack }) {
  const locale = (cfg.brand && cfg.brand.locale) || 'en-US';
  let salons = [];

  async function load() {
    const { data, error } = await sb.rpc('hq_tenant_overview');
    if (error) throw new Error(error.message);
    salons = data || [];
    return salons;
  }

  /* -------------------------------------------------------------- the list */

  function renderList() {
    root.replaceChildren();

    const head = el('header', 'file-head');
    head.appendChild(el('h1', null, 'Every salon'));
    head.appendChild(el('p', 'file-meta',
      salons.length + (salons.length === 1 ? ' salon on the platform' : ' salons on the platform')));
    root.appendChild(head);

    const band = el('section', 'band');
    const bh = el('div', 'band-head');
    bh.appendChild(el('p', 'eyebrow', 'Accounts'));
    bh.appendChild(el('span', 'n', String(salons.length).padStart(2, '0')));
    band.appendChild(bh);

    const ul = el('ul', 'rows');
    salons.forEach(t => {
      const li = el('li');
      const btn = el('button', 'row');
      btn.type = 'button';

      const body = el('div', 'row-body');
      body.appendChild(el('span', 'row-name', t.name));
      const hosts = (t.hosts || []).map(h => h.host);
      body.appendChild(el('span', 'row-sub',
        hosts.length ? hosts.join('  ·  ') : 'no domain yet'));
      btn.appendChild(body);

      const right = el('div', 'row-right');
      right.appendChild(el('span', 'row-when',
        t.clients + (t.clients === 1 ? ' client' : ' clients') + ' · ' + t.scans_30d + ' scans/30d'));
      right.appendChild(el('span', 'status ' + t.status, t.status));
      btn.appendChild(right);

      btn.addEventListener('click', () => renderDetail(t.id));
      li.appendChild(btn);
      ul.appendChild(li);
    });
    band.appendChild(ul);
    if (!salons.length) band.appendChild(el('p', 'empty', 'No salons yet.'));
    root.appendChild(band);
  }

  /* ------------------------------------------------------------ one salon */

  function renderDetail(id) {
    const t = salons.find(s => s.id === id);
    if (!t) return renderList();
    root.replaceChildren();

    const back = el('button', 'btn-text', '← Every salon');
    back.type = 'button';
    back.addEventListener('click', renderList);
    root.appendChild(back);

    const head = el('header', 'file-head');
    const h1 = el('h1');
    h1.appendChild(editable({
      get: () => t.name,
      save: v => update('tenants', { name: v }, { id: t.id }).then(() => { t.name = v; })
    }));
    head.appendChild(h1);
    head.appendChild(el('p', 'file-meta',
      t.slug + '  ·  created ' + shortDate(t.created_at, locale)));
    root.appendChild(head);

    /* the numbers that say whether this account is alive */
    const tiles = el('div', 'tiles');
    tiles.appendChild(tile('Clients', String(t.clients), 'on their book'));
    tiles.appendChild(tile('Scans', String(t.scans_30d), 'last 30 days'));
    tiles.appendChild(tile('Credits', String(t.credits), 'balance'));
    root.appendChild(tiles);

    root.appendChild(section('Account', 'What this salon is, to us.'));
    const acct = el('div', 'hq-rows');
    acct.appendChild(row('Status', editable({
      get: () => t.status,
      choices: ['trial', 'active', 'past_due', 'paused', 'closed'],
      save: v => update('tenants', { status: v }, { id: t.id }).then(() => { t.status = v; })
    }), 'paused stops nothing yet — it is what the HQ list shows'));
    acct.appendChild(row('Timezone', editable({
      get: () => t.timezone,
      save: v => update('tenants', { timezone: v }, { id: t.id }).then(() => { t.timezone = v; })
    }), 'decides what "today" means on their dashboard'));
    acct.appendChild(row('Locale', editable({
      get: () => t.locale,
      save: v => update('tenants', { locale: v }, { id: t.id }).then(() => { t.locale = v; })
    })));
    acct.appendChild(row('Currency', editable({
      get: () => t.currency,
      save: v => update('tenants', { currency: v.toUpperCase() }, { id: t.id }).then(() => { t.currency = v.toUpperCase(); })
    })));
    acct.appendChild(row('Phone country', editable({
      get: () => t.phone_country,
      save: v => update('tenants', { phone_country: v.toUpperCase() }, { id: t.id }).then(() => { t.phone_country = v.toUpperCase(); })
    }), 'how a bare number becomes E.164'));
    root.appendChild(acct);

    /* brand — the salon's, the palette is not */
    root.appendChild(section('Brand',
      'Their name and marks. The palette is NailScan’s and is not editable here — see public/config.js.'));
    const brand = el('div', 'hq-rows');
    ['name', 'city', 'intro', 'logo'].forEach(k => {
      brand.appendChild(row(
        k === 'logo' ? 'Logo URL' : k[0].toUpperCase() + k.slice(1),
        editable({
          get: () => (t.brand || {})[k] || '',
          placeholder: k === 'name' ? t.name : '',
          save: v => {
            const next = { ...(t.brand || {}) };
            if (v) next[k] = v; else delete next[k];
            return update('tenants', { brand: next }, { id: t.id }).then(() => { t.brand = next; });
          }
        }),
        k === 'intro' ? 'the line under the headline on their scanner' : null));
    });
    root.appendChild(brand);

    /* domains — the thing that decides whose book a scan lands in */
    root.appendChild(section('Domains',
      'The hostname a scan arrives on decides whose book it lands in. The primary one builds the report links her clients keep.'));
    const dwrap = el('div', 'hq-rows');
    (t.hosts || []).forEach(h => {
      const r = el('div', 'hq-row hq-host');
      const left = el('div', 'hq-label');
      left.appendChild(el('span', null, h.host));
      left.appendChild(el('small', null, h.verified_at ? 'DNS verified' : 'not verified yet'));
      r.appendChild(left);

      const acts = el('div', 'hq-acts');
      if (h.is_primary) {
        acts.appendChild(el('span', 'chip', 'primary'));
      } else {
        const mk = el('button', 'btn-quiet', 'Make primary');
        mk.type = 'button';
        mk.addEventListener('click', async () => {
          mk.disabled = true;
          try {
            // One primary per salon is a unique index, so the old one has to go
            // first — two updates, and the index is what stops a half-applied
            // pair from ever existing.
            await update('tenant_domains', { is_primary: false }, { tenant_id: t.id });
            await update('tenant_domains', { is_primary: true }, { id: h.id });
            await refresh(t.id);
          } catch (e) { mk.disabled = false; crash(e.message); }
        });
        acts.appendChild(mk);
        const rm = el('button', 'btn-quiet', 'Remove');
        rm.type = 'button';
        rm.addEventListener('click', async () => {
          rm.disabled = true;
          try {
            // Archived, never deleted: a hostname somebody's client still holds
            // a link on must stay explainable.
            await update('tenant_domains', { archived_at: new Date().toISOString() }, { id: h.id });
            await refresh(t.id);
          } catch (e) { rm.disabled = false; crash(e.message); }
        });
        acts.appendChild(rm);
      }
      r.appendChild(acts);
      dwrap.appendChild(r);
    });

    const addHost = el('form', 'hq-add');
    const hostIn = el('input', 'hq-input');
    hostIn.type = 'text';
    hostIn.placeholder = 'nails.theirsalon.com';
    const hostBtn = el('button', 'btn-quiet', 'Add domain');
    hostBtn.type = 'submit';
    addHost.appendChild(hostIn);
    addHost.appendChild(hostBtn);
    addHost.addEventListener('submit', async ev => {
      ev.preventDefault();
      const host = hostIn.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!host) return;
      hostBtn.disabled = true;
      try {
        await insert('tenant_domains', {
          tenant_id: t.id, host,
          is_primary: (t.hosts || []).length === 0
        });
        hostIn.value = '';
        await refresh(t.id);
      } catch (e) {
        crash(/duplicate|unique/i.test(e.message)
          ? host + ' already belongs to a salon.' : e.message);
      } finally { hostBtn.disabled = false; }
    });
    dwrap.appendChild(addHost);
    root.appendChild(dwrap);

    /* settings — their plumbing */
    root.appendChild(section('Their plumbing',
      'Where this salon’s leads go and where their clients book. Leave the webhook empty to use ours.'));
    const st = t.settings || {};
    const swrap = el('div', 'hq-rows');
    const settingRows = [
      ['ghl_webhook_url', 'CRM webhook', 'their GoHighLevel inbound webhook'],
      ['booking_url', 'Booking URL', null],
      ['cross_link_url', 'Cross-link URL', 'the button under her reading'],
      ['cross_link_label', 'Cross-link label', null],
      ['support_email', 'Support email', null]
    ];
    settingRows.forEach(([k, label, hint]) => {
      swrap.appendChild(row(label, editable({
        get: () => st[k] || '',
        placeholder: k === 'ghl_webhook_url' ? 'ours' : '',
        save: async v => {
          const patch = {}; patch[k] = v || null;
          await upsertSettings(t.id, patch);
          st[k] = v || null;
          t.settings = st;
        }
      }), hint));
    });
    root.appendChild(swrap);

    /* the menu — the one place order is the data */
    root.appendChild(section('Service menu',
      'This is the order their clients see. Drag a row, or use the arrows on a touchscreen. Click any value to change it.'));
    const menu = el('ul', 'hq-menu');
    root.appendChild(menu);
    loadServices(t, menu);

    /* credits */
    root.appendChild(section('Credits', 'Improvement reports cost money to generate, so they are metered.'));
    const grant = el('form', 'hq-add');
    const amt = el('input', 'hq-input');
    amt.type = 'number'; amt.min = '1'; amt.value = '50'; amt.style.maxWidth = '120px';
    const gb = el('button', 'btn-quiet', 'Grant credits');
    gb.type = 'submit';
    grant.appendChild(amt); grant.appendChild(gb);
    grant.addEventListener('submit', async ev => {
      ev.preventDefault();
      const n = parseInt(amt.value, 10);
      if (!n || n < 1) return;
      gb.disabled = true;
      try {
        await insert('credit_ledger', {
          tenant_id: t.id, delta: n, reason: 'hq_grant',
          idempotency_key: 'hq-' + Date.now()
        });
        await refresh(t.id);
      } catch (e) { crash(e.message); } finally { gb.disabled = false; }
    });
    root.appendChild(grant);
  }

  /* ------------------------------------------------------- the drag menu */

  async function loadServices(t, menu) {
    const tenantId = t.id;
    const { data, error } = await sb.from('services')
      .select('id, slug, name, price_cents, duration_min, sort_order, archived_at')
      .eq('tenant_id', tenantId).is('archived_at', null)
      .order('sort_order', { ascending: true });
    if (error) return crash(error.message);

    const rows = data || [];
    menu.replaceChildren();

    rows.forEach(s => menu.appendChild(serviceRow(t, s, menu)));
    paintMoves(menu);

    const add = el('form', 'hq-add');
    const nameIn = el('input', 'hq-input');
    nameIn.type = 'text'; nameIn.placeholder = 'Gel polish';
    const b = el('button', 'btn-quiet', 'Add service');
    b.type = 'submit';
    add.appendChild(nameIn); add.appendChild(b);
    add.addEventListener('submit', async ev => {
      ev.preventDefault();
      const name = nameIn.value.trim();
      if (!name) return;
      b.disabled = true;
      try {
        await insert('services', {
          tenant_id: tenantId, name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60),
          price_cents: 0,
          sort_order: (rows.length + 1) * 10
        });
        nameIn.value = '';
        loadServices(t, menu);
      } catch (e) {
        crash(/duplicate|unique/i.test(e.message) ? 'That slug is already on their menu.' : e.message);
      } finally { b.disabled = false; }
    });
    const li = el('li', 'hq-menu-add');
    li.appendChild(add);
    menu.appendChild(li);
  }

  function serviceRow(t, s, menu) {
    const tenantId = t.id;
    const li = el('li', 'hq-item');
    li.draggable = true;
    li.dataset.id = s.id;

    // Drag is the fast way; it is not the only way. HTML5 drag events never
    // fire from a touchscreen, and they cannot be reached from a keyboard, so
    // the same move is also two buttons. Same commit path either way.
    const handle = el('div', 'hq-handle');
    const grip = el('span', 'hq-grip');
    grip.setAttribute('aria-hidden', 'true');
    handle.appendChild(grip);

    function nudge(dir) {
      const sib = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
      if (!sib || !sib.classList.contains('hq-item')) return;
      if (dir < 0) menu.insertBefore(li, sib); else menu.insertBefore(sib, li);
      commitOrder(tenantId, menu);
      const again = li.querySelector(dir < 0 ? '.hq-up' : '.hq-down');
      if (again) again.focus();
      paintMoves(menu);
    }
    ['up', 'down'].forEach(function (way) {
      const btn = el('button', 'hq-move hq-' + way, way === 'up' ? '\u2191' : '\u2193');
      btn.type = 'button';
      btn.title = 'Move ' + way;
      btn.setAttribute('aria-label', 'Move ' + s.name + ' ' + way);
      btn.addEventListener('click', () => nudge(way === 'up' ? -1 : 1));
      handle.appendChild(btn);
    });
    li.appendChild(handle);

    const body = el('div', 'hq-item-body');
    const nameWrap = el('div', 'hq-item-name');
    nameWrap.appendChild(editable({
      get: () => s.name,
      save: v => update('services', { name: v }, { id: s.id }).then(() => { s.name = v; })
    }));
    body.appendChild(nameWrap);

    const meta = el('div', 'hq-item-meta');
    meta.appendChild(editable({
      get: () => s.price_cents,
      type: 'number',
      format: v => money(v, t.currency, t.locale),
      save: v => {
        // Integer cents, always. A price typed as 55.5 must not become 55.5
        // cents, and must not become a float anywhere near money.
        const cents = Math.round(parseFloat(v || 0) * (String(v).includes('.') ? 100 : 1));
        return update('services', { price_cents: cents }, { id: s.id }).then(() => { s.price_cents = cents; });
      }
    }));
    meta.appendChild(editable({
      get: () => s.duration_min,
      type: 'number',
      placeholder: 'mins',
      format: v => v ? v + ' min' : '',
      save: v => update('services', { duration_min: v ? parseInt(v, 10) : null }, { id: s.id })
        .then(() => { s.duration_min = v ? parseInt(v, 10) : null; })
    }));
    meta.appendChild(el('span', 'hq-slug', s.slug));
    body.appendChild(meta);
    li.appendChild(body);

    const arch = el('button', 'btn-quiet', 'Archive');
    arch.type = 'button';
    arch.addEventListener('click', async () => {
      arch.disabled = true;
      try {
        await update('services', { archived_at: new Date().toISOString() }, { id: s.id });
        loadServices(t, menu);
      } catch (e) { arch.disabled = false; crash(e.message); }
    });
    li.appendChild(arch);

    li.addEventListener('dragstart', ev => {
      li.classList.add('is-dragging');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', s.id);
    });
    li.addEventListener('dragend', () => {
      li.classList.remove('is-dragging');
      commitOrder(tenantId, menu);
      paintMoves(menu);
    });
    li.addEventListener('dragover', ev => {
      ev.preventDefault();
      const dragging = menu.querySelector('.is-dragging');
      if (!dragging || dragging === li) return;
      const box = li.getBoundingClientRect();
      const after = ev.clientY > box.top + box.height / 2;
      menu.insertBefore(dragging, after ? li.nextSibling : li);
    });
    return li;
  }

  /* The first row cannot move up and the last cannot move down; a button that
     does nothing when pressed is worse than one that is visibly out. */
  function paintMoves(menu) {
    const items = [...menu.querySelectorAll('.hq-item')];
    items.forEach((n, i) => {
      const up = n.querySelector('.hq-up'), down = n.querySelector('.hq-down');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === items.length - 1;
    });
  }

  /* One call, one transaction. Applying an order as N separate updates leaves a
     half-ordered menu if the connection drops mid-drag. */
  async function commitOrder(tenantId, menu) {
    const ids = [...menu.querySelectorAll('.hq-item')].map(n => n.dataset.id);
    if (!ids.length) return;
    const { data, error } = await sb.rpc('reorder_services', { p: { tenant_id: tenantId, ids } });
    if (error) return crash(error.message);
    if (!data) crash('Nothing moved — that menu is not yours to reorder.');
  }

  /* ------------------------------------------------------------- plumbing */

  async function update(table, patch, match) {
    let q = sb.from(table).update(patch);
    Object.keys(match).forEach(k => { q = q.eq(k, match[k]); });
    const { error } = await q;
    if (error) throw new Error(error.message);
  }

  async function insert(table, rowData) {
    const { error } = await sb.from(table).insert(rowData);
    if (error) throw new Error(error.message);
  }

  async function upsertSettings(tenantId, patch) {
    const { error } = await sb.from('tenant_settings')
      .upsert({ tenant_id: tenantId, ...patch }, { onConflict: 'tenant_id' });
    if (error) throw new Error(error.message);
  }

  async function refresh(openId) {
    await load();
    if (openId) renderDetail(openId); else renderList();
  }

  function crash(msg) {
    const c = $('crash');
    if (!c) return;
    c.textContent = msg;
    c.hidden = false;
    setTimeout(() => { c.hidden = true; }, 6000);
  }

  function section(label, sub) {
    const s = el('section', 'band');
    const h = el('div', 'band-head');
    h.appendChild(el('p', 'eyebrow', label));
    s.appendChild(h);
    if (sub) s.appendChild(el('p', 'hq-sub', sub));
    return s;
  }

  function tile(label, value, sub) {
    const d = el('div', 'tile');
    d.appendChild(el('dt', null, label));
    const dd = el('dd', null, value);
    if (sub) dd.appendChild(el('small', null, sub));
    d.appendChild(dd);
    return d;
  }

  return {
    async open() { await load(); renderList(); },
    refresh
  };
}
