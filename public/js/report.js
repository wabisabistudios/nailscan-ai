/* NailScan Try — saved-reading viewer.
 *
 * The Worker mints report_url = <site>/report?id=<id> and hands it to the CRM,
 * where it lands in follow-up email and in Maya's call context. This page is
 * what that link opens: it re-reads the stored record from
 * GET /api/report/{id} and renders it with the same copy bank and the same
 * stylesheet as the live scan.
 *
 * The calendar is NOT locked here. Anyone holding this link already gave their
 * details once; asking again would be theatre.
 *
 * HTML note: headline / verdict.line / checks[].v carry markup from the
 * Worker's closed, server-side copy bank. Nothing on this page comes from a
 * person, but anything that could is written with textContent.
 */
(function () {
  'use strict';

  var CFG = window.NAILSCAN_CONFIG;
  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------- theme -- */

  (function applyConfig() {
    var r = document.documentElement;
    Object.keys(CFG.theme || {}).forEach(function (k) { r.style.setProperty(k, CFG.theme[k]); });

    if (CFG.brand.logo) {
      $('wordmark').innerHTML = '';
      var img = new Image(); img.src = CFG.brand.logo; img.alt = CFG.brand.name;
      $('wordmark').appendChild(img);
    } else {
      $('wordmark').textContent = CFG.brand.mark;
    }
    $('unit-meta').textContent = 'SAVED READING';
    $('legal-line').textContent = CFG.legal;
    $('foot-brand').textContent = CFG.brand.name + ' · cosmetic nail assessment';
    $('cross-t').textContent = CFG.crossLink.label;
    $('cross').href = CFG.crossLink.href;
    document.title = CFG.brand.name + ' — your nail reading';
  })();

  function stage(name) {
    ['loading', 'missing', 'report'].forEach(function (s) {
      $('stage-' + s).classList.toggle('is-active', s === name);
    });
  }

  function shortDate(iso) {
    try {
      return new Date(iso + 'T00:00:00Z').toLocaleDateString(CFG.brand.locale, {
        month: 'short', day: 'numeric', timeZone: 'UTC'
      });
    } catch (e) { return iso; }
  }

  function longDate(isoTs) {
    try {
      return new Date(isoTs).toLocaleDateString(CFG.brand.locale, {
        day: 'numeric', month: 'short', year: 'numeric'
      });
    } catch (e) { return ''; }
  }

  /* -------------------------------------------------------------- load -- */

  var id = (new URLSearchParams(location.search).get('id') || '')
    .toLowerCase().replace(/[^0-9a-z]/g, '').slice(0, 16);

  if (!id) return stage('missing');

  fetch(CFG.api.base + '/api/report/' + id, { headers: { 'Accept': 'application/json' } })
    .then(function (res) {
      if (!res.ok) throw new Error('http_' + res.status);
      return res.json();
    })
    .then(render)
    .catch(function () {
      $('miss-copy').textContent =
        'We could not open that reading. The link may be incomplete, or the record may no longer be reachable.';
      stage('missing');
    });

  /* ------------------------------------------------------------ render -- */

  /* Tell the studio she saved it.
   *
   * Fire and forget, and deliberately AFTER the download rather than before: by
   * the time this goes out the file is already in her downloads, so a failure
   * here is ours to reconcile and never something she is shown. keepalive lets
   * it survive her closing the tab on the way to her calendar.
   */
  function pingPlanSaved(scanId, detail) {
    if (!scanId || !CFG.api.plan) return;
    try {
      fetch(CFG.api.base + CFG.api.plan, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          id: scanId,
          items: detail.items,
          service: detail.service,
          rhythm: detail.rhythm,
          event_date: detail.event_date,
          event_label: detail.event_label,
          source: 'try-demo'
        })
      }).catch(function () {});
    } catch (e) { /* never her problem */ }
  }

  /* One line each, the rest on a tap.
   *
   * `hd` is the two-second version, `k` the location, `v` the sentence the
   * copy bank wrote. Collapsed, the reading is a list you can take in at a
   * glance; expanded, it is exactly as thorough as it was before. Nothing was
   * cut — it just stopped arriving all at once.
   */
  function renderChecks(ul, checks) {
    ul.innerHTML = '';
    (checks || []).forEach(function (c) {
      var li = document.createElement('li');
      li.className = c.status === 'good' ? 'good' : 'note';

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'k';
      head.setAttribute('aria-expanded', 'false');
      var hd = document.createElement('span');
      hd.className = 'hd';
      hd.textContent = c.hd || c.k;
      var more = document.createElement('span');
      more.className = 'more';
      more.textContent = 'Why';
      head.appendChild(hd);
      head.appendChild(more);

      var body = document.createElement('div');
      body.className = 'v';
      body.hidden = true;
      var loc = document.createElement('span');
      loc.className = 'loc';
      loc.textContent = c.k;
      var p = document.createElement('p');
      p.innerHTML = c.v;                      // closed, server-side copy bank
      body.appendChild(loc);
      body.appendChild(p);

      head.addEventListener('click', function () {
        var openNow = body.hidden;
        body.hidden = !openNow;
        head.setAttribute('aria-expanded', String(openNow));
        li.classList.toggle('is-open', openNow);
        more.textContent = openNow ? 'Hide' : 'Why';
      });

      li.appendChild(head);
      li.appendChild(body);
      ul.appendChild(li);
    });
  }

  /* If the planner cannot mount, the dates are still the point. Plain list. */
  function renderPlainTimeline(cal) {
    var mount = $('rep-plan-mount');
    mount.replaceChildren();
    var ul = document.createElement('ul');
    ul.className = 'timeline';
    cal.milestones.forEach(function (m) {
      var li = document.createElement('li');
      var dt = document.createElement('span'); dt.className = 'dt'; dt.textContent = shortDate(m.date);
      var bd = document.createElement('span'); bd.className = 'bd';
      var b = document.createElement('b'); b.textContent = m.label;
      bd.appendChild(b);
      if (m.sub) { var sp = document.createElement('span'); sp.textContent = m.sub; bd.appendChild(sp); }
      li.appendChild(dt); li.appendChild(bd);
      ul.appendChild(li);
    });
    mount.appendChild(ul);
  }

  function render(rec) {
    if (!rec || !rec.display) return stage('missing');
    var d = rec.display, v = d.verdict || {};

    if (rec.assets && rec.assets.image) {
      $('rep-thumb').src = rec.assets.image;
      $('rep-thumb').hidden = false;
    }

    $('rep-badge-t').textContent = (v.num || '') + ' · ' + (v.label || '');
    $('rep-h').innerHTML = d.headline || '';
    $('rep-line').innerHTML = v.line || '';
    $('rep-sub').textContent = v.sub || '';

    /* what we saw */
    var checks = d.checks || [];
    if (checks.length) {
      renderChecks($('rep-checks'), checks);
      $('rep-checks-n').textContent = String(checks.length).padStart(2, '0') + ' OBSERVED';
      $('rep-checks-block').hidden = false;
    }

    /* worth a check */
    if (d.medical) {
      $('rep-medical').textContent = d.medical;
      $('rep-medical-block').hidden = false;
    }

    /* The calendar. Open here — whoever holds this link already gave her
       details once, and asking again would be theatre.

       It is the same interactive planner the live report unlocks, mounted from
       the stored record. So the link in her email is not a flat copy of what
       she saw: she can come back in three weeks, tell it about a wedding, and
       get new dates out of the same reading. */
    var cal = d.calendar;
    if (cal && cal.milestones && cal.milestones.length) {
      $('rep-cal-n').textContent = String(cal.milestones.length).padStart(2, '0') + ' DATES';
      // Same closed copy bank, same emphasis markup as the live report.
      $('rep-cal-intro').innerHTML = cal.intro || '';

      var mounted = false;
      if (window.NailScanCalendar && window.NailScanPlan) {
        try {
          NailScanCalendar.mount({
            root: $('rep-plan-mount'), record: rec, cfg: CFG,
            onExport: function (detail) { pingPlanSaved(rec.id, detail); }
          });
          mounted = true;
        } catch (e) { mounted = false; }
      }
      if (!mounted) renderPlainTimeline(cal);

      if (cal.grown_out) {
        $('rep-grown').textContent = 'At normal growth, the wear in this photo is fully grown out around '
          + shortDate(cal.grown_out) + '.';
        $('rep-grown').hidden = false;
      }
      $('rep-cal-block').hidden = false;
    }

    /* what suits you */
    if (d.carry) {
      var c = $('rep-carry');
      // The `.timeline` wrapper is not decoration: the stylesheet's
      // `.timeline .bd b { display:block }` is what puts the shade name on its
      // own line. Without it the name and its sentence run together.
      var wrap = document.createElement('div');
      wrap.className = 'timeline';
      c.appendChild(wrap);
      [d.carry.now, d.carry.later].forEach(function (x) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:16px;padding:13px 0;border-bottom:1px solid var(--line)';
        var tag = document.createElement('span'); tag.className = 'dt'; tag.textContent = x.tag;
        var bd = document.createElement('span'); bd.className = 'bd';
        var b = document.createElement('b'); b.textContent = x.name;
        var s = document.createElement('span'); s.textContent = x.line;
        bd.appendChild(b); bd.appendChild(s);
        row.appendChild(tag); row.appendChild(bd);
        wrap.appendChild(row);
      });
      $('rep-carry-block').hidden = false;
    }

    $('rep-stamp').textContent = 'Reading ' + rec.id
      + (rec.created_at ? ' · ' + longDate(rec.created_at) : '')
      + ' · this link stays live.';

    stage('report');
  }
})();
