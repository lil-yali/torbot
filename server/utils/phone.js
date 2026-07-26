// Normalize a phone value for consistent storage/lookups.
// Strips the WhatsApp "whatsapp:" prefix (case-insensitive) and surrounding spaces,
// so a business/customer is always identified by the same string everywhere.
function normalizePhone(phone) {
  if (phone == null) return phone;
  return String(phone).replace(/^whatsapp:/i, '').trim();
}

module.exports = { normalizePhone };
