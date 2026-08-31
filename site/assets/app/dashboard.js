/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════════════════════

   Four views over one ledger. Every number on screen is derived at render
   time from Brand + Ledger, never cached — which is why changing the accent
   or a price in Branding re-prices the entire history in front of the owner
   instead of after a save-and-reload. That live re-price is the demo.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var el = function (s, r) { return (r || document).querySelector(s); };
  var els = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var fmt = Chart.fmt;

  Brand.apply(Brand.resolve());

  var range = 30;                  // days; 0 = all
  var view = 'overview';

  /* ── Chrome ───────────────────────────────────────────────────────────── */

  var TITLES = {
    overview: ['Overview', 'Every scan, every client, every booking.'],
    leads:    ['Leads', 'Who scanned, what they were quoted, and who still needs a call.'],
    clients:  ['Clients', 'One file per person, matched on phone number.'],
    scans:    ['Scans', 'The raw ledger. Nothing is deleted, ever.'],
    settings: ['Branding', 'Your name, your colour, your prices. One place.']
  };

  function paintBrand() {
    paintBrandLight();
    el('[data-ledger-count]').textContent = fmt(Ledger.scans.length + Ledger.retakes.length);
    render();
  }

  function setView(name) {
    view = name;
    els('[data-view-panel]').forEach(function (v) {
      v.classList.toggle('on', v.getAttribute('data-view-panel') === name);
    });
    els('.navlink').forEach(function (b) {
      if (b.getAttribute('data-view') === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    el('[data-title]').textContent = TITLES[name][0];
    el('[data-subtitle]').textContent = TITLES[name][1];
    // The range control means nothing on the branding screen.
    el('.range').style.visibility = name === 'settings' ? 'hidden' : '';
    render();
  }

  els('.navlink').forEach(function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });

  els('[data-range]').forEach(function (b) {
    b.addEventListener('click', function () {
      range = parseInt(b.getAttribute('data-range'), 10);
      els('[data-range]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', 'true');
      render();
    });
  });

  /* ── Render ───────────────────────────────────────────────────────────── */

  function render() {
    if (view === 'overview') renderOverview();
    if (view === 'leads') renderLeads();
    if (view === 'clients') renderClients();
    if (view === 'scans') renderScans();
    if (view === 'settings') renderSettings();
    paintLeadPip();
  }

  /* ── Overview ─────────────────────────────────────────────────────────── */

  function renderOverview() {
    var d = range || Ledger.DAYS;
    var t = Ledger.totals(d);
    // Same-length previous window, for the deltas. A tile with no comparison
    // is a number without a verdict.
    var prev = deltaWindow(d);

    var series = Ledger.byDay(d);
    var sparkScans = series.map(function (p) { return p.scans; });
    var sparkRev = series.map(function (p) { return p.revenue; });

    el('[data-tiles]').innerHTML = [
      tile('Scans', fmt(t.scans), t.uniqueClients + ' people · ' + t.retakes + ' asked to retake',
           delta(t.scans, prev.scans), 'sp1'),
      tile('Booked', fmt(t.booked), Math.round(t.bookRate * 100) + '% of scans became a booking',
           delta(t.booked, prev.booked), 'sp2'),
      tile('Revenue in the chair', Brand.money(t.revenue), fmt(t.showed) + ' appointments kept',
           delta(t.revenue, prev.revenue), 'sp3'),
      tile('Average ticket', Brand.money(t.avgTicket), 'quoted ' + Brand.money(t.quoted) + ' across the window',
           delta(t.avgTicket, prev.avgTicket), 'sp4')
    ].join('');

    Chart.spark(el('[data-sp="sp1"]'), sparkScans, '--s1');
    Chart.spark(el('[data-sp="sp2"]'), series.map(function (p) { return p.booked; }), '--s2');
    // Both money tiles share one hue. Giving each tile its own colour would
    // spend four categorical slots on decoration and imply four series that
    // do not exist — scans, bookings and money are the only three identities
    // on this screen.
    Chart.spark(el('[data-sp="sp3"]'), sparkRev, '--s5');
    Chart.spark(el('[data-sp="sp4"]'), sparkRev, '--s5');

    // Trend. Daily points get noisy past ~45 days, so longer ranges bucket
    // into weeks — the shape survives and the crosshair stays readable.
    var pts = series.map(function (p) {
      return { label: shortDate(p.date), full: longDate(p.date), a: p.scans, b: p.booked };
    });
    if (pts.length > 45) pts = bucket(series, 7);

    Chart.line(el('[data-chart-trend]'), {
      id: 'trend', data: pts, seriesA: 'Scans', seriesB: 'Booked', height: 230,
      title: 'Scans and bookings over time',
      aria: 'Scans and bookings per ' + (pts.length > 45 ? 'day' : 'period') +
            ' over the last ' + d + ' days. ' + fmt(t.scans) + ' scans and ' + fmt(t.booked) + ' bookings in total.'
    });

    Chart.funnel(el('[data-chart-funnel]'), Ledger.funnel(d));

    var mix = Ledger.serviceMix(d);
    Chart.bars(el('[data-chart-services]'), mix.map(function (m) {
      return {
        label: Ledger.serviceName(m.key),
        value: m.count,
        detail: fmt(m.count) + ' scans routed here · ' + Brand.money(m.revenue) + ' collected'
      };
    }), { colour: '--s1' });

    var src = Ledger.sourceMix(d);
    el('[data-source-table]').innerHTML = Chart.table(src.map(function (s) {
      return [
        '<span class="nm">' + s.label + '</span>' +
          (s.paid ? ' <span class="pill" style="margin-left:6px">paid</span>' : ''),
        '<span class="num">' + fmt(s.scans) + '</span>',
        '<span class="num">' + fmt(s.booked) + '</span>',
        '<span class="num">' + (s.scans ? Math.round(s.booked / s.scans * 100) : 0) + '%</span>',
        '<span class="num">' + Brand.money(s.revenue) + '</span>'
      ];
    }), ['Source', '<span class="num">Scans</span>', '<span class="num">Booked</span>',
         '<span class="num">Rate</span>', '<span class="num">Revenue</span>']);
    // th alignment lives in a class, not in the cell markup above.
    els('[data-source-table] th').forEach(function (th, i) { if (i) th.classList.add('num'); });
    els('[data-source-table] td').forEach(function (td) {
      if (el('.num', td)) td.classList.add('num');
    });
  }

  function tile(k, v, d, del, sp) {
    return '<div class="tile"><div class="tk">' + k + '</div>' +
      '<div class="tv">' + v + '</div>' +
      '<div class="td">' + d + '</div>' +
      (del ? '<div style="margin-top:8px">' + del + '</div>' : '') +
      '<div class="tsp" data-sp="' + sp + '"></div></div>';
  }

  function delta(now, before) {
    if (!before) return '';
    var pct = Math.round((now - before) / before * 100);
    var cls = pct > 2 ? 'up' : pct < -2 ? 'down' : 'flat';
    return '<span class="delta ' + cls + '">' + Math.abs(pct) + '% vs previous ' +
           (range || Ledger.DAYS) + ' days</span>';
  }

  function deltaWindow(d) {
    var older = Ledger.scans.filter(function (s) { return s.dayOffset >= d && s.dayOffset < d * 2; });
    var booked = older.filter(function (s) { return s.booked; }).length;
    var showed = older.filter(function (s) { return s.showed; });
    var revenue = showed.reduce(function (a, s) { return a + Ledger.priceOf(s.service); }, 0);
    return {
      scans: older.length, booked: booked, revenue: revenue,
      avgTicket: showed.length ? Math.round(revenue / showed.length) : 0
    };
  }

  function bucket(series, size) {
    var out = [];
    for (var i = 0; i < series.length; i += size) {
      var chunk = series.slice(i, i + size);
      out.push({
        label: shortDate(chunk[0].date),
        full: longDate(chunk[0].date) + ' – ' + longDate(chunk[chunk.length - 1].date),
        a: chunk.reduce(function (a, p) { return a + p.scans; }, 0),
        b: chunk.reduce(function (a, p) { return a + p.booked; }, 0)
      });
    }
    return out;
  }

  function shortDate(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  function longDate(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     LEADS — the screen the console is actually opened for
     ═══════════════════════════════════════════════════════════════════════

     Overview answers "how is it going", Clients answers "who is she", Scans
     answers "what did the engine decide". None of them answer the question an
     owner has at 9am on a Monday, which is "who do I call first". This does.

     Three rules held to throughout:

     1. EVERY LEAD CARRIES A NUMBER AND A REASON. A lead list that shows a
        name and a date makes the owner open something else before she can
        act. Each row carries the phone, what the scan quoted, and the
        service it routed to, because that is the whole content of the call.

     2. THE ACTIONS ARE REAL LINKS. `tel:` and `sms:` open the phone's own
        dialler and messages app with the body already written, including the
        report link. No integration to buy, nothing to configure, works on the
        salon's existing phone on day one.

     3. STATUS IS OWNED BY THE OWNER, NOT INFERRED. Marking a lead called or
        booked writes to storage and survives reload. The seeded ledger sets
        an initial state; every change after that is hers.
     ═══════════════════════════════════════════════════════════════════════ */

  var LEAD_KEY = 'nailscan.leadstate.v1';

  var LeadState = (function () {
    var map = null;
    function load() {
      if (map) return map;
      try { map = JSON.parse(localStorage.getItem(LEAD_KEY)) || {}; } catch (e) { map = {}; }
      return map;
    }
    function save() {
      try { localStorage.setItem(LEAD_KEY, JSON.stringify(map)); } catch (e) { /* private mode */ }
    }
    return {
      // The seeded value is the starting point; anything the owner has since
      // done wins over it.
      of: function (s) {
        var o = load()[s.id];
        return {
          called: o && 'called' in o ? o.called : s.called,
          booked: o && 'booked' in o ? o.booked : s.booked,
          note: (o && o.note) || ''
        };
      },
      set: function (id, patch) {
        load();
        map[id] = Object.assign({}, map[id], patch);
        save();
      },
      clear: function () { map = {}; save(); }
    };
  }());

  var leadFilter = 'todo';
  var leadQuery = '';

  els('[data-lead-filter]').forEach(function (b) {
    b.addEventListener('click', function () {
      leadFilter = b.getAttribute('data-lead-filter');
      els('[data-lead-filter]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', 'true');
      renderLeads();
    });
  });

  el('[data-lead-search]').addEventListener('input', function (e) {
    leadQuery = e.target.value.toLowerCase().trim();
    renderLeads();
  });

  /* A lead is a scan that cleared the gate and reached a person. Rejected
     frames never became a lead, so they are not in this list — the retake
     queue is a different problem and pretending otherwise would inflate the
     one number an owner uses to judge whether this thing works. */
  function leadRows() {
    var d = range || Ledger.DAYS;
    return Ledger.scans
      .filter(function (s) { return s.dayOffset < d; })
      .map(function (s) {
        var c = Ledger.clientById(s.clientId);
        var st = LeadState.of(s);
        return {
          scan: s, client: c, called: st.called, booked: st.booked, note: st.note,
          name: c ? c.name : 'Unknown', phone: c ? c.phone : '',
          value: Ledger.priceOf(s.service),
          stage: st.booked ? 'booked' : st.called ? 'chasing' : 'todo'
        };
      })
      // Uncalled first, then newest first. Newest rather than oldest because
      // an inbound lead converts on speed — she scanned twenty minutes ago and
      // is still thinking about her nails, while the one from four weeks ago
      // has already been somewhere else. The ones going cold are not buried:
      // every card past three days carries a "N days cold" pill, and the
      // filter is how an owner works that pile deliberately rather than by
      // accident of sort order.
      .sort(function (a, b) {
        if (a.stage !== b.stage) return a.stage === 'todo' ? -1 : b.stage === 'todo' ? 1 : 0;
        return a.scan.dayOffset - b.scan.dayOffset;
      });
  }

  function leadFiltered() {
    var rows = leadRows();
    if (leadFilter !== 'all') rows = rows.filter(function (r) { return r.stage === leadFilter; });
    if (leadQuery) {
      var digits = leadQuery.replace(/\D/g, '');
      rows = rows.filter(function (r) {
        return r.name.toLowerCase().indexOf(leadQuery) > -1 ||
               (digits && r.phone.replace(/\D/g, '').indexOf(digits) > -1);
      });
    }
    return rows;
  }

  function paintLeadPip() {
    var pip = el('[data-lead-pip]');
    if (!pip) return;
    var n = leadRows().filter(function (r) { return r.stage === 'todo'; }).length;
    pip.textContent = fmt(n);
    pip.hidden = n === 0;
  }

  function renderLeads() {
    var all = leadRows();
    var rows = leadFiltered();
    var todo = all.filter(function (r) { return r.stage === 'todo'; });
    var chasing = all.filter(function (r) { return r.stage === 'chasing'; });
    var booked = all.filter(function (r) { return r.stage === 'booked'; });
    var open = todo.concat(chasing).reduce(function (a, r) { return a + r.value; }, 0);

    el('[data-lead-tiles]').innerHTML =
      tile('Waiting on a call', fmt(todo.length), 'scanned, never contacted', '', '') +
      tile('Called, not booked', fmt(chasing.length), 'worth a second message', '', '') +
      tile('Quoted and unclaimed', Brand.money(open), 'sitting in the two columns above', '', '') +
      tile('Booked', fmt(booked.length),
           all.length ? Math.round(booked.length / all.length * 100) + '% of everyone who scanned' : '—', '', '');

    el('[data-lead-count]').textContent = fmt(rows.length) + ' lead' + (rows.length === 1 ? '' : 's');

    if (!rows.length) {
      el('[data-lead-list]').innerHTML =
        '<div class="panel-c" style="padding:34px;text-align:center;color:var(--fg-2)">' +
        (leadQuery ? 'Nobody matches “' + leadQuery + '”.'
                   : leadFilter === 'todo' ? 'Nobody is waiting on a call. Everyone who scanned has been contacted.'
                   : 'Nothing in this column yet.') + '</div>';
      return;
    }

    el('[data-lead-list]').innerHTML = rows.slice(0, 60).map(leadCard).join('');
    wireLeadCards(rows.slice(0, 60));
    if (rows.length > 60) {
      // Say what was dropped. A list that silently stops at 60 reads as "that
      // is everyone", which is the one thing a lead queue must never imply.
      el('[data-lead-list]').insertAdjacentHTML('beforeend',
        '<div class="hint" style="padding:12px 2px;color:var(--faint)">Showing the first 60 of ' +
        fmt(rows.length) + '. Narrow the range or search to see the rest.</div>');
    }
    // The handlers call this directly, so the sidebar count has to be updated
    // here rather than only in render().
    paintLeadPip();
  }

  function leadCard(r) {
    var s = r.scan;
    var svc = Brand.current.services[s.service];
    var age = s.dayOffset;
    var when = age === 0 ? 'today' : age === 1 ? 'yesterday' : age + ' days ago';
    var stagePill = r.booked ? '<span class="pill ok">booked</span>'
      : r.called ? '<span class="pill">called</span>'
      : age >= 3 ? '<span class="pill warn">' + age + ' days cold</span>'
      : '<span class="pill acc">new</span>';

    return '<div class="lead" data-lead="' + s.id + '">' +
      '<div class="lead-main">' +
        '<div class="lead-who">' +
          '<div class="lead-nm">' + r.name + '</div>' +
          '<a class="lead-ph" href="tel:' + r.phone.replace(/[^\d+]/g, '') + '">' + r.phone + '</a>' +
        '</div>' +
        '<div class="lead-facts">' +
          '<span>' + when + '</span>' +
          '<span>' + (svc ? svc.name : Ledger.serviceName(s.service)) + '</span>' +
          '<span class="lead-val">' + Brand.money(r.value) + '</span>' +
          '<span class="mono" style="font-size:.66rem">' + s.id + '</span>' +
          stagePill +
        '</div>' +
      '</div>' +
      // Call is the primary, not "Mark booked". Booking is the outcome;
      // calling is the thing she is here to do, and sixty solid accent
      // buttons down the page draw the eye to the wrong one.
      '<div class="lead-acts">' +
        '<a class="btn btn-primary lead-b" href="tel:' + r.phone.replace(/[^\d+]/g, '') + '">Call</a>' +
        '<button class="btn btn-ghost lead-b" data-lead-text="' + s.id + '">Text her report</button>' +
        '<button class="btn btn-ghost lead-b" data-lead-open="' + s.id + '">Record</button>' +
        (r.booked
          ? '<button class="btn btn-ghost lead-b on" data-lead-unbook="' + s.id + '">Booked ✓</button>'
          : '<button class="btn btn-ghost lead-b" data-lead-book="' + s.id + '">Mark booked</button>') +
      '</div>' +
    '</div>';
  }

  function wireLeadCards(rows) {
    var by = {};
    rows.forEach(function (r) { by[r.scan.id] = r; });

    els('[data-lead-open]').forEach(function (b) {
      b.addEventListener('click', function () { openScan(b.getAttribute('data-lead-open')); });
    });
    els('[data-lead-book]').forEach(function (b) {
      b.addEventListener('click', function () {
        LeadState.set(b.getAttribute('data-lead-book'), { booked: true, called: true });
        renderLeads();
      });
    });
    els('[data-lead-unbook]').forEach(function (b) {
      b.addEventListener('click', function () {
        LeadState.set(b.getAttribute('data-lead-unbook'), { booked: false });
        renderLeads();
      });
    });

    // Texting marks her called, because she has been. Anything else means the
    // owner sends the report and the lead sits in the "needs a call" column
    // looking untouched.
    els('[data-lead-text]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = by[b.getAttribute('data-lead-text')];
        if (!r) return;
        LeadState.set(r.scan.id, { called: true });
        var s = Brand.current;
        var svc = s.services[r.scan.service];
        var body = 'Hi ' + r.name.split(' ')[0] + ', it\'s ' + s.short + '. Here is your nail ' +
          'assessment from your scan: ' + reportLink(r.scan) + ' — it recommends ' +
          svc.name.toLowerCase() + ' at ' + Brand.money(svc.price) +
          '. Want me to hold you a slot this week?';
        // The separator differs by platform and getting it wrong opens an
        // empty message: iOS wants &body= after a ?, Android wants ?body=.
        var href = 'sms:' + r.phone.replace(/[^\d+]/g, '') +
          (/iPhone|iPad|Macintosh/.test(navigator.userAgent) ? '&' : '?') +
          'body=' + encodeURIComponent(body);
        window.location.href = href;
        renderLeads();
      });
    });
  }

  /* The permalink the client was sent, rebuilt from the stored fields. Same
     codec the scanner writes with, so what the owner texts is byte-identical
     to what the client already has. */
  function reportLink(s) {
    return location.origin + location.pathname.replace(/app\/[^/]*$/, 'scan/') +
      '#r=' + Report.pack([
        1, s.id, +new Date(s.date), s.obs.surface, s.obs.color, s.obs.structure, s.obs.cuticle,
        s.service, s.confidence, SKINS[fnv(s.id) % SKINS.length], Report.seedHash(s.id), 5,
        Brand.current.id, 1
      ]);
  }

  el('[data-lead-export]').addEventListener('click', function () {
    var rows = leadFiltered();
    var head = ['name', 'phone', 'scanned', 'report', 'routed_to', 'quoted', 'confidence',
                'called', 'booked', 'report_link'];
    var body = rows.map(function (r) {
      var s = r.scan, svc = Brand.current.services[s.service];
      return [r.name, r.phone, s.date, s.id, svc ? svc.name : s.service, svc ? svc.price : '',
              s.confidence, r.called ? 'yes' : 'no', r.booked ? 'yes' : 'no', reportLink(s)];
    });
    downloadCsv('leads-' + Brand.current.id + '.csv', head, body);
  });

  /* One CSV writer for the whole console. Quotes every field and doubles
     internal quotes — a salon name with a comma in it silently shifted every
     column right of it in the first version. */
  function downloadCsv(filename, head, body) {
    var esc = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var csv = [head.map(esc).join(',')].concat(body.map(function (r) {
      return r.map(esc).join(',');
    })).join('\r\n');
    var url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ── Clients ──────────────────────────────────────────────────────────── */

  var clientQuery = '';
  el('[data-client-search]').addEventListener('input', function (e) {
    clientQuery = e.target.value.toLowerCase().trim();
    renderClients();
  });

  function clientList() {
    var rows = Ledger.clientRows();
    if (!clientQuery) return rows;
    return rows.filter(function (r) {
      return r.name.toLowerCase().indexOf(clientQuery) > -1 ||
             r.phone.replace(/\D/g, '').indexOf(clientQuery.replace(/\D/g, '')) > -1;
    });
  }

  function renderClients() {
    var rows = clientList();
    el('[data-client-count]').textContent = fmt(rows.length) + ' client' + (rows.length === 1 ? '' : 's');

    el('[data-client-table]').innerHTML = Chart.table(rows.slice(0, 120).map(function (c) {
      var due = c.dueInDays;
      var duePill = due < 0
        ? '<span class="pill warn">' + Math.abs(due) + 'd overdue</span>'
        : due <= 7 ? '<span class="pill acc">due in ' + due + 'd</span>'
        : '<span class="pill">' + due + 'd</span>';
      var trend = c.trend === null ? '<span class="delta flat">first visit</span>'
        : c.trend > 0 ? '<span class="delta up">improving</span>'
        : c.trend < 0 ? '<span class="delta down">watch</span>'
        : '<span class="delta flat">steady</span>';
      return [
        '<span class="nm" data-open-client="' + c.id + '">' + c.name + '</span>' +
          '<div style="font-size:.74rem;color:var(--faint)">' + c.phone + '</div>',
        '<span class="num">' + c.visits + '</span>',
        Ledger.serviceName(c.lastService),
        trend,
        duePill,
        '<span class="num">' + Brand.money(c.revenue) + '</span>'
      ];
    }), ['Client', '<span class="num">Visits</span>', 'Last service', 'Trend', 'Next due',
         '<span class="num">Revenue</span>']);

    els('[data-client-table] tbody tr').forEach(function (tr, i) {
      tr.classList.add('clickable');
      tr.setAttribute('tabindex', '0');
      var id = rows[i].id;
      var open = function () { openClient(id); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    markNums('[data-client-table]');
  }

  function markNums(sel) {
    els(sel + ' th').forEach(function (th) { if (el('.num', th)) th.classList.add('num'); });
    els(sel + ' td').forEach(function (td) { if (el('.num', td)) td.classList.add('num'); });
  }

  /* ── Scans ────────────────────────────────────────────────────────────── */

  var scanQuery = '';
  el('[data-scan-search]').addEventListener('input', function (e) {
    scanQuery = e.target.value.toLowerCase().trim();
    renderScans();
  });

  function renderScans() {
    var d = range || Ledger.DAYS;
    var list = Ledger.scans.filter(function (s) { return s.dayOffset < d; }).slice().reverse();
    if (scanQuery) {
      list = list.filter(function (s) {
        var c = Ledger.clientById(s.clientId);
        return s.id.toLowerCase().indexOf(scanQuery) > -1 ||
               (c && c.name.toLowerCase().indexOf(scanQuery) > -1);
      });
    }
    el('[data-scan-count]').textContent = fmt(list.length) + ' scan' + (list.length === 1 ? '' : 's');

    el('[data-scan-table]').innerHTML = Chart.table(list.slice(0, 120).map(function (s) {
      var c = Ledger.clientById(s.clientId);
      var status = s.showed ? '<span class="pill ok">kept</span>'
        : s.booked ? '<span class="pill acc">booked</span>'
        : s.called ? '<span class="pill">called</span>'
        : s.opened ? '<span class="pill">opened</span>'
        : '<span class="pill">sent</span>';
      return [
        '<span class="nm" style="font-family:var(--mono);font-size:.76rem">' + s.id + '</span>',
        shortDate(s.date),
        c ? c.name : '—',
        Ledger.serviceName(s.service) + ' <span class="pill" style="margin-left:6px">' + s.rule + '</span>',
        status,
        '<span class="num">' + Brand.money(Ledger.priceOf(s.service)) + '</span>'
      ];
    }), ['Report', 'Date', 'Client', 'Routed to', 'Status', '<span class="num">Quoted</span>']);

    els('[data-scan-table] tbody tr').forEach(function (tr, i) {
      tr.classList.add('clickable');
      tr.setAttribute('tabindex', '0');
      var id = list[i].id;
      var open = function () { openScan(id); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    markNums('[data-scan-table]');
  }

  /* ── Drawer ───────────────────────────────────────────────────────────── */

  var drawer = el('[data-drawer]');
  var scrim = el('[data-scrim]');
  var lastFocus = null;

  function openDrawer(kind, title, sub, body) {
    lastFocus = document.activeElement;
    el('[data-drawer-kind]').textContent = kind;
    el('[data-drawer-title]').textContent = title;
    el('[data-drawer-sub]').textContent = sub;
    el('[data-drawer-body]').innerHTML = body;
    drawer.hidden = false;
    // Next frame, so the transform transition has a start state to run from.
    requestAnimationFrame(function () { drawer.classList.add('on'); scrim.classList.add('on'); });
    el('[data-drawer-close]').focus();
  }

  function closeDrawer() {
    drawer.classList.remove('on'); scrim.classList.remove('on');
    setTimeout(function () { drawer.hidden = true; }, 340);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    Chart.hideTip();
  }

  el('[data-drawer-close]').addEventListener('click', closeDrawer);
  scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
  });

  function openClient(id) {
    var c = Ledger.clientById(id);
    if (!c) return;
    var rows = Ledger.clientRows().filter(function (r) { return r.id === id; })[0];
    var revenue = c.visits.reduce(function (a, s) { return a + (s.showed ? Ledger.priceOf(s.service) : 0); }, 0);

    // Field-by-field progression across every visit. This is the clinic-chart
    // argument the whole product rests on, so it gets the top of the drawer.
    var prog = Ledger.FIELDS.map(function (f) {
      return '<div class="progrow"><span class="pk">' + f + '</span><span class="progdots">' +
        c.visits.map(function (v) {
          return '<i data-v="' + v.obs[f] + '" title="' + shortDate(v.date) + ' · ' +
                 Ledger.READINGS[f][v.obs[f]] + '"></i>';
        }).join('') + '</span></div>';
    }).join('');

    var history = c.visits.slice().reverse().map(function (v) {
      return '<div class="row"><span class="k">' + shortDate(v.date) + '</span>' +
        '<span class="v">' + Ledger.serviceName(v.service) +
        ' <span style="color:var(--faint)">· ' + v.id + '</span></span>' +
        (v.showed ? '<span class="pill ok">' + Brand.money(Ledger.priceOf(v.service)) + '</span>'
                  : '<span class="pill">not kept</span>') + '</div>';
    }).join('');

    openDrawer('Client file', c.name, c.phone + ' · first seen ' + longDate(c.firstSeen),
      '<div class="tiles" style="grid-template-columns:1fr 1fr">' +
        '<div class="tile"><div class="tk">Visits</div><div class="tv">' + c.visits.length + '</div></div>' +
        '<div class="tile"><div class="tk">Revenue</div><div class="tv">' + Brand.money(revenue) + '</div></div>' +
      '</div>' +
      '<div class="sec-lbl mono" style="margin:24px 0 12px">Progression · left to right, visit by visit</div>' +
      '<div class="prog">' + prog + '</div>' +
      '<div class="legend" style="margin-top:14px">' +
        '<span><i style="background:var(--ok)"></i>Ready</span>' +
        '<span><i style="background:var(--warn)"></i>Prep first</span>' +
        '<span><i style="background:var(--s2)"></i>Full prep</span>' +
      '</div>' +
      '<div class="mono" style="margin:26px 0 10px">Visit history</div>' +
      '<div class="rows">' + history + '</div>' +
      '<div class="mono" style="margin:26px 0 10px">Next</div>' +
      '<div class="rows"><div class="row"><span class="k">due</span>' +
        '<span class="v">' + (rows.dueInDays < 0
          ? Math.abs(rows.dueInDays) + ' days overdue for a rebook'
          : 'Due back in ' + rows.dueInDays + ' days') + '</span>' +
        '<span class="pill ' + (rows.dueInDays < 0 ? 'warn' : 'ok') + '">' +
        (rows.dueInDays < 0 ? 'call her' : 'on track') + '</span></div></div>');
  }

  function openScan(id) {
    var s = Ledger.scanById(id);
    if (!s) return;
    var c = Ledger.clientById(s.clientId);
    var svc = Brand.current.services[s.service];

    var readings = Ledger.FIELDS.map(function (f) {
      return '<div class="row"><span class="k">obs.' + f + '</span>' +
        '<span class="v">' + s.readings[f] + '</span>' +
        '<span class="pill ' + (s.obs[f] ? 'warn' : 'ok') + '">' +
        (s.obs[f] ? 'prep first' : 'ready') + '</span></div>';
    }).join('');

    var derived = [
      ['confidence', s.confidence.toFixed(2) + ' — above threshold 0.72', 'ok', 'pass'],
      ['prep_steps', s.prep.length ? s.prep.join(' · ') : 'none needed', s.prep.length ? 'warn' : 'ok', String(s.prep.length)],
      ['rule fired', s.rule + (s.rule === 'R0' ? ' — default path' : ' — compound'), 'ok', s.rule],
      ['recommended', svc.name + ' · ' + Brand.money(svc.price), 'ok', 'quoted'],
      ['care_plan', 'Rebook at ' + svc.rebook + ' weeks', 'ok', 'bound']
    ].map(function (r) {
      return '<div class="row"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span>' +
             '<span class="pill ' + r[2] + '">' + r[3] + '</span></div>';
    }).join('');

    var journey = [
      ['report', s.opened ? 'Sent · opened' : 'Sent', s.opened ? 'ok' : '', s.opened ? 'read' : 'sent'],
      ['contacted', s.called ? 'Called from the console' : 'Not yet called', s.called ? 'ok' : 'warn', s.called ? 'yes' : 'no'],
      ['booked', s.booked ? 'Appointment made' : 'No booking', s.booked ? 'ok' : 'warn', s.booked ? 'yes' : 'no'],
      ['kept', s.showed ? 'She came in' : (s.booked ? 'Did not show' : '—'), s.showed ? 'ok' : 'warn', s.showed ? 'yes' : 'no']
    ].map(function (r) {
      return '<div class="row"><span class="k">' + r[0] + '</span><span class="v">' + r[1] + '</span>' +
             '<span class="pill ' + r[2] + '">' + r[3] + '</span></div>';
    }).join('');

    // "Report link on the record" — platform.html sells it as a line item, and
    // until the scanner could carry a whole reading in a URL the console had
    // nowhere to point. The link re-renders exactly what the client saw,
    // because it contains exactly what she was sent.
    var link = reportLink(s);

    openDrawer('Scan record', s.id,
      (c ? c.name : 'Unknown') + ' · ' + longDate(s.date) + ' · visit ' + (s.visitIndex + 1),
      '<div class="mono" style="margin:0 0 10px">Observation fields · set by ONYX-5</div>' +
      '<div class="rows">' + readings + '</div>' +
      '<div class="mono" style="margin:24px 0 10px">Derived by Verdict Core</div>' +
      '<div class="rows">' + derived + '</div>' +
      '<div class="hint" style="font-size:.76rem;color:var(--faint);margin-top:10px;line-height:1.5">' +
        'Everything below the confidence row was derived, not written. The same readings always ' +
        'produce the same service and the same price.</div>' +
      '<div class="mono" style="margin:24px 0 10px">What happened next</div>' +
      '<div class="rows">' + journey + '</div>' +
      '<a class="btn btn-ghost" style="margin-top:20px;display:block;text-align:center" ' +
        'href="' + link + '" target="_blank" rel="noopener">Open the report she was sent</a>' +
      '<div class="hint" style="font-size:.76rem;color:var(--faint);margin-top:10px;line-height:1.5">' +
        'Re-rendered from the stored fields, not from a cached picture of the page. ' +
        'A report from a year ago opens the same way.</div>');
  }

  /* Stand-in skin measurements for the mock ledger. A real record stores the
     sampled value; these are stable per scan id so a client's palette does not
     change between two openings of the same record. */
  var SKINS = [
    [242, 214, 190], [228, 196, 168], [212, 176, 145], [198, 166, 124],
    [178, 141, 108], [150, 113,  84], [120,  88,  64], [ 92,  66,  48]
  ];
  function fnv(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ── Export ───────────────────────────────────────────────────────────── */

  el('[data-export]').addEventListener('click', function () {
    // Was its own inline CSV writer with no BOM and no anchor in the document,
    // which meant Excel mangled accented salon names and Firefox ignored the
    // click. One writer now, shared with the lead export.
    downloadCsv(Brand.current.id + '-clients.csv',
      ['client_id', 'name', 'phone', 'source', 'first_seen', 'last_seen',
       'visits', 'last_service', 'revenue', 'due_in_days'],
      Ledger.clientRows().map(function (c) {
        return [c.id, c.name, c.phone, c.source, c.firstSeen, c.lastSeen, c.visits,
                Ledger.serviceName(c.lastService), c.revenue, c.dueInDays];
      }));
  });

  /* ── Branding ─────────────────────────────────────────────────────────── */

  var SWATCHES = ['#FF5233', '#C9A227', '#3B82F6', '#E0457B', '#12B886', '#8B5CF6', '#F97316', '#EF4444'];

  function renderSettings() {
    var s = Brand.current;
    el('[data-set="name"]').value = s.name;
    el('[data-set="monogram"]').value = s.monogram;
    el('[data-set="phone"]').value = s.phone;

    el('[data-swatches]').innerHTML = SWATCHES.map(function (c) {
      return '<button class="swatch" style="background:' + c + '" data-accent="' + c + '" ' +
             'aria-pressed="' + (c.toLowerCase() === s.accent.toLowerCase()) + '" ' +
             'aria-label="Accent ' + c + '"></button>';
    }).join('');

    el('[data-color-well]').value = s.accent;
    el('[data-hex]').value = s.accent.toUpperCase();
    noteContrast(s.accent);
    paintLogoZone(s);

    el('[data-fontpick]').innerHTML = Object.keys(Brand.FONTS).map(function (k) {
      var f = Brand.FONTS[k];
      return '<button type="button" class="fontopt" data-font="' + k + '" ' +
        'aria-pressed="' + (s.font === k) + '">' +
        '<span class="fo-n">' + f.label + '</span>' +
        '<span class="fo-p" style="font-family:' + f.display.replace(/"/g, "'") + '">Aa</span>' +
        '</button>';
    }).join('') + (s.font === 'custom'
      ? '<button type="button" class="fontopt" data-font="custom" aria-pressed="true">' +
        '<span class="fo-n">' + (s.fontName || 'Uploaded font') + '</span>' +
        '<span class="fo-p" style="font-family:TenantFont">Aa</span></button>'
      : '');

    el('[data-service-editor]').innerHTML = Brand.SERVICE_KEYS.map(function (k) {
      var v = s.services[k];
      return '<div class="setrow">' +
        '<div><label for="svc-' + k + '">' + v.name + '</label>' +
        '<div class="desc"><code style="font-family:var(--mono);font-size:.68rem">' + k + '</code></div></div>' +
        '<div style="display:flex;gap:10px">' +
          '<input id="svc-' + k + '" type="text" data-svc-name="' + k + '" value="' + v.name + '">' +
          '<input type="number" min="0" step="5" data-svc-price="' + k + '" value="' + v.price +
            '" style="max-width:110px" aria-label="Price for ' + v.name + '">' +
        '</div></div>';
    }).join('');

    // A salon's own build is single-tenant: there is nothing to switch to, and
    // showing a competitor's name in their settings screen would be worse than
    // showing nothing.
    var tenantBlock = el('[data-tenant-block]');
    if (tenantBlock) tenantBlock.hidden = Brand.single;
    el('[data-tenants]').innerHTML = Object.keys(Brand.SALONS).map(function (id) {
      var t = Brand.SALONS[id];
      return '<button class="btn btn-ghost" data-tenant="' + id + '" style="padding:9px 15px;gap:9px">' +
        '<i style="width:10px;height:10px;border-radius:50%;background:' + t.accent + ';display:block"></i>' +
        t.name + '</button>';
    }).join('');
  }

  /* Tell the owner what their colour is doing before they ship it. A pale
     accent silently flips the button label to black; saying so out loud is
     cheaper than a support ticket asking why the button "looks different". */
  function noteContrast(hex) {
    var note = el('[data-contrast-note]');
    if (!note) return;
    var lum = function (h) {
      var n = parseInt(h.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
        v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      }).reduce(function (a, v, i) { return a + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
    };
    var L = lum(hex);
    var onWhite = (Math.max(L, 1) + 0.05) / (Math.min(L, 1) + 0.05);
    var onBlack = (Math.max(L, 0.0074) + 0.05) / (Math.min(L, 0.0074) + 0.05);
    var dark = onBlack >= onWhite;
    var ratio = Math.max(onWhite, onBlack);
    note.textContent = (dark ? 'dark' : 'white') + ' label · ' + ratio.toFixed(1) + ':1';
    note.className = 'pill ' + (ratio >= 4.5 ? 'ok' : 'warn');
  }

  function paintLogoZone(s) {
    var prev = el('[data-logo-prev]');
    var t = el('[data-logo-t]');
    var clear = el('[data-logo-clear]');
    if (!prev) return;
    if (s.logo) {
      prev.innerHTML = '<img src="' + s.logo + '" alt="">';
      t.textContent = 'Logo set — click to replace';
      clear.hidden = false;
    } else {
      prev.textContent = s.monogram;
      prev.style.fontFamily = 'var(--display)';
      t.textContent = 'Drop a logo, or click to choose';
      clear.hidden = true;
    }
  }

  /* ── File intake ──────────────────────────────────────────────────────
     Read to a data URL rather than an object URL: a data URL survives being
     handed across into the preview iframe and, later, being persisted with
     the tenant record. Object URLs die with the document that made them. */

  function readAsDataURL(file, maxBytes, cb) {
    if (!file) return;
    if (file.size > maxBytes) {
      alert('That file is ' + Math.round(file.size / 1024) + ' KB — the limit is ' +
            Math.round(maxBytes / 1024) + ' KB. Please use a smaller one.');
      return;
    }
    var fr = new FileReader();
    fr.onload = function () { cb(fr.result, file); };
    fr.readAsDataURL(file);
  }

  function wireDrop(zoneSel, inputSel, handler) {
    var zone = el(zoneSel), input = el(inputSel);
    if (!zone || !input) return;
    input.addEventListener('change', function () { handler(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
    });
  }

  wireDrop('[data-logo-zone]', '[data-logo-input]', function (file) {
    readAsDataURL(file, 512 * 1024, function (url) {
      Brand.patch({ logo: url });
      paintBrandLight(); paintLogoZone(Brand.current); pokePreview();
    });
  });

  wireDrop('[data-font-zone]', '[data-font-input]', function (file) {
    readAsDataURL(file, 2 * 1024 * 1024, function (url, f) {
      Brand.current.font = 'custom';
      Brand.patch({ fontData: url, fontName: f.name.replace(/\.[^.]+$/, '') });
      renderSettings(); pokePreview();
    });
  });

  document.addEventListener('click', function (e) {
    var clr = e.target.closest && e.target.closest('[data-logo-clear]');
    if (clr) {
      Brand.patch({ logo: null });
      paintBrandLight(); paintLogoZone(Brand.current); pokePreview();
    }
    var fo = e.target.closest && e.target.closest('[data-font]');
    if (fo) {
      Brand.current.font = fo.getAttribute('data-font');
      Brand.patch({});
      renderSettings(); pokePreview();
    }
  });

  // Delegated, because the branding panel re-renders itself on every change.
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.hasAttribute && t.hasAttribute('data-set')) {
      var f = {}; f[t.getAttribute('data-set')] = t.value;
      Brand.patch(f);
      paintBrandLight();
      pokePreview();
    }
    if (t.hasAttribute && t.hasAttribute('data-svc-name')) {
      var sv = {}; sv[t.getAttribute('data-svc-name')] = { name: t.value };
      mergeService(t.getAttribute('data-svc-name'), { name: t.value });
    }
    if (t.hasAttribute && t.hasAttribute('data-svc-price')) {
      mergeService(t.getAttribute('data-svc-price'), { price: Number(t.value) || 0 });
    }
    if (t.hasAttribute && t.hasAttribute('data-color-well')) {
      setAccent(t.value, 'well');
    }
    if (t.hasAttribute && t.hasAttribute('data-hex')) {
      var v = t.value.trim();
      if (v && v[0] !== '#') { v = '#' + v; }
      // Only commit a complete hex. Committing on every keystroke repaints the
      // whole console to whatever half-typed value is in the box.
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { t.classList.remove('bad'); setAccent(v, 'hex'); }
      else { t.classList.add('bad'); }
    }
  });

  function setAccent(hexValue, from) {
    Brand.patch({ accent: hexValue });
    if (from !== 'well') el('[data-color-well]').value = hexValue;
    if (from !== 'hex') el('[data-hex]').value = hexValue.toUpperCase();
    noteContrast(hexValue);
    els('[data-accent]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-accent').toLowerCase() === hexValue.toLowerCase()));
    });
    pokePreview();
  }

  function mergeService(key, patch) {
    Object.assign(Brand.current.services[key], patch);
    // Only the numbers move; re-rendering the whole settings panel here would
    // steal focus out of the input mid-keystroke.
    pokePreview();
  }

  document.addEventListener('click', function (e) {
    var acc = e.target.closest && e.target.closest('[data-accent]');
    if (acc) setAccent(acc.getAttribute('data-accent'), 'swatch');
    var ten = e.target.closest && e.target.closest('[data-tenant]');
    if (ten) {
      Brand.set(ten.getAttribute('data-tenant'));
      renderSettings();
      pokePreview(ten.getAttribute('data-tenant'));
    }
    var oc = e.target.closest && e.target.closest('[data-open-client]');
    if (oc) openClient(oc.getAttribute('data-open-client'));
  });

  function paintBrandLight() {
    var s = Brand.current;
    els('[data-brand-name]').forEach(function (n) { n.textContent = s.name; });
    els('[data-brand-monogram]').forEach(function (n) { Brand.paintMark(n, s); });
  }

  /* The preview is the real scanner in an iframe. Same-origin, so we can push
     the brand straight into its document rather than reloading it — a reload
     would drop the client back to the intro screen on every keystroke. */
  function pokePreview(tenantId) {
    var f = el('[data-preview]');
    if (!f) return;
    try {
      var w = f.contentWindow;
      if (!w || !w.Brand) return;
      if (tenantId) { w.Brand.set(tenantId); }
      else {
        var s = Brand.current;
        w.Brand.patch({
          name: s.name, monogram: s.monogram, accent: s.accent, phone: s.phone,
          logo: s.logo, font: s.font, fontData: s.fontData, fontName: s.fontName
        });
        Object.keys(s.services).forEach(function (k) {
          Object.assign(w.Brand.current.services[k], s.services[k]);
        });
        w.Brand.apply(w.Brand.current, w.document);
      }
      var d = w.document;
      Array.prototype.forEach.call(d.querySelectorAll('[data-brand-name]'), function (n) {
        n.textContent = Brand.current.name;
      });
      Array.prototype.forEach.call(d.querySelectorAll('[data-brand-monogram]'), function (n) {
        w.Brand.paintMark(n, Brand.current);
      });
    } catch (err) { /* cross-origin in a hosted embed: the reload path covers it */ }
  }

  document.addEventListener('brandchange', function () { paintBrandLight(); render(); });

  /* ── Boot ─────────────────────────────────────────────────────────────── */

  paintBrand();
  setView('overview');
}());
