// Pin the process timezone so naive appointment times ("2026-07-27T10:00")
// always mean Israel time, regardless of where the server runs (local vs. cloud/UTC).
process.env.TZ = process.env.TZ || 'Asia/Jerusalem';

require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { normalizePhone } = require('./utils/phone');
const { handleIncomingMessage, resetConversation } = require('./services/ai');
const { getAvailableSlots, validateSlot, setDateOverride, getDateOverride } = require('./services/availability');
const { bookAppointment, rescheduleAppointment } = require('./services/calender');
const { sendWhatsApp } = require('./services/twilio');
const pool = require('./db/index');

// Notify a customer on WhatsApp (fire-and-forget; logs on failure).
function notifyCustomer(phone, message) {
  sendWhatsApp(phone, message).catch(e => console.error('customer notify failed:', e.message));
}
const formatWhen = (dt) => new Date(dt).toLocaleString('he-IL', {
  weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

const JWT_SECRET = process.env.JWT_SECRET || 'torbot-dev-secret';
const app = express();
app.set('trust proxy', 1); // behind a proxy/tunnel in production — trust one hop for real client IPs
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---- Rate limiting ----
const rateLimit = require('express-rate-limit');
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_attempts' } });
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
// Health check (unlimited — used by the host to know the service is alive).
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/', apiLimiter);

// ---- Twilio inbound webhook (public) ----
app.use('/webhook', webhookLimiter, require('./routes/webhook'));

// ---- Auth helpers ----
const signToken = (phone) => jwt.sign({ phone: normalizePhone(phone) }, JWT_SECRET, { expiresIn: '30d' });

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    req.businessPhone = normalizePhone(jwt.verify(token, JWT_SECRET).phone);
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

// ---- Auth endpoints ----
app.post('/api/register', authLimiter, async (req, res) => {
  const { name, phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'missing_fields' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO businesses (name, phone, password) VALUES ($1, $2, $3)
       ON CONFLICT (phone) DO NOTHING RETURNING phone`,
      [name, normalizePhone(phone), hashed]
    );
    if (r.rows.length === 0) return res.status(409).json({ error: 'phone_exists' });
    res.json({ success: true, token: signToken(phone) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  const { phone, password } = req.body;
  try {
    const result = await pool.query(`SELECT * FROM businesses WHERE phone = $1`, [normalizePhone(phone)]);
    const business = result.rows[0];
    if (!business) return res.json({ success: false });

    const stored = business.password || '';
    let ok;
    if (stored.startsWith('$2')) {
      ok = await bcrypt.compare(password, stored);
    } else {
      // Legacy plaintext password: accept once, then transparently upgrade to a hash.
      ok = stored === password;
      if (ok) {
        const hashed = await bcrypt.hash(password, 10);
        await pool.query(`UPDATE businesses SET password = $1 WHERE phone = $2`, [hashed, business.phone]);
      }
    }
    if (!ok) return res.json({ success: false });
    res.json({ success: true, token: signToken(business.phone), name: business.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Settings (auth) ----
app.get('/api/settings', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT name, phone, working_hours, slot_duration, max_days_ahead, owner_phone, whatsapp_number FROM businesses WHERE phone = $1`,
      [req.businessPhone]
    );
    res.json(r.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings', auth, async (req, res) => {
  const { workingDays, startTime, endTime, slotDuration, maxDaysAhead, ownerPhone, whatsappNumber } = req.body;
  try {
    await pool.query(
      `UPDATE businesses SET working_hours = $1, slot_duration = $2, max_days_ahead = $3, owner_phone = $4, whatsapp_number = $5 WHERE phone = $6`,
      [
        JSON.stringify({ days: workingDays, start: startTime, end: endTime }),
        Number(slotDuration) || 30,
        Number(maxDaysAhead) || 30,
        ownerPhone ? normalizePhone(ownerPhone) : null,
        whatsappNumber ? normalizePhone(whatsappNumber) : null,
        req.businessPhone,
      ]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Appointments (auth, scoped to the logged-in business) ----
app.get('/api/appointments', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM appointments WHERE business_phone = $1 AND status = 'confirmed' ORDER BY datetime ASC`,
      [req.businessPhone]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/appointments/:id', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE appointments SET status = 'cancelled'
       WHERE id = $1 AND business_phone = $2 AND status = 'confirmed'
       RETURNING customer_phone, customer_name, datetime`,
      [req.params.id, req.businessPhone]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'not_found' });
    const apt = r.rows[0];

    // Notify the customer on WhatsApp that the business cancelled their appointment.
    const bn = await pool.query(`SELECT name FROM businesses WHERE phone = $1`, [req.businessPhone]);
    const businessName = bn.rows[0] && bn.rows[0].name;
    const when = new Date(apt.datetime).toLocaleString('he-IL', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    const msg = `שלום${apt.customer_name ? ' ' + apt.customer_name : ''}, התור שלך ל${when}${businessName ? ' ב־' + businessName : ''} בוטל על ידי העסק. לתיאום תור חדש פשוט שלח/י לנו הודעה כאן 🙏`;
    sendWhatsApp(apt.customer_phone, msg).catch(e => console.error('Cancel notification failed:', e.message));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Availability (auth): free slots for the logged-in business on a date ----
app.get('/api/availability', auth, async (req, res) => {
  try {
    const date = req.query.date;
    const slots = await getAvailableSlots(req.businessPhone, date);
    res.json({ date, slots });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Add an appointment manually (walk-in / phone booking) ----
app.post('/api/appointments', auth, async (req, res) => {
  const { name, phone, date, time } = req.body;
  if (!phone || !date || !time) return res.status(400).json({ error: 'missing_fields' });
  const datetime = `${date}T${String(time).padStart(5, '0')}`;
  if (isNaN(new Date(datetime).getTime())) return res.status(400).json({ error: 'invalid_datetime' });
  try {
    // Owner can add outside normal hours; the DB unique index still prevents double-booking.
    await bookAppointment({
      customerPhone: normalizePhone(phone), businessPhone: req.businessPhone,
      customerName: name || 'לקוח', datetime,
    });
    res.json({ success: true });
  } catch (err) {
    if (String(err.code) === '23505' || String(err.message || '').includes('uniq_confirmed_slot')) {
      return res.status(409).json({ error: 'slot_taken' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ---- Reschedule an appointment (validate the new slot + notify the customer) ----
app.post('/api/appointments/:id/reschedule', auth, async (req, res) => {
  const { date, time } = req.body;
  try {
    const found = await pool.query(
      `SELECT customer_phone, customer_name FROM appointments WHERE id = $1 AND business_phone = $2 AND status = 'confirmed'`,
      [req.params.id, req.businessPhone]
    );
    if (found.rows.length === 0) return res.status(404).json({ error: 'not_found' });

    const v = await validateSlot(req.businessPhone, date, time);
    if (!v.ok) return res.status(400).json({ error: v.reason });

    await rescheduleAppointment(req.params.id, v.datetime);
    const apt = found.rows[0];
    const bn = await pool.query(`SELECT name FROM businesses WHERE phone = $1`, [req.businessPhone]);
    const businessName = bn.rows[0] && bn.rows[0].name;
    notifyCustomer(apt.customer_phone,
      `שלום${apt.customer_name ? ' ' + apt.customer_name : ''}, התור שלך${businessName ? ' ב־' + businessName : ''} הוזז ל${formatWhen(v.datetime)} ✅`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Blocked dates & special hours (auth) ----
app.get('/api/schedule-exceptions', auth, async (req, res) => {
  try {
    const blocked = await pool.query(
      `SELECT date::text FROM blocked_dates WHERE business_phone = $1 AND date >= CURRENT_DATE ORDER BY date`,
      [req.businessPhone]);
    const overrides = await pool.query(
      `SELECT date::text, start_time, end_time FROM date_overrides WHERE business_phone = $1 AND date >= CURRENT_DATE ORDER BY date`,
      [req.businessPhone]);
    res.json({ blocked: blocked.rows.map(r => r.date), overrides: overrides.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/blocked', auth, async (req, res) => {
  try {
    await pool.query(`INSERT INTO blocked_dates (business_phone, date) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.businessPhone, req.body.date]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/blocked/:date', auth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM blocked_dates WHERE business_phone = $1 AND date = $2`,
      [req.businessPhone, req.params.date]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/hours', auth, async (req, res) => {
  const { date, start, end } = req.body;
  if (!date || !start || !end) return res.status(400).json({ error: 'missing_fields' });
  try {
    await setDateOverride(req.businessPhone, date, String(start).padStart(5, '0'), String(end).padStart(5, '0'));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/hours/:date', auth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM date_overrides WHERE business_phone = $1 AND date = $2`,
      [req.businessPhone, req.params.date]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Change password (logged-in owner) ----
app.post('/api/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'weak_password' });
  try {
    const r = await pool.query(`SELECT password FROM businesses WHERE phone = $1`, [req.businessPhone]);
    const stored = r.rows[0] && r.rows[0].password;
    const ok = stored && (stored.startsWith('$2') ? await bcrypt.compare(currentPassword || '', stored) : stored === currentPassword);
    if (!ok) return res.status(403).json({ error: 'wrong_password' });
    await pool.query(`UPDATE businesses SET password = $1 WHERE phone = $2`, [await bcrypt.hash(newPassword, 10), req.businessPhone]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- Legal pages ----
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'legal', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'legal', 'terms.html')));

// ---- Local test chat (no Twilio needed): talk to the bot's AI brain directly ----
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));

app.post('/api/chat', async (req, res) => {
  const { from, to, body } = req.body;
  try {
    const reply = await handleIncomingMessage({ customerPhone: from, businessPhone: to, message: body });
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat/reset', (req, res) => {
  const { from, to } = req.body;
  resetConversation({ customerPhone: from, businessPhone: to });
  res.json({ success: true });
});

// ---- Serve the built React dashboard (production: one service hosts API + site) ----
const fs = require('fs');
const clientBuild = path.join(__dirname, '..', 'client', 'build');
if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
  // SPA fallback: any non-API GET returns index.html so client-side routing works.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/webhook')) return next();
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
  console.log('Serving client build from', clientBuild);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  require('./services/reminders').startReminderScheduler();
});
