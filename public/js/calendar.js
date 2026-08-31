/* NailScan — the calendar she can actually use.
 *
 * Two things live here: a real month grid on the page, and a picker that slides
 * up over it.
 *
 * The picker exists because the first version put every date, every reason and
 * every checkbox inline, and the result was a wall of text nobody would read to
 * the end of. Reading a reading and choosing reminders are two different jobs;
 * doing them in one column made both worse. So the page answers "what is
 * happening and when", and one button opens the thing that answers "which of
 * these do I want in my phone".
 *
 * Inside the picker, every row is one line. The reason is one tap away, not in
 * your face — present for the person who wants it, silent for the person who
 * has already decided.
 *
 * Export is a plain .ics plus Google's own prefill link. The .ics is also the
 * Apple path: iPhone opens it natively, which is why there is no separate Apple
 * button — there is nothing for it to do that this file does not already do.
 *
 * Mounted by both the live report and the saved-reading page.
 */
(function () {
  'use strict';

  var P = window.NailScanPlan;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function monthKey(isoDate) { return String(isoDate).slice(0, 7); }

  function monthLabel(key, locale) {
    var p = key.split('-');
    return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  }

  function shortDate(isoDate, locale) {
    return P.parse(isoDate).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  }

  function relative(isoDate, todayIso) {
    var n = P.daysBetween(todayIso, isoDate);
    return n === 0 ? 'today' : n === 1 ? 'tomorrow'
      : n < 0 ? Math.abs(n) + 'd ago'
      : n < 14 ? 'in ' + n + ' days'
      : 'in ' + Math.round(n / 7) + ' weeks';
  }

  function weekdayLabels(locale, weekStart) {
    var out = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(2026, 1, 1 + ((i + weekStart) % 7));   // 1 Feb 2026 is a Sunday
      out.push(d.toLocaleDateString(locale, { weekday: 'narrow' }));
    }
    return out;
  }

  /* ----------------------------------------------------------- mounting -- */

  function mount(opts) {
    var root = opts.root, cfg = opts.cfg, rec = opts.record;
    var locale = (cfg.brand && cfg.brand.locale) || 'en-US';
    var weekStart = (cfg.plan && cfg.plan.weekStart) || 0;
    var today = opts.today || new Date();
    var todayIso = P.iso(today);

    var state = {
      service: guessService(cfg, rec),
      rhythm: (cfg.plan && cfg.plan.defaultRhythm) || 'usual',
      eventDate: '',
      eventLabel: '',
      month: todayIso.slice(0, 7),
      off: {},                       // things she has un-ticked
      on: {},                        // things she has ticked that were off by default
      plan: { entries: [], notes: [], habits: [] },
      lastFocus: null
    };

    root.replaceChildren();

    /* --------------------------------------------------------- the page -- */

    var intro = el('p', 'plan-intro',
      'Your nail calendar. The red dates come from your photo — tell it what you had ' +
      'done today and anything coming up, and it works out the rest.');
    root.appendChild(intro);

    var controls = el('div', 'plan-controls');

    var svcField = field('What did you have done today?');
    var svcSel = el('select', 'plan-select');
    svcSel.id = 'plan-service';
    ((cfg.plan && cfg.plan.services) || []).forEach(function (s) {
      var o = el('option', null, s.label);
      o.value = s.slug;
      if (s.slug === state.service) o.selected = true;
      svcSel.appendChild(o);
    });
    svcField.appendChild(svcSel);
    controls.appendChild(svcField);

    var rhyField = field('How often do you come in?');
    var rhySel = el('select', 'plan-select');
    rhySel.id = 'plan-rhythm';
    ((cfg.plan && cfg.plan.rhythms) || []).forEach(function (r) {
      var o = el('option', null, r.label);
      o.value = r.slug;
      if (r.slug === state.rhythm) o.selected = true;
      rhySel.appendChild(o);
    });
    rhyField.appendChild(rhySel);
    controls.appendChild(rhyField);

    var evField = field('Anything coming up?');
    var evRow = el('div', 'plan-pair');
    var evName = el('input', 'plan-input');
    evName.type = 'text'; evName.id = 'plan-event-label';
    evName.placeholder = 'Wedding, holiday, birthday'; evName.maxLength = 40;
    var evDate = el('input', 'plan-input plan-date');
    evDate.type = 'date'; evDate.id = 'plan-event-date';
    evDate.min = todayIso;
    evDate.max = P.iso(P.addDays(today, 400));
    evRow.appendChild(evName); evRow.appendChild(evDate);
    evField.appendChild(evRow);
    controls.appendChild(evField);

    root.appendChild(controls);

    /* the grid */
    var cal = el('div', 'cal');
    var head = el('div', 'cal-head');
    var prev = el('button', 'cal-nav', '‹'); prev.type = 'button'; prev.setAttribute('aria-label', 'Previous month');
    var title = el('span', 'cal-title');
    var next = el('button', 'cal-nav', '›'); next.type = 'button'; next.setAttribute('aria-label', 'Next month');
    head.appendChild(prev); head.appendChild(title); head.appendChild(next);
    cal.appendChild(head);

    var dow = el('div', 'cal-dow');
    weekdayLabels(locale, weekStart).forEach(function (w) { dow.appendChild(el('span', null, w)); });
    cal.appendChild(dow);

    var grid = el('div', 'cal-grid');
    cal.appendChild(grid);
    var key = el('p', 'cal-key');
    cal.appendChild(key);
    root.appendChild(cal);

    var notes = el('div', 'plan-notes');
    root.appendChild(notes);

    /* the one button on the page */
    var open = el('button', 'btn');
    open.type = 'button';
    var openText = el('span', null, 'Set my reminders');
    open.appendChild(openText);
    open.appendChild(el('span', 'arrow', '↗'));
    var openWrap = el('div', 'plan-actions');
    openWrap.appendChild(open);
    openWrap.appendChild(el('p', 'fine plan-help',
      'Pick what you want and it saves to your phone — iPhone, Android, Google Calendar or Outlook.'));
    root.appendChild(openWrap);

    /* -------------------------------------------------------- the sheet -- */

    var scrim = el('div', 'sheet-scrim');
    scrim.hidden = true;

    var sheet = el('div', 'sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Choose your reminders');

    var sHead = el('div', 'sheet-head');
    var sTitles = el('div');
    sTitles.appendChild(el('h3', null, 'What should we remind you about?'));
    sTitles.appendChild(el('p', 'sheet-sub', 'Tick what you want. Tap a line to see why it is there.'));
    sHead.appendChild(sTitles);
    var close = el('button', 'sheet-close', '×');
    close.type = 'button'; close.setAttribute('aria-label', 'Close');
    sHead.appendChild(close);
    sheet.appendChild(sHead);

    var sBody = el('div', 'sheet-body');
    sheet.appendChild(sBody);

    var sFoot = el('div', 'sheet-foot');
    var save = el('button', 'btn');
    save.type = 'button';
    var saveText = el('span', null, 'Add to my phone');
    save.appendChild(saveText);
    save.appendChild(el('span', 'arrow', '↓'));
    sFoot.appendChild(save);
    var saveHelp = el('p', 'fine sheet-help',
      'One file, everything ticked. Opens straight into Apple Calendar on iPhone, and into ' +
      'Google Calendar or Outlook everywhere else.');
    sFoot.appendChild(saveHelp);
    sheet.appendChild(sFoot);

    scrim.appendChild(sheet);
    document.body.appendChild(scrim);

    /* ------------------------------------------------------------ wiring */

    function everything() {
      return state.plan.entries.concat(state.plan.habits);
    }

    function isOn(e) {
      if (state.off[e.id]) return false;
      if (state.on[e.id]) return true;
      return !!e.on;
    }

    function chosen() {
      return everything().filter(function (e) { return e.kind !== 'event' && isOn(e); });
    }

    function recompute() {
      state.plan = P.build({
        record: rec, cfg: cfg, today: today,
        service: state.service, rhythm: state.rhythm,
        eventDate: state.eventDate, eventLabel: state.eventLabel
      });
      renderGrid();
      renderNotes();
      renderSheet();
      renderCounts();
    }

    function renderCounts() {
      var n = chosen().length;
      openText.textContent = n === 0 ? 'Set my reminders'
        : n === 1 ? 'Set my reminders · 1 ready'
        : 'Set my reminders · ' + n + ' ready';
      save.disabled = n === 0;
      saveText.textContent = n === 0 ? 'Tick something first'
        : n === 1 ? 'Add 1 reminder to my phone'
        : 'Add ' + n + ' reminders to my phone';
    }

    /* --------------------------------------------------------- the grid */

    function renderGrid() {
      var months = {};
      state.plan.entries.forEach(function (e) { months[monthKey(e.date)] = true; });
      if (!months[state.month] && state.plan.entries.length) {
        var future = Object.keys(months).sort().filter(function (m) { return m >= todayIso.slice(0, 7); });
        state.month = future[0] || Object.keys(months).sort()[0];
      }

      title.textContent = monthLabel(state.month, locale);

      var y = +state.month.slice(0, 4), m = +state.month.slice(5, 7) - 1;
      var lead = (new Date(y, m, 1).getDay() - weekStart + 7) % 7;
      var days = new Date(y, m + 1, 0).getDate();

      grid.replaceChildren();
      for (var i = 0; i < lead; i++) grid.appendChild(el('span', 'cal-cell is-blank'));

      for (var d = 1; d <= days; d++) {
        var dayIso = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var here = state.plan.entries.filter(function (e) { return e.date === dayIso; });
        var cell = el('button', 'cal-cell');
        cell.type = 'button';
        if (dayIso === todayIso) cell.classList.add('is-today');
        if (dayIso < todayIso) cell.classList.add('is-past');
        cell.appendChild(el('span', 'cal-num', String(d)));

        if (here.length) {
          var isEvent = here.some(function (e) { return e.kind === 'event'; });
          if (isEvent) cell.classList.add('is-event');
          var marks = el('span', 'cal-marks');
          here.forEach(function (e) {
            if (e.kind === 'event') return;
            marks.appendChild(el('i', 'cal-mark' + (isOn(e) ? ' is-on' : '')));
          });
          cell.appendChild(marks);
          if (isEvent) cell.appendChild(el('span', 'cal-evname', state.eventLabel || 'Your day'));
          cell.setAttribute('aria-label', shortDate(dayIso, locale) + ': ' +
            here.map(function (e) { return e.title; }).join(', '));
          (function (target) {
            cell.addEventListener('click', function () { openSheet(target); });
          })(dayIso);
        } else {
          cell.disabled = true;
          cell.classList.add('is-empty');
        }
        grid.appendChild(cell);
      }

      var trailing = (7 - ((lead + days) % 7)) % 7;
      for (var t = 0; t < trailing; t++) grid.appendChild(el('span', 'cal-cell is-blank'));

      var inMonth = state.plan.entries.filter(function (e) { return monthKey(e.date) === state.month; });
      var dayCount = Object.keys(inMonth.reduce(function (a, e) { a[e.date] = 1; return a; }, {})).length;
      var later = state.plan.entries.length - inMonth.length;
      key.textContent = inMonth.length
        ? (dayCount === 1 ? '1 day marked' : dayCount + ' days marked') +
          (later ? ' · ' + later + ' more later, use the arrows' : '') +
          ' · a filled mark is one you are keeping'
        : 'Nothing this month — use the arrows.';
    }

    function renderNotes() {
      notes.replaceChildren();
      state.plan.notes.forEach(function (n) { notes.appendChild(el('p', 'callout', n)); });
    }

    /* -------------------------------------------------------- the sheet */

    function renderSheet() {
      sBody.replaceChildren();

      var appts = state.plan.entries.filter(function (e) { return e.kind !== 'event'; });
      var mine  = state.plan.entries.filter(function (e) { return e.kind === 'event'; });

      if (mine.length) {
        var m = mine[0];
        sBody.appendChild(el('p', 'sheet-yourday',
          'Everything below is timed around ' + m.title + ' on ' + shortDate(m.date, locale) + '.'));
      }

      if (appts.length) {
        sBody.appendChild(group('Appointments', 'Dates to ring the studio about.'));
        appts.forEach(function (e) {
          sBody.appendChild(row(e, shortDate(e.date, locale) + ' · ' + relative(e.date, todayIso), null));
        });
      }

      var habits = state.plan.habits || [];
      if (habits.length) {
        sBody.appendChild(group('Looking after them at home',
          'Small things, at the moment they matter. Nothing here is a supplement or a diagnosis.'));
        // A schedule goes UNDER the title, not beside it. "Every Monday at
        // 10:00 AM, for 8 weeks" set against the title squeezed three-word
        // headlines into four wrapped lines.
        habits.forEach(function (h) { sBody.appendChild(row(h, null, P.cadenceLine(h, locale))); });
      }
    }

    function group(label, sub) {
      var g = el('div', 'sheet-group');
      g.appendChild(el('p', 'eyebrow', label));
      if (sub) g.appendChild(el('p', 'sheet-groupsub', sub));
      return g;
    }

    /* One row = one line. The reason is behind a tap, so the person who has
       already decided is not made to read a paragraph to get past it. */
    function row(e, meta, cadence) {
      var li = el('div', 'sheet-row');
      li.setAttribute('data-day', e.date);

      var lab = el('label', 'sheet-tick');
      var box = el('input');
      box.type = 'checkbox';
      box.checked = isOn(e);
      box.addEventListener('change', function () {
        if (box.checked) { state.on[e.id] = true; delete state.off[e.id]; }
        else { state.off[e.id] = true; delete state.on[e.id]; }
        li.classList.toggle('is-on', box.checked);
        renderGrid(); renderCounts();
      });
      lab.appendChild(box);
      li.appendChild(lab);

      var main = el('button', 'sheet-main');
      main.type = 'button';
      main.setAttribute('aria-expanded', 'false');
      var top = el('span', 'sheet-line');
      top.appendChild(el('b', null, e.title));
      if (meta) top.appendChild(el('span', 'sheet-meta', meta));
      main.appendChild(top);
      if (e.line) main.appendChild(el('span', 'sheet-subline', e.line));
      if (cadence) main.appendChild(el('span', 'sheet-cadence', cadence));

      var detail = el('div', 'sheet-detail');
      detail.hidden = true;
      detail.appendChild(el('p', null, e.why || ''));
      var g = el('a', 'plan-google', 'Add just this one to Google');
      g.href = P.googleUrl(e, cfg, rec);
      g.target = '_blank'; g.rel = 'noopener';
      detail.appendChild(g);

      main.addEventListener('click', function () {
        var openNow = detail.hidden;
        detail.hidden = !openNow;
        main.setAttribute('aria-expanded', String(openNow));
        li.classList.toggle('is-open', openNow);
      });

      var col = el('div', 'sheet-col');
      col.appendChild(main);
      col.appendChild(detail);
      li.appendChild(col);
      if (box.checked) li.classList.add('is-on');
      return li;
    }

    /* ------------------------------------------------------ open / close */

    function openSheet(scrollToDay) {
      state.lastFocus = document.activeElement;
      scrim.hidden = false;
      document.body.classList.add('is-sheeted');
      requestAnimationFrame(function () {
        scrim.classList.add('is-in');
        if (scrollToDay) {
          var target = sBody.querySelector('[data-day="' + scrollToDay + '"]');
          if (target) {
            target.scrollIntoView({ block: 'center' });
            target.classList.add('is-lit');
            setTimeout(function () { target.classList.remove('is-lit'); }, 1400);
          }
        }
        close.focus();
      });
    }

    function closeSheet() {
      scrim.classList.remove('is-in');
      document.body.classList.remove('is-sheeted');
      setTimeout(function () { scrim.hidden = true; }, 220);
      if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
    }

    open.addEventListener('click', function () { openSheet(); });
    close.addEventListener('click', closeSheet);
    scrim.addEventListener('click', function (ev) { if (ev.target === scrim) closeSheet(); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !scrim.hidden) closeSheet();
    });

    /* --------------------------------------------------------- listeners */

    svcSel.addEventListener('change', function () { state.service = svcSel.value; recompute(); });
    rhySel.addEventListener('change', function () { state.rhythm = rhySel.value; recompute(); });
    evDate.addEventListener('change', function () { state.eventDate = evDate.value; recompute(); });
    evName.addEventListener('input', function () {
      state.eventLabel = evName.value.trim();
      if (state.eventDate) recompute();
    });

    prev.addEventListener('click', function () { state.month = shiftMonth(state.month, -1); renderGrid(); });
    next.addEventListener('click', function () { state.month = shiftMonth(state.month, +1); renderGrid(); });

    save.addEventListener('click', function () {
      var picked = chosen();
      if (!picked.length) return;

      var blob = new Blob([P.toICS(picked, cfg, rec)], { type: 'text/calendar;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'nail-plan.ics';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);

      saveHelp.textContent = 'Saved as nail-plan.ics. Open it from your downloads and your phone ' +
        'will offer to add them all. The file is on your device — nothing was sent anywhere.';

      if (typeof opts.onExport === 'function') {
        try {
          opts.onExport({
            items: picked.map(function (e) {
              return { id: e.id, title: e.title, date: e.date, kind: e.kind, cadence: e.cadence || '' };
            }),
            service: state.service,
            rhythm: state.rhythm,
            event_date: state.eventDate || '',
            event_label: state.eventLabel || ''
          });
        } catch (err) { /* telling the salon is never worth costing her the file */ }
      }
    });

    recompute();
    return { recompute: recompute, open: openSheet, state: state };
  }

  function shiftMonth(key, delta) {
    var d = new Date(+key.slice(0, 4), +key.slice(5, 7) - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function field(label) {
    var f = document.createElement('div');
    f.className = 'plan-field';
    var l = document.createElement('label');
    l.textContent = label;
    f.appendChild(l);
    return f;
  }

  /* The reading already saw what she is wearing. Pre-select the closest match
     so the common case is zero taps. */
  function guessService(cfg, rec) {
    var map = { gel: 'gel-polish', acrylic: 'acrylic', extensions: 'gel-extensions',
                polish: 'classic-manicure', bare: '', unknown: '' };
    var slug = map[rec && rec.wear];
    return P.serviceFor(cfg, slug) ? slug : '';
  }

  window.NailScanCalendar = { mount: mount };
})();
