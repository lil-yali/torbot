const pool = require('../db/index');
const { normalizePhone } = require('../utils/phone');

async function getBusySlots(businessPhone, date) {
  const result = await pool.query(
    `SELECT datetime FROM appointments
     WHERE business_phone = $1
     AND DATE(datetime) = $2
     AND status = 'confirmed'`,
    [normalizePhone(businessPhone), date]
  );
  return result.rows.map(r => r.datetime);
}

async function bookAppointment({ customerPhone, businessPhone, customerName, datetime }) {
  const customer = normalizePhone(customerPhone);
  const business = normalizePhone(businessPhone);

  await pool.query(
    `INSERT INTO customers (phone, name) VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET name = $2`,
    [customer, customerName]
  );

  await pool.query(
    `INSERT INTO appointments (business_phone, customer_phone, customer_name, datetime)
     VALUES ($1, $2, $3, $4)`,
    [business, customer, customerName, datetime]
  );
}

async function getCustomerAppointments(customerPhone, businessPhone) {
  const result = await pool.query(
    `SELECT id, datetime, customer_name FROM appointments
     WHERE customer_phone = $1
     AND business_phone = $2
     AND status = 'confirmed'
     AND datetime > NOW()
     ORDER BY datetime ASC`,
    [normalizePhone(customerPhone), normalizePhone(businessPhone)]
  );
  return result.rows;
}

async function cancelAppointment(appointmentId) {
  await pool.query(
    `UPDATE appointments SET status = 'cancelled' WHERE id = $1`,
    [appointmentId]
  );
}

async function rescheduleAppointment(appointmentId, newDatetime) {
  await pool.query(
    `UPDATE appointments SET datetime = $1 WHERE id = $2`,
    [newDatetime, appointmentId]
  );
}

module.exports = { getBusySlots, bookAppointment, getCustomerAppointments, cancelAppointment, rescheduleAppointment };
