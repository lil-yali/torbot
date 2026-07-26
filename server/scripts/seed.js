// Seed demo data. Run with the server STOPPED (PGlite is single-process):  npm run seed
require('dotenv').config();
process.env.USE_LOCAL_DB = process.env.USE_LOCAL_DB || 'true';
const bcrypt = require('bcryptjs');
const pool = require('../db/index');

const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function nextWorkingDays(count) {
  const res = [];
  const d = new Date(); d.setHours(0, 0, 0, 0);
  while (res.length < count) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() >= 0 && d.getDay() <= 4) res.push(new Date(d)); // Sun–Thu
  }
  return res;
}

(async () => {
  const phone = '+972500000001';
  const hash = await bcrypt.hash('1234', 10);

  await pool.query(
    `INSERT INTO businesses (name, phone, password, working_hours, slot_duration, max_days_ahead)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (phone) DO UPDATE SET
       name = $1, password = $3, working_hours = $4, slot_duration = $5, max_days_ahead = $6`,
    ['מספרת TorBot', phone, hash,
      JSON.stringify({ days: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי'], start: '09:00', end: '18:00' }),
      30, 30]
  );

  const [d1, d2] = nextWorkingDays(2);
  const samples = [
    { name: 'דנה כהן', phone: '+972541111111', dt: `${fmt(d1)}T10:00` },
    { name: 'יוסי לוי', phone: '+972542222222', dt: `${fmt(d1)}T14:30` },
    { name: 'מאיה בר', phone: '+972543333333', dt: `${fmt(d2)}T11:00` },
  ];

  for (const s of samples) {
    await pool.query(
      `INSERT INTO customers (phone, name) VALUES ($1, $2) ON CONFLICT (phone) DO UPDATE SET name = $2`,
      [s.phone, s.name]
    );
    await pool.query(
      `INSERT INTO appointments (business_phone, customer_phone, customer_name, datetime)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [phone, s.phone, s.name, s.dt]
    );
  }

  console.log('✓ Seeded demo business "מספרת TorBot" + 3 sample appointments.');
  console.log('  Login:  phone +972500000001  /  password 1234');
  process.exit(0);
})().catch(e => { console.error('Seed failed:', e); process.exit(1); });
