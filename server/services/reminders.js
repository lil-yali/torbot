const pool = require('../db/index');
const { sendWhatsApp } = require('./twilio');

// Reminders are sent for real only when ENABLE_REMINDERS=true. Otherwise the sweep
// runs in dry-run mode (logs what it would send) so it never surprises you with
// outbound WhatsApp traffic during development.
const DRY_RUN = process.env.ENABLE_REMINDERS !== 'true';

function formatHe(dt) {
  return new Date(dt).toLocaleString('he-IL', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

// Find confirmed appointments starting within the next 24h that haven't been reminded,
// send each a reminder, and mark it so it isn't sent twice.
async function runReminderSweep() {
  const { rows } = await pool.query(
    `SELECT a.*, b.name AS business_name
     FROM appointments a
     LEFT JOIN businesses b ON b.phone = a.business_phone
     WHERE a.status = 'confirmed' AND a.reminded = FALSE
       AND a.datetime > NOW() AND a.datetime <= NOW() + INTERVAL '24 hours'`
  );

  for (const apt of rows) {
    const body = `תזכורת מ${apt.business_name ? '־' + apt.business_name : ' TorBot'}: יש לך תור ב${formatHe(apt.datetime)}. נתראה! 😊`;
    try {
      if (DRY_RUN) console.log(`[reminder:dry-run] → ${apt.customer_phone}: ${body}`);
      else await sendWhatsApp(apt.customer_phone, body);
    } catch (e) {
      console.error('Reminder send failed for', apt.id, e.message);
    }
    // Mark as reminded either way, so we don't loop on the same appointment.
    await pool.query(`UPDATE appointments SET reminded = TRUE WHERE id = $1`, [apt.id]);
  }

  if (rows.length) console.log(`[reminders] processed ${rows.length} appointment(s)${DRY_RUN ? ' (dry-run)' : ''}`);
  return rows.length;
}

function startReminderScheduler(intervalMs = 15 * 60 * 1000) {
  runReminderSweep().catch(e => console.error('reminder sweep error:', e.message));
  const timer = setInterval(() => runReminderSweep().catch(e => console.error('reminder sweep error:', e.message)), intervalMs);
  timer.unref?.();
  console.log(`Reminder scheduler started (${DRY_RUN ? 'dry-run' : 'live'}, every ${Math.round(intervalMs / 60000)}m)`);
  return timer;
}

module.exports = { runReminderSweep, startReminderScheduler };
