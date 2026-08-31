/* The planner's arithmetic, checked.
 *
 * public/js/plan.js is a browser file, but it is pure — no DOM, no network — so
 * it runs here under a fake `window` and every rule can be asserted against a
 * real record from the real engine.
 *
 * These are the sums that put dates in somebody's phone. They are worth testing.
 *
 *   node test/plan-test.mjs
 */
import fs from 'fs';
import vm from 'vm';

const here = new URL('.', import.meta.url).pathname;
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(here + '../public/js/plan.js', 'utf8'), sandbox);
const P = sandbox.window.NailScanPlan;

// The plan block out of the shipped config, loaded the same way.
const cfgSrc = fs.readFileSync(here + '../public/config.js', 'utf8');
const cfgBox = { window: {} };
vm.createContext(cfgBox);
vm.runInContext(cfgSrc, cfgBox);
const cfg = cfgBox.window.NAILSCAN_CONFIG;

const record = JSON.parse(fs.readFileSync(here + 'record.manageable.json', 'utf8')).record;

const TODAY = new Date(2026, 8, 1);           // 1 Sep 2026, local
const iso = P.iso;
const plus = n => iso(P.addDays(TODAY, n));

let pass = 0, fail = 0;
function check(label, cond, extra) {
  if (cond) { console.log('  PASS  ' + label); pass++; }
  else { console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); fail++; }
}
const find = (p, id) => p.entries.find(e => e.id === id);

/* ------------------------------------------------------- care milestones -- */
console.log('CARE MILESTONES COME THROUGH UNTOUCHED');
{
  const p = P.build({ record, cfg, today: TODAY, service: '', rhythm: 'usual', eventDate: '' });
  const care = p.entries.filter(e => e.kind === 'care' || e.kind === 'goal');
  check('every milestone from the reading is present',
    care.length === record.display.calendar.milestones.length,
    `${care.length} vs ${record.display.calendar.milestones.length}`);
  check('their dates are not touched',
    care.every(e => record.display.calendar.milestones.some(m => m.date === e.date)));
  check('every entry carries a reason', p.entries.every(e => e.why && e.why.length > 20));
  check('a grow-out goal is not ticked by default',
    care.filter(e => e.kind === 'goal').every(e => e.on === false));
}

/* --------------------------------------------------------------- rebook -- */
console.log('\nWHAT SHE HAD DONE TODAY SETS THE RHYTHM');
{
  const p = P.build({ record, cfg, today: TODAY, service: 'gel-polish', rhythm: 'usual', eventDate: '' });
  const first = find(p, 'rebook-1');
  check('gel polish books the next one at three weeks', first && first.date === plus(21), first && first.date);
  check('it is ticked by default', first && first.on === true);
  check('it explains why three weeks', first && /lifting at the edges/.test(first.why));

  const often = P.build({ record, cfg, today: TODAY, service: 'gel-polish', rhythm: 'often', eventDate: '' });
  check('someone who comes fortnightly gets a shorter interval',
    P.daysBetween(iso(TODAY), find(often, 'rebook-1').date) < 21);
  check('and more appointments projected',
    often.entries.filter(e => e.kind === 'rebook').length >
    p.entries.filter(e => e.kind === 'rebook').length);

  const rarely = P.build({ record, cfg, today: TODAY, service: 'gel-polish', rhythm: 'rarely', eventDate: '' });
  check('someone who comes rarely gets exactly one',
    rarely.entries.filter(e => e.kind === 'rebook').length === 1);

  const none = P.build({ record, cfg, today: TODAY, service: '', rhythm: 'usual', eventDate: '' });
  check('nothing done today books nothing', none.entries.filter(e => e.kind === 'rebook').length === 0);

  const pedi = P.build({ record, cfg, today: TODAY, service: 'gel-pedicure', rhythm: 'usual', eventDate: '' });
  check('toes are on their own six-week clock', find(pedi, 'rebook-1').date === plus(42));
}

