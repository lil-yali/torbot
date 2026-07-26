const express = require('express');
const twilio = require('twilio');
const router = express.Router();
const { handleIncomingMessage } = require('../services/ai');
const { sendWhatsApp } = require('../services/twilio');

// Verify the request really came from Twilio (X-Twilio-Signature). Disabled by default so
// the dev sandbox works; enable in production with VALIDATE_TWILIO=true and PUBLIC_WEBHOOK_URL
// set to the exact public URL Twilio calls (e.g. https://yourdomain.com/webhook).
function isFromTwilio(req) {
  if (process.env.VALIDATE_TWILIO !== 'true') return true;
  const signature = req.headers['x-twilio-signature'];
  const url = process.env.PUBLIC_WEBHOOK_URL || `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, req.body);
}

// Twilio inbound WhatsApp webhook.
router.post('/', async (req, res) => {
  if (!isFromTwilio(req)) return res.status(403).send('invalid signature');
  const { From, To, Body } = req.body;
  console.log(`Message from ${From} to ${To}: ${Body}`);

  // Acknowledge Twilio immediately; process and reply asynchronously.
  res.status(200).send('OK');

  try {
    // In the Twilio sandbox every business shares one WhatsApp number (To). To make the
    // demo coherent (bookings show up in the dashboard), route sandbox traffic to a
    // configured business when SANDBOX_BUSINESS_PHONE is set.
    const reply = await handleIncomingMessage({
      customerPhone: From,
      businessPhone: process.env.SANDBOX_BUSINESS_PHONE || To,
      message: Body,
    });
    // Reply from the business number (To) back to the customer (From).
    await sendWhatsApp(From, reply, To);
  } catch (err) {
    console.error('Webhook processing error:', err.message);
  }
});

module.exports = router;
