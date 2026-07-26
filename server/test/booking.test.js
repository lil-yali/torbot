module.exports = async () => {
  const pool = require('../db/index');
  const { bookAppointment, cancelAppointment } = require('../services/calender');
  const { validateSlot, getAvailableSlots } = require('../services/availability');

  const biz = '+972500000001';
  const cust = '+972541234567';

  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const nthWorkingDay = (n) => {
    const d = new Date(); d.setHours(0, 0, 0, 0); let c = 0;
    while (c < n) { d.setDate(d.getDate() + 1); if (d.getDay() >= 0 && d.getDay() <= 4) c++; }
    return fmt(d);
  };
  const nextByWeekday = (target) => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== target);
    return fmt(d);
  };

  await pool.query(
    `INSERT INTO businesses (name, phone, password, working_hours, slot_duration, max_days_ahead)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['Test Biz', biz, 'x',
      JSON.stringify({ days: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי'], start: '09:00', end: '18:00' }),
      30, 30]
  );

  const day1 = nthWorkingDay(1);
  const day2 = nthWorkingDay(2);

  // Valid slot accepted
  let v = await validateSlot(biz, day1, '10:00');
  check('valid future slot is accepted', v.ok === true);

  // Book it, then it should disappear from availability and become "taken"
  await bookAppointment({ customerPhone: cust, businessPhone: biz, customerName: 'טסט', datetime: `${day1}T10:00` });
  const avail = await getAvailableSlots(biz, day1);
  check('booked slot removed from availability', !avail.includes('10:00'));
  v = await validateSlot(biz, day1, '10:00');
  eq('re-booking same slot → taken', v.reason, 'taken');

  // DB-level double-booking guard (unique index) — a direct second insert must fail
  let threw = false;
  try {
    await pool.query(
      `INSERT INTO appointments (business_phone, customer_phone, customer_name, datetime)
       VALUES ($1,$2,$3,$4)`,
      [biz, '+972540000000', 'x', `${day1}T10:00`]
    );
  } catch { threw = true; }
  check('DB rejects duplicate confirmed slot (unique index)', threw);

  // Cancel frees the slot again
  const { rows } = await pool.query(
    `SELECT id FROM appointments WHERE business_phone=$1 AND datetime=$2 AND status='confirmed'`,
    [biz, `${day1}T10:00`]
  );
  await cancelAppointment(rows[0].id);
  const availAfter = await getAvailableSlots(biz, day1);
  check('cancelling frees the slot', availAfter.includes('10:00'));

  // Validation rules
  eq('past date rejected', (await validateSlot(biz, '2020-01-01', '10:00')).reason, 'past_date');
  eq('outside working hours rejected', (await validateSlot(biz, day1, '20:00')).reason, 'outside_hours');
  eq('unaligned time rejected', (await validateSlot(biz, day1, '10:07')).reason, 'unaligned');
  eq('closed weekday rejected', (await validateSlot(biz, nextByWeekday(6), '10:00')).reason, 'closed_day');
  eq('invalid calendar date rejected', (await validateSlot(biz, '2026-02-30', '10:00')).reason, 'invalid_date');

  // Blocked date
  await pool.query(`INSERT INTO blocked_dates (business_phone, date) VALUES ($1,$2)`, [biz, day2]);
  eq('blocked date rejected', (await validateSlot(biz, day2, '10:00')).reason, 'blocked');
  eq('blocked date has no availability', (await getAvailableSlots(biz, day2)).length, 0);

  // Special per-date hours override
  const { setDateOverride } = require('../services/availability');
  const nextSaturday = nextByWeekday(6); // normally closed
  eq('Saturday closed before override', (await getAvailableSlots(biz, nextSaturday)).length, 0);
  await setDateOverride(biz, nextSaturday, '10:00', '12:00');
  eq('override opens a closed day', (await getAvailableSlots(biz, nextSaturday)), ['10:00', '10:30', '11:00', '11:30']);
  check('override slot validates ok', (await validateSlot(biz, nextSaturday, '11:00')).ok === true);

  const day3 = nthWorkingDay(3);
  await setDateOverride(biz, day3, '09:00', '20:00'); // extend beyond normal 18:00
  check('extended hours allow a late slot', (await getAvailableSlots(biz, day3)).includes('19:00'));
  check('late slot beyond normal hours validates', (await validateSlot(biz, day3, '19:00')).ok === true);
};
