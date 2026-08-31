/* NailScan — the plan.
 *
 * The reading tells her what her nails are doing. This turns that into dates
 * she can act on, and it is deliberately NOT a second opinion: the care
 * milestones come from the Worker's record exactly as computed, and nothing
 * here edits them. What this adds is the two things the photo cannot know —
 * what she had done today, and what she has coming up — and the arithmetic
 * between them.
 *
 * Every date carries a `why` sentence. A calendar full of dates with no reasons
 * is a calendar nobody trusts, and this one is asking someone to put entries in
 * their real phone.
 *
 * Pure functions, no DOM, no network. Loaded by both the live report and the
 * saved-reading page, so the two can never drift.
 */
(function () {
  'use strict';

  var DAY = 86400000;

  function iso(d) {
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function parse(isoDate) {
    var p = String(isoDate || '').split('-');
    return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
  }
  function addDays(d, n) { return new Date(d.getTime() + n * DAY); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / DAY); }

  /* ------------------------------------------------------- service rhythm -- */

  // How long a finish actually looks good for, before it starts to lever, lift
  // or grow out enough to be worth redoing. These are the salon's numbers, not
  // ours — they live in config so a salon can retune them without a deploy.
  function serviceFor(cfg, slug) {
    var list = (cfg.plan && cfg.plan.services) || [];
    for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return list[i];
    return null;
  }

  // Her stated habit bends the textbook interval. Somebody who comes every two
  // weeks does not want to be told to come in three; somebody who comes rarely
  // should not be handed four appointments.
  function rhythmFactor(cfg, rhythm) {
    var list = (cfg.plan && cfg.plan.rhythms) || [];
    for (var i = 0; i < list.length; i++) if (list[i].slug === rhythm) return list[i];
    return { slug: 'usual', factor: 1, repeats: 2 };
  }

  /* ------------------------------------------------------------- the plan -- */

  /* opts:
   *   record      the Worker's record (its calendar is authoritative)
   *   cfg         window.NAILSCAN_CONFIG
   *   today       Date
   *   service     slug of what she had done today, or '' for nothing
   *   eventDate   'YYYY-MM-DD' for something coming up, or ''
   *   eventLabel  free text, already trimmed, or ''
   *   rhythm      slug
   */
  function build(opts) {
    var cfg = opts.cfg, rec = opts.record || {};
    var d = rec.display || {};
    var today = opts.today || new Date();
    var todayIso = iso(today);
    var entries = [], notes = [];

    /* 1. Care milestones — straight from the reading, untouched. --------- */
    var cal = d.calendar;
    if (cal && cal.milestones) {
      cal.milestones.forEach(function (m, i) {
        entries.push({
          id: 'care-' + i,
          date: m.date,
          title: m.label,
          why: careWhy(m, rec),
          kind: m.kind === 'goal' ? 'goal' : 'care',
          service: m.service || '',
          on: m.kind !== 'goal'          // goals are milestones to notice, not appointments to keep
        });
      });
    }

    /* 2. Rebook rhythm — what she had done today decides when it is due. - */
    var svc = serviceFor(cfg, opts.service);
    var rf = rhythmFactor(cfg, opts.rhythm);
    if (svc && svc.weeks) {
      var interval = Math.max(7, Math.round(svc.weeks * 7 * (rf.factor || 1)));
      var repeats = Math.max(1, Math.min(4, rf.repeats || 2));
      for (var n = 1; n <= repeats; n++) {
        var when = addDays(today, interval * n);
        entries.push({
          id: 'rebook-' + n,
          date: iso(when),
          title: n === 1 ? (svc.rebookLabel || ('Next ' + svc.label.toLowerCase())) : (svc.label + ' · visit ' + (n + 1)),
          why: n === 1
            ? svc.why || ('About ' + svc.weeks + ' weeks is where ' + svc.label.toLowerCase() +
                          ' stops looking fresh and starts lifting at the edges. Booking before that is what keeps your own nail underneath intact.')
            : 'Keeping the same rhythm going. Move it if life moves.',
          kind: 'rebook',
          service: svc.slug,
          on: n === 1
        });
      }
    }

    /* 3. Something coming up — work backwards from the day itself. ------- */
    if (opts.eventDate && opts.eventDate > todayIso) {
      var label = opts.eventLabel || 'your event';
      var gap = daysBetween(todayIso, opts.eventDate);
      var lead = (cfg.plan && cfg.plan.eventLeadDays) || 3;

      entries.push({
        id: 'event',
        date: opts.eventDate,
        title: label.charAt(0).toUpperCase() + label.slice(1),
        why: 'The day everything is timed around.',
        kind: 'event',
        on: false                        // her own event: shown, not something we add to her calendar
      });

      if (gap <= 1) {
        notes.push('That is tomorrow. Ask for the first slot the studio has — even a file and a fresh coat reads better than nothing.');
      } else {
        // Two to five days before: past the setting window, well short of
        // any grow-out at the base.
        var target = iso(addDays(parse(opts.eventDate), -Math.min(lead, gap - 1)));
        entries.push({
          id: 'event-prep',
          date: target,
          title: 'Book for ' + label,
          why: 'Two to five days before is the sweet spot — long enough that nothing is still setting, short enough that there is no grow-out at the base yet. Same-day appointments are how people end up with a smudge in the photos.',
          kind: 'prep',
          service: svc ? svc.slug : '',
          on: true,
          primary: true
        });

        // If the finish she has today will not survive until the event, she
        // needs one in between — this is the bit people get wrong.
        if (svc && svc.weeks && gap > svc.weeks * 7 + 4) {
          notes.push('What you have on now will be past its best well before ' + label +
                     ', so the appointment above is a fresh set rather than a top-up.');
        } else if (svc && svc.weeks && gap > svc.weeks * 7 - 3) {
          notes.push('Your ' + svc.label.toLowerCase() + ' should just about hold until ' + label +
                     ' — the appointment above is the one that matters.');
        }
      }

      // The reading can outrank the party. Say so.
      var removal = firstCareOfKind(cal, 'removal');
      // `<=`, not `<`. A removal falling ON the day of the party is the worst
      // version of this, not a case to stay quiet about.
      if (removal && removal.date <= opts.eventDate) {
        notes.push('Your removal-by date (' + human(removal.date, cfg) + ') falls on or before ' + label +
                   '. Do the removal first and build fresh on top — leaving a set on past its date is what causes the damage in the first place.');
      }
      if (cal && cal.grown_out && cal.grown_out > opts.eventDate) {
        notes.push('The wear in your photo will not be fully grown out by then. Nothing stops you having lovely nails for ' +
                   label + ' — it just means keeping the length sensible until it is.');
      } else if (cal && cal.grown_out) {
        notes.push('Good news: at normal growth the wear in your photo is gone by ' + label + '.');
      }
    }

    entries.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    return { entries: entries, notes: notes, habits: habitsFor(cfg, rec, today) };
  }

  /* ---------------------------------------------------------- home care --
   *
   * These are not dates on the calendar grid — they are repeating reminders,
   * and they are kept in their own list for that reason. Mixing "9pm every
   * night for eight weeks" into a month grid would make the grid meaningless.
   *
   * Relevance is filtered, not assumed: a sunscreen-before-the-lamp reminder
   * for somebody with bare nails is the kind of generic advice that teaches
   * people to ignore the rest of it.
   */
  function habitsFor(cfg, rec, today) {
    var list = (cfg.plan && cfg.plan.habits) || [];
    var weeks = (cfg.plan && cfg.plan.habitWeeks) || 8;
    var out = [];

    list.forEach(function (h) {
      if (h.when) {
        if (h.when.tier && h.when.tier.indexOf(rec.tier) === -1) return;
        if (h.when.wear && h.when.wear.indexOf(rec.wear) === -1) return;
      }
      var start, rrule = '';
      if (h.cadence === 'daily') {
        start = addDays(today, 1);                       // never fire in the past
        rrule = 'FREQ=DAILY;COUNT=' + ((h.weeks || weeks) * 7);
      } else if (h.cadence === 'weekly') {
        start = nextWeekday(today, h.day == null ? 0 : h.day);
        rrule = 'FREQ=WEEKLY;COUNT=' + (h.weeks || weeks);
      } else {
        start = addDays(today, h.inDays == null ? 1 : h.inDays);
      }
      out.push({
        id: 'habit-' + h.slug,
        date: iso(start),
        time: h.time || '21:00',
        rrule: rrule,
        title: h.label,
        line: h.line || '',
        why: h.why || '',
        kind: 'habit',
        cadence: h.cadence,
        weeks: h.cadence === 'once' ? 0 : (h.weeks || weeks),
        on: !!h.on
      });
    });
    return out;
  }

  function nextWeekday(from, dow) {
    var d = addDays(from, 1);
    for (var i = 0; i < 7; i++) {
      if (d.getDay() === dow) return d;
      d = addDays(d, 1);
    }
    return d;
  }

  // "Every night for 8 weeks", "Every Sunday for 8 weeks", "Once".
  function cadenceLine(h, locale) {
    if (h.cadence === 'once') return 'Once, ' + fmtTime(h.time, locale);
    var at = fmtTime(h.time, locale);
    if (h.cadence === 'daily') return 'Every night at ' + at + ', for ' + h.weeks + ' weeks';
    var day = parse(h.date).toLocaleDateString(locale || 'en-US', { weekday: 'long' });
    return 'Every ' + day + ' at ' + at + ', for ' + h.weeks + ' weeks';
  }

  function fmtTime(hhmm, locale) {
    var p = String(hhmm || '21:00').split(':');
    var d = new Date(2026, 0, 1, +p[0], +p[1]);
    try { return d.toLocaleTimeString(locale || 'en-US', { hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return hhmm; }
  }

  // Dates that appear inside a sentence are read by a person, not a parser.
  function human(isoDate, cfg) {
    try {
      return parse(isoDate).toLocaleDateString((cfg.brand && cfg.brand.locale) || 'en-US',
        { month: 'short', day: 'numeric' });
    } catch (e) { return isoDate; }
  }

  function careWhy(m, rec) {
    if (/removal/i.test(m.label)) {
      return 'The date this set stops protecting the nail and starts pulling on it. Soaked off, never peeled — peeling takes layers of your own plate with it.';
    }
    if (/strengthen/i.test(m.label)) return 'The visit that starts the plate rebuilding rather than just covering it.';
    if (/grown out/i.test(m.label))  return 'Nails grow about 3mm a month. This is the day the wear in your photo has grown past the free edge — not a thing to book, a thing to look forward to.';
    if (/check/i.test(m.label))      return 'A look at whether it is working. Two minutes at the desk, no appointment needed.';
    if (/oil/i.test(m.label))        return 'A nudge to see whether the daily drop has become a habit yet.';
    if (/shape/i.test(m.label))      return 'A tidy-up to reset the line across the hand.';
    if (/book anything/i.test(m.label)) return 'Nothing to fix, so this is purely for the fun of it.';
    return m.sub || 'From your reading.';
  }

  function firstCareOfKind(cal, word) {
    if (!cal || !cal.milestones) return null;
    for (var i = 0; i < cal.milestones.length; i++) {
      if (new RegExp(word, 'i').test(cal.milestones[i].label)) return cal.milestones[i];
    }
    return null;
  }

  /* --------------------------------------------------------------- .ics -- */

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function stamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
           pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function compact(isoDate) { return String(isoDate).replace(/-/g, ''); }

  function uidDomain(cfg) {
    return (cfg.brand && cfg.brand.domain) || 'nailscan.ai';
  }

  function escICS(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  // RFC 5545 folds at 75 OCTETS, not 75 characters — and a fold must never land
  // inside a character. This copy is full of em dashes and curly quotes at
  // three bytes each, so counting characters would sail past the limit and, on
  // a bad boundary, cut a dash in half. Count bytes; step back to a character
  // boundary.
  function byteLen(s) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s).length;
    return unescape(encodeURIComponent(s)).length;
  }

  function takeOctets(s, max) {
    if (byteLen(s) <= max) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) {                       // longest prefix that fits
      var mid = Math.ceil((lo + hi) / 2);
      if (byteLen(s.slice(0, mid)) <= max) lo = mid; else hi = mid - 1;
    }
    // Do not end on a lone surrogate.
    var cut = lo;
    var code = s.charCodeAt(cut - 1);
    if (code >= 0xD800 && code <= 0xDBFF) cut -= 1;
    return s.slice(0, cut);
  }

  function fold(line) {
    if (byteLen(line) <= 75) return line;
    var head = takeOctets(line, 75);
    var rest = line.slice(head.length);
    var out = head;
    while (rest.length) {
      var chunk = takeOctets(rest, 74);     // the leading space costs one octet
      out += '\r\n ' + chunk;
      rest = rest.slice(chunk.length);
    }
    return out;
  }

  /* Two shapes of event, on purpose.
   *
   * An appointment is ALL-DAY with a reminder the day before: she is not
   * booking a slot here, she is marking a day to ring the studio, and a timed
   * event would be a guess about her diary.
   *
   * A home-care reminder is TIMED and repeating, because "9pm every night" is
   * the entire point of it. The time is deliberately floating — no timezone,
   * no Z — so it stays 9pm wherever she happens to be rather than becoming 4am
   * on a holiday.
   */
  function toICS(entries, cfg, rec) {
    var now = new Date();
    var brand = (cfg.brand && cfg.brand.name) || 'NailScan';
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//' + brand + '//Nail care plan//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + escICS(brand + ' — your nail plan')
    ];
    entries.forEach(function (e) {
      lines.push('BEGIN:VEVENT');
      // The UID domain identifies whose calendar file this is, and it must stay
      // stable for the life of the event — a changed UID makes her phone add a
      // duplicate rather than update the original. So it comes from config,
      // never from the hostname she happens to be on.
      lines.push('UID:' + e.id + '-' + (rec && rec.id ? rec.id : 'plan') + '@' + uidDomain(cfg));
      lines.push('DTSTAMP:' + stamp(now));

      if (e.time) {
        var t = String(e.time).split(':');
        var hh = ('0' + (+t[0] || 0)).slice(-2), mm = ('0' + (+t[1] || 0)).slice(-2);
        var endMin = (+t[1] || 0) + 10, endHr = (+t[0] || 0) + Math.floor(endMin / 60);
        lines.push('DTSTART:' + compact(e.date) + 'T' + hh + mm + '00');
        lines.push('DTEND:' + compact(e.date) + 'T' +
          ('0' + (endHr % 24)).slice(-2) + ('0' + (endMin % 60)).slice(-2) + '00');
        if (e.rrule) lines.push('RRULE:' + e.rrule);
      } else {
        lines.push('DTSTART;VALUE=DATE:' + compact(e.date));
        lines.push('DTEND;VALUE=DATE:' + compact(iso(addDays(parse(e.date), 1))));
      }

      lines.push(fold('SUMMARY:' + escICS(e.title)));
      lines.push(fold('DESCRIPTION:' + escICS(e.why + '\n\nFrom your ' + brand + ' nail reading.')));
      lines.push('TRANSP:TRANSPARENT');
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      // At the time for a reminder you act on now; the day before for an
      // appointment you have to ring up and make.
      lines.push('TRIGGER:' + (e.time ? '-PT0M' : '-P1D'));
      lines.push(fold('DESCRIPTION:' + escICS(e.title)));
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  /* Google's own prefill URL. No sign-in, no OAuth, no tokens of hers for us
   * to hold — the event opens already filled in and she presses save. */
  function googleUrl(entry, cfg, rec) {
    var brand = (cfg.brand && cfg.brand.name) || 'NailScan';
    var dates;
    if (entry.time) {
      var t = String(entry.time).split(':');
      var hh = ('0' + (+t[0] || 0)).slice(-2), mm = ('0' + (+t[1] || 0)).slice(-2);
      var endMin = (+t[1] || 0) + 10, endHr = (+t[0] || 0) + Math.floor(endMin / 60);
      dates = compact(entry.date) + 'T' + hh + mm + '00' + '/' +
              compact(entry.date) + 'T' + ('0' + (endHr % 24)).slice(-2) + ('0' + (endMin % 60)).slice(-2) + '00';
    } else {
      dates = compact(entry.date) + '/' + compact(iso(addDays(parse(entry.date), 1)));
    }
    var details = entry.why + '\n\nFrom your ' + brand + ' nail reading.';
    var url = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
      + '&text=' + encodeURIComponent(entry.title)
      + '&dates=' + dates
      + '&details=' + encodeURIComponent(details);
    if (entry.rrule) url += '&recur=' + encodeURIComponent('RRULE:' + entry.rrule);
    return url;
  }

  window.NailScanPlan = {
    build: build,
    cadenceLine: cadenceLine,
    fmtTime: fmtTime,
    toICS: toICS,
    googleUrl: googleUrl,
    iso: iso,
    parse: parse,
    addDays: addDays,
    daysBetween: daysBetween,
    serviceFor: serviceFor
  };
})();
