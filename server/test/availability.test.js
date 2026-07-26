module.exports = async () => {
  const A = require('../services/availability');
  const { parseDate, generateSlotsForSettings, getSettings } = A._internals;

  // Strict calendar-date parsing
  check('parseDate rejects 2026-04-31 (April has 30 days)', parseDate('2026-04-31') === null);
  check('parseDate rejects 2026-02-30', parseDate('2026-02-30') === null);
  check('parseDate rejects garbage', parseDate('hello') === null);
  check('parseDate accepts 2026-07-30', !!parseDate('2026-07-30'));

  // Settings parsing
  const biz = {
    working_hours: JSON.stringify({ days: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי'], start: '09:00', end: '18:00' }),
    slot_duration: 30, max_days_ahead: 30,
  };
  const s = getSettings(biz);
  eq('settings slot duration', s.slot, 30);
  eq('settings working-day count', s.dayNums.size, 5);

  // Slot generation
  const thu = parseDate('2026-07-30'); // Thursday (a working day)
  const slots = generateSlotsForSettings(s, thu);
  eq('Thursday 09-18 /30 → 18 slots', slots.length, 18);
  eq('first slot', slots[0], '09:00');
  eq('last slot', slots[slots.length - 1], '17:30');

  const sat = parseDate('2026-08-01'); // Saturday (closed)
  eq('closed Saturday → 0 slots', generateSlotsForSettings(s, sat).length, 0);

  // 60-minute slots on a shorter day
  const biz60 = { working_hours: JSON.stringify({ days: ['שני'], start: '09:00', end: '12:00' }), slot_duration: 60 };
  const mon = parseDate('2026-07-27'); // Monday
  eq('60-min slots 09-12', generateSlotsForSettings(getSettings(biz60), mon), ['09:00', '10:00', '11:00']);

  // Defaults when a business has no settings
  const def = getSettings(null);
  eq('default slot duration', def.slot, 30);
  eq('default max days ahead', def.maxDays, 30);
  check('default working days include Sunday', def.dayNums.has(0));
  check('default working days exclude Saturday', !def.dayNums.has(6));

  // English day aliases are accepted too
  const bizEn = { working_hours: JSON.stringify({ days: ['Sun', 'Mon'], start: '09:00', end: '10:00' }), slot_duration: 30 };
  eq('English aliases → 2 days', getSettings(bizEn).dayNums.size, 2);
};