/* ---------------------------------------------------------------- event -- */
console.log('\nSOMETHING COMING UP WORKS BACKWARDS');
{
  const party = plus(7);
  const p = P.build({ record, cfg, today: TODAY, service: 'gel-polish', rhythm: 'usual',
                      eventDate: party, eventLabel: 'the party' });
  const prep = find(p, 'event-prep');
  check('a party in 7 days books 3 days before', prep && prep.date === plus(4), prep && prep.date);
  check('the appointment is the primary one', prep && prep.primary === true);
  check('the event itself is shown but not added to her calendar',
    find(p, 'event') && find(p, 'event').on === false);
  check('it explains the two-to-five-day window', prep && /still setting/.test(prep.why));

  const soon = P.build({ record, cfg, today: TODAY, service: 'gel-polish', rhythm: 'usual',
                         eventDate: plus(1), eventLabel: 'the party' });
  check('an event tomorrow says so instead of booking the past',
    !find(soon, 'event-prep') && soon.notes.some(n => /first slot/.test(n)));

  const far = P.build({ record, cfg, today: TODAY, service: 'gel-polish', rhythm: 'usual',
                        eventDate: plus(60), eventLabel: 'the wedding' });
  check('an event past the life of this set warns it will be a fresh one',
    far.notes.some(n => /past its best/.test(n)));
  check('the appointment still lands three days before',
    find(far, 'event-prep').date === plus(57));

  check('a removal due before the event is called out',
    p.notes.some(n => /removal-by date/.test(n)));

  // The nastiest version: the removal falls on the day of the party itself.
  const clash = P.build({ record, cfg, today: TODAY, service: 'gel-polish', rhythm: 'usual',
                          eventDate: record.display.calendar.milestones.find(m => /removal/i.test(m.label)).date,
                          eventLabel: 'the party' });
  check('a removal due ON the day is still called out',
    clash.notes.some(n => /on or before/.test(n)));
  check('everything is in date order',
    p.entries.every((e, i, a) => i === 0 || a[i - 1].date <= e.date));

  const past = P.build({ record, cfg, today: TODAY, service: '', rhythm: 'usual', eventDate: plus(-5) });
  check('a date in the past is ignored', !find(past, 'event'));
}

/* ------------------------------------------------------------------ ics -- */
console.log('\nTHE FILE HER PHONE OPENS');
{
  const p = P.build({ record, cfg, today: TODAY, service: 'gel-polish', rhythm: 'usual',
                      eventDate: plus(7), eventLabel: 'the party, with Nina' });
  const picked = p.entries.filter(e => e.on);
  const ics = P.toICS(picked, cfg, record);

  check('it is a calendar', /^BEGIN:VCALENDAR/.test(ics) && /END:VCALENDAR\r\n$/.test(ics));
  check('one event per ticked date',
    (ics.match(/BEGIN:VEVENT/g) || []).length === picked.length);
  check('every event closes', (ics.match(/END:VEVENT/g) || []).length === picked.length);
  check('dates are all-day, not a guess at her diary', /DTSTART;VALUE=DATE:\d{8}/.test(ics));
  check('each event ends the following day', /DTEND;VALUE=DATE:\d{8}/.test(ics));
  check('every event has a reminder the day before',
    (ics.match(/TRIGGER:-P1D/g) || []).length === picked.length);
  check('every event has a unique id', new Set(ics.match(/^UID:.*$/gm)).size === picked.length);
  check('lines end CRLF as the spec requires', !/[^\r]\n/.test(ics));
  check('no line exceeds the 75-octet limit',
    ics.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75));

  const commaCase = P.toICS([{ id: 'x', date: plus(3), title: 'Book for the party, with Nina',
                               why: 'Two; three, and a\nnewline' }], cfg, record);
  check('commas and semicolons are escaped', /SUMMARY:Book for the party\\, with Nina/.test(commaCase));
  check('newlines become \\n', /Two\\; three\\, and a\\nnewline/.test(commaCase));

  // The copy bank is full of em dashes and curly quotes at three bytes each.
  // Folding by characters would sail past the octet limit and could cut one in
  // half, which is how a calendar file arrives corrupted on one phone and fine
  // on another.
  const wide = P.toICS([{ id: 'w', date: plus(3),
    title: '—————————— a title of em dashes ——————————',
    why: '— ' + '寿限無 '.repeat(30) + '— and a tail —' }], cfg, record);
  check('folds by octets, not characters',
    wide.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75));
  check('never cuts a character in half',
    !/\uFFFD/.test(Buffer.from(wide, 'utf8').toString('utf8')) &&
    wide.split('\r\n').every(l => !/[\uD800-\uDBFF]$/.test(l)));
  check('unfolding restores the original text',
    wide.replace(/\r\n /g, '').includes('a title of em dashes'));
}

