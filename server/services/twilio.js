require('dotenv').config();
const twilio = require('twilio');

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM } = process.env;

let client = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_ACCOUNT_SID.startsWith('AC')) {
  try { client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN); } catch (e) {
    console.warn('Twilio init failed:', e.message);
  }
}

// Send a WhatsApp message. If Twilio isn't configured, log instead of throwing
// so local development works without credentials.
// opts.contentSid + opts.contentVariables → send via a Twilio/Meta approved Content template
// (required for business-initiated messages like reminders outside the 24h window).
async function sendWhatsApp(to, body, from, opts = {}) {
  const toAddr = String(to).startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  if (!client) {
    console.log(`[whatsapp:not-configured] → ${toAddr}: ${body}`);
    return { simulated: true };
  }
  const msg = { from: from || TWILIO_WHATSAPP_FROM, to: toAddr };
  if (opts.contentSid) {
    msg.contentSid = opts.contentSid;
    if (opts.contentVariables) msg.contentVariables = JSON.stringify(opts.contentVariables);
  } else {
    msg.body = body;
  }
  return client.messages.create(msg);
}

module.exports = { sendWhatsApp, twilioEnabled: () => !!client };
