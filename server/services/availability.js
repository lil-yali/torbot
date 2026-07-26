// Deterministic availability logic. The AI only extracts intent; THIS module decides
// what is actually bookable — working hours, slot grid, blocked dates, look-ahead window,
// past times, and double-booking. All rules live here, in code, not in the prompt.

const pool = require('../db/index');
const { normalizePhone } = require('../utils/phone');

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']; // index = Date.getDay()

// Accept Hebrew names and common English abbreviations for working days.
const DAY_ALIASES = {
  'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3, 'חמישי': 4, 'שישי': 5, 'שבת': 6,
  'sun': 0, 'mon': 1, 'tue': 2, 'wed': 3, 'thu': 4, 'fri': 5, 'sat': 6,
  'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6,
};

const DEFAULT_HOURS = { days: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי'], start: '09:00', end: '18:00' };
const DEFAULT_SLOT = 30;
const DEFAULT_MAX_DAYS = 30;

// ---------- small date/time helpers ----------
const toMinutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const isSameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Strictly parse "YYYY-MM-DD" to a local-midnight Date, rejecting invalid calendar dates (e.g. 2026-04-31).
function parseDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return null;
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function getSettings(business) {
  let wh = business && business.working_hours;
  if (typeof wh === 'string') { try { wh = JSON.parse(wh); } catch { wh = null; } }
  const days = (wh && Array.isArray(wh.days) && wh.days.length) ? wh.days : DEFAULT_HOURS.days;
  const dayNums = new Set(
    days.map(d => DAY_ALIASES[String(d).trim().toLowerCase()]).filter(n => n != null)
  );
  return {
    dayNums,
    start: (wh && wh.start) || DEFAULT_HOURS.start,
    end: (wh && wh.end) || DEFAULT_HOURS.end,
    slot: Number(business && business.slot_duration) || DEFAULT_SLOT,
    maxDays: Number(business && business.max_days_ahead) || DEFAULT_MAX_DAYS,
  };
}

function generateSlotsInRange(startHHMM, endHHMM, slot) {
  const startM = toMinutes(startHHMM);
  const endM = toMinutes(endHHMM);
  const slots = [];
  for (let m = startM; m + slot <= endM; m += slot) slots.push(toHHMM(m));
  return slots;
}

function generateSlotsForSettings(settings, dt) {
  if (!settings.dayNums.has(dt.getDay())) return [];
  return generateSlotsInRange(settings.start, settings.end, settings.slot);
}

// ---------- DB-backed lookups ----------
async function fetchBusiness(businessPhone) {
  const r = await pool.query('SELECT * FROM businesses WHERE phone = $1', [normalizePhone(businessPhone)]);
  return r.rows[0] || null;
}

async function isDateBlocked(businessPhone, dateStr) {
  const r = await pool.query(
    'SELECT 1 FROM blocked_dates WHERE business_phone = $1 AND date = $2',
    [normalizePhone(businessPhone), dateStr]
  );
  return r.rows.length > 0;
}

// Special hours for a specific date, or null if none. When present, they replace the
// normal hours and open the day even if it's normally a day off.
async function getDateOverride(businessPhone, dateStr) {
  const r = await pool.query(
    'SELECT start_time, end_time FROM date_overrides WHERE business_phone = $1 AND date = $2',
    [normalizePhone(businessPhone), dateStr]
  );
  return r.rows[0] ? { start: r.rows[0].start_time, end: r.rows[0].end_time } : null;
}

async function bookedTimes(businessPhone, dateStr) {
  const r = await pool.query(
    `SELECT datetime FROM appointments WHERE business_phone = $1 AND DATE(datetime) = $2 AND status = 'confirmed'`,
    [normalizePhone(businessPhone), dateStr]
  );
  return new Set(r.rows.map(row => {
    const d = new Date(row.datetime);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }));
}

// ---------- public API ----------

// Free, bookable slots ("HH:MM") for a business on a given date.
async function getAvailableSlots(businessPhone, dateStr) {
  const dt = parseDate(dateStr);
  if (!dt) return [];
  const settings = getSettings(await fetchBusiness(businessPhone));

  const today = startOfToday();
  const maxDate = addDays(today, settings.maxDays);
  if (dt < today || dt > maxDate) return [];
  if (await isDateBlocked(businessPhone, dateStr)) return [];

  const override = await getDateOverride(businessPhone, dateStr);
  let slots = override
    ? generateSlotsInRange(override.start, override.end, settings.slot)
    : generateSlotsForSettings(settings, dt);
  const booked = await bookedTimes(businessPhone, dateStr);
  slots = slots.filter(s => !booked.has(s));

  const now = new Date();
  if (isSameDay(dt, now)) {
    const nowM = now.getHours() * 60 + now.getMinutes();
    slots = slots.filter(s => toMinutes(s) > nowM);
  }
  return slots;
}

// Validate a specific requested slot. Returns { ok, reason, ...context }.
async function validateSlot(businessPhone, dateStr, timeStr) {
  const dt = parseDate(dateStr);
  if (!dt) return { ok: false, reason: 'invalid_date' };
  if (!/^\d{1,2}:\d{2}$/.test(timeStr || '')) return { ok: false, reason: 'invalid_time' };

  const settings = getSettings(await fetchBusiness(businessPhone));
  const today = startOfToday();
  const maxDate = addDays(today, settings.maxDays);

  const override = await getDateOverride(businessPhone, dateStr);

  if (dt < today) return { ok: false, reason: 'past_date' };
  if (dt > maxDate) return { ok: false, reason: 'too_far', maxDays: settings.maxDays };
  if (!override && !settings.dayNums.has(dt.getDay())) return { ok: false, reason: 'closed_day' };
  if (await isDateBlocked(businessPhone, dateStr)) return { ok: false, reason: 'blocked' };

  const hoursStart = override ? override.start : settings.start;
  const hoursEnd = override ? override.end : settings.end;
  const startM = toMinutes(hoursStart);
  const endM = toMinutes(hoursEnd);
  const tM = toMinutes(timeStr);
  if (tM < startM || tM + settings.slot > endM) {
    return { ok: false, reason: 'outside_hours', start: hoursStart, end: hoursEnd };
  }
  if ((tM - startM) % settings.slot !== 0) return { ok: false, reason: 'unaligned', slot: settings.slot };

  const now = new Date();
  if (isSameDay(dt, now) && tM <= now.getHours() * 60 + now.getMinutes()) {
    return { ok: false, reason: 'past_time' };
  }

  const booked = await bookedTimes(businessPhone, dateStr);
  if (booked.has(timeStr.padStart(5, '0'))) return { ok: false, reason: 'taken' };

  return { ok: true, datetime: `${dateStr}T${timeStr.padStart(5, '0')}` };
}

// A human-readable "date = weekday" table for the next N days, injected into the AI prompt
// so the model looks dates up instead of computing them (its weak spot).
function dateReferenceTable(days = 14) {
  const today = startOfToday();
  const rows = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const tag = i === 0 ? ' (היום)' : i === 1 ? ' (מחר)' : '';
    rows.push(`${fmtDate(d)} = יום ${HE_DAYS[d.getDay()]}${tag}`);
  }
  return rows.join('\n');
}

// Compact availability summary for the next few days, for the bot to offer real slots.
async function availabilitySummary(businessPhone, days = 5) {
  const today = startOfToday();
  const lines = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const dateStr = fmtDate(d);
    const slots = await getAvailableSlots(businessPhone, dateStr);
    if (slots.length) {
      lines.push(`${dateStr} (${HE_DAYS[d.getDay()]}): ${slots.join(', ')}`);
    }
  }
  return lines.length ? lines.join('\n') : 'אין שעות פנויות בימים הקרובים';
}

async function setDateOverride(businessPhone, dateStr, start, end) {
  await pool.query(
    `INSERT INTO date_overrides (business_phone, date, start_time, end_time)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (business_phone, date) DO UPDATE SET start_time = $3, end_time = $4`,
    [normalizePhone(businessPhone), dateStr, start, end]
  );
}

module.exports = {
  getAvailableSlots,
  validateSlot,
  dateReferenceTable,
  availabilitySummary,
  fetchBusiness,
  getSettings,
  getDateOverride,
  setDateOverride,
  // exported for unit tests:
  _internals: { parseDate, generateSlotsForSettings, generateSlotsInRange, getSettings, toMinutes, toHHMM, HE_DAYS, DAY_ALIASES },
};
