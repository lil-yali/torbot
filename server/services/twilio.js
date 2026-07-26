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
async function sendWhatsApp(to, body, from) {
  const toAddr = String(to).startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  if (!client) {
    console.log(`[whatsapp:not-configured] → ${toAddr}: ${body}`);
    return { simulated: true };
  }
  return client.messages.create({ from: from || TWILIO_WHATSAPP_FROM, to: toAddr, body });
}

module.exports = { sendWhatsApp, twilioEnabled: () => !!client };