/* --------------------------------------------------------------- habits -- */
console.log('\nHOME CARE');
{
  const p = P.build({ record, cfg, today: TODAY, service: 'gel-polish', rhythm: 'usual', eventDate: '' });
  const h = p.habits;
  const by = slug => h.find(x => x.id === 'habit-' + slug);

  check('every habit says what it is for', h.every(x => x.why && x.why.length > 40));
  check('none of them is a supplement or a dose',
    !JSON.stringify(h).match(/biotin|collagen|mg\b|dose|supplement|vitamin/i));
  check('the daily one starts tomorrow, not in the past',
    by('oil-damp').date === plus(1));
  check('it repeats daily for eight weeks',
    by('oil-damp').rrule === 'FREQ=DAILY;COUNT=56');
  check('it has a time of day', /^\d{2}:\d{2}$/.test(by('oil-damp').time));
  check('a weekly one lands on its chosen weekday',
    P.parse(by('no-file-after-bath').date).getDay() === 0);
  check('a weekly one repeats eight times',
    by('no-file-after-bath').rrule === 'FREQ=WEEKLY;COUNT=8');
  check('a one-off has no recurrence', by('hardener-check').rrule === '');
  check('only two start ticked', h.filter(x => x.on).length === 2);

  // Relevance, not a leaflet: don't tell somebody with bare nails about the lamp.
  const bare = P.build({ record: { ...record, wear: 'bare' }, cfg, today: TODAY, service: '', rhythm: 'usual', eventDate: '' });
  check('lamp sunscreen only for people wearing gel',
    !!by('lamp-spf') && !bare.habits.find(x => x.id === 'habit-lamp-spf'));
  const healthy = P.build({ record: { ...record, tier: 'healthy' }, cfg, today: TODAY, service: '', rhythm: 'usual', eventDate: '' });
  check('keep-them-short only while something is recovering',
    !!by('short-while-recovering') && !healthy.habits.find(x => x.id === 'habit-short-while-recovering'));

  check('the cadence reads in plain words',
    /Every night at .* for 8 weeks/.test(P.cadenceLine(by('oil-damp'), 'en-US')));
  check('a weekly cadence names the day',
    /Every Sunday at/.test(P.cadenceLine(by('no-file-after-bath'), 'en-US')));
}

console.log('\nREMINDERS IN THE FILE');
{
  const p = P.build({ record, cfg, today: TODAY, service: 'gel-polish', rhythm: 'usual', eventDate: '' });
  const daily = p.habits.find(h => h.id === 'habit-oil-damp');
  const appt  = p.entries.find(e => e.kind === 'rebook');
  const ics = P.toICS([daily, appt], cfg, record);

  check('a reminder is a timed event', /DTSTART:\d{8}T\d{6}(?!Z)/.test(ics));
  check('its time floats — no Z, no timezone', !/DTSTART:\d{8}T\d{6}Z/.test(ics));
  check('it repeats', /RRULE:FREQ=DAILY;COUNT=56/.test(ics));
  check('an appointment is still all-day', /DTSTART;VALUE=DATE:\d{8}/.test(ics));
  check('an appointment has no recurrence',
    (ics.match(/RRULE/g) || []).length === 1);
  check('a reminder alerts at the time, an appointment the day before',
    /TRIGGER:-PT0M/.test(ics) && /TRIGGER:-P1D/.test(ics));

  const g = new URL(P.googleUrl(daily, cfg, record));
  check('the Google link carries the recurrence too',
    /FREQ=DAILY/.test(g.searchParams.get('recur') || ''));
  check('and a timed span', /^\d{8}T\d{6}\/\d{8}T\d{6}$/.test(g.searchParams.get('dates')));
}

/* --------------------------------------------------------------- google -- */
console.log('\nTHE GOOGLE LINK');
{
  const p = P.build({ record, cfg, today: TODAY, service: 'gel-polish', rhythm: 'usual', eventDate: '' });
  const url = P.googleUrl(find(p, 'rebook-1'), cfg, record);
  const u = new URL(url);
  check('it is Google’s own prefill endpoint',
    u.origin === 'https://calendar.google.com' && u.searchParams.get('action') === 'TEMPLATE');
  check('the title comes through', /gel/i.test(u.searchParams.get('text')));
  check('the dates are a one-day span',
    /^\d{8}\/\d{8}$/.test(u.searchParams.get('dates')));
  check('the reason travels with it', (u.searchParams.get('details') || '').length > 40);
  check('no sign-in, no token, nothing of hers', !/access_token|client_id/.test(url));
}

console.log(`\nTOTAL  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
