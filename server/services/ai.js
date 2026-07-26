require('dotenv').config();
const Groq = require('groq-sdk');
const {
  bookAppointment, getCustomerAppointments, cancelAppointment, rescheduleAppointment,
} = require('./calender');
const {
  validateSlot, getAvailableSlots, dateReferenceTable, availabilitySummary, fetchBusiness, getSettings, setDateOverride,
} = require('./availability');
const { sendWhatsApp } = require('./twilio');
const { normalizePhone } = require('../utils/phone');

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = 'llama-3.3-70b-versatile';

// Groq call with automatic retry on transient failures (network hiccups, rate limits),
// so a momentary error doesn't turn into a "temporary error" reply to the user.
async function groqChat(params, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await client.chat.completions.create(params);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// Per-conversation memory: { messages: [...], name: string|null }
const conversations = {};
const MAX_HISTORY = 12;

function getConversation(key) {
  if (!conversations[key]) conversations[key] = { messages: [], name: null };
  return conversations[key];
}

function resetConversation({ customerPhone, businessPhone }) {
  delete conversations[`${customerPhone}-${businessPhone}`];
}

// ---------- helpers ----------
const PLACEHOLDER_NAME = /^(שם|name|שם[ _]?הלקוח|שם מלא|null|לקוח)$/i;

function cleanName(raw) {
  if (!raw) return null;
  const n = String(raw).replace(/[\[\]<>."'`.,]/g, '').trim().split(/\s+/).slice(0, 2).join(' ');
  if (!n || PLACEHOLDER_NAME.test(n)) return null;
  return n;
}

// Deterministic name detection so we don't depend on the model reliably filling customer_name.
function localNameGuess(userText, prevAssistant) {
  if (!userText) return null;
  const t = userText.trim();
  const m = t.match(/(?:קוראים לי|שמי הוא|שמי|השם שלי הוא|השם שלי|אני נקרא(?:ת)?)\s+([א-ת]{2,}(?:\s[א-ת]{2,})?)/);
  if (m) return cleanName(m[1]);
  // Bare name reply right after the bot asked for it.
  if (prevAssistant && /שמ/.test(prevAssistant) && /^[א-ת]{2,}(?:\s[א-ת]{2,})?$/.test(t)) {
    return cleanName(t);
  }
  return null;
}

function parseJSON(content) {
  if (!content) return null;
  let text = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function formatHe(datetimeStr) {
  return new Date(datetimeStr).toLocaleString('he-IL', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

function hoursUntil(datetime) {
  return (new Date(datetime).getTime() - Date.now()) / 3600000;
}

// Fallback name extractor from what the customer actually typed (model can't reliably echo it).
async function extractCustomerName(messages) {
  const said = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
  try {
    const r = await groqChat({
      model: MODEL, max_tokens: 15,
      messages: [
        { role: 'system', content: 'להלן ההודעות שכתב לקוח. החזר אך ורק את שמו הפרטי כפי שמסר — מילה אחת, ללא סוגריים וללא טקסט נוסף. אם אין שם, החזר בדיוק: לקוח' },
        { role: 'user', content: said },
      ],
    });
    return cleanName(r.choices[0].message.content) || null;
  } catch { return null; }
}

async function reasonMessage(v, businessPhone, dateStr) {
  switch (v.reason) {
    case 'invalid_date': return 'לא הבנתי את התאריך. אפשר לנסות שוב? (למשל: "יום ראשון" או "3 באוגוסט")';
    case 'invalid_time': return 'לא הבנתי את השעה. אפשר לנסות שוב? (למשל: "10:00")';
    case 'past_date':
    case 'past_time': return 'אי אפשר לקבוע תור בזמן שכבר עבר. נסה תאריך או שעה עתידיים.';
    case 'too_far': return `אפשר לקבוע תור עד ${v.maxDays} ימים מראש בלבד.`;
    case 'closed_day': return 'העסק סגור ביום הזה. אשמח להציע לך יום אחר.';
    case 'blocked': return 'התאריך הזה חסום לקביעת תורים. אנא בחר תאריך אחר.';
    case 'outside_hours': return `השעה מחוץ לשעות הפעילות (${v.start}–${v.end}).`;
    case 'unaligned': return `התורים הם כל ${v.slot} דקות. נסה שעה עגולה יותר.`;
    case 'taken': {
      const slots = await getAvailableSlots(businessPhone, dateStr);
      return slots.length
        ? `השעה הזו כבר תפוסה 😕 שעות פנויות באותו יום: ${slots.join(', ')}`
        : 'השעה הזו כבר תפוסה, ואין עוד שעות פנויות באותו יום. נסה יום אחר.';
    }
    default: return 'לא הצלחתי לקבוע את התור. אפשר לנסות שוב?';
  }
}

// ---------- owner-side helpers ----------
const sameDayJS = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

function dayKeyOf(datetime) {
  const d = new Date(datetime);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function filterByScope(rows, when) {
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
  return rows.filter(a => {
    const d = new Date(a.datetime);
    if (when === 'today') return sameDayJS(d, now);
    if (when === 'tomorrow') return sameDayJS(d, tomorrow);
    if (when === 'week') return d >= today && d <= weekEnd;
    return true; // 'all'
  });
}

// Clean, WhatsApp-friendly list grouped by day (bold day headers, one appointment per line).
function formatGroupedByDay(rows) {
  const groups = new Map();
  for (const a of rows) {
    const d = new Date(a.datetime);
    const key = d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!groups.has(key)) groups.set(key, []);
    const time = d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    groups.get(key).push(`  • ${time} — ${a.customer_name || 'לקוח'} (${normalizePhone(a.customer_phone)})`);
  }
  return [...groups.entries()].map(([day, items]) => `*${day}*\n${items.join('\n')}`).join('\n\n');
}

// ---------- owner side ----------
async function handleOwnerMessage({ businessPhone, message, conv }) {
  const pool = require('../db/index');
  const bizPhone = normalizePhone(businessPhone);
  const business = await fetchBusiness(bizPhone);
  const settings = getSettings(business);

  const upcoming = (await pool.query(
    `SELECT id, customer_name, customer_phone, datetime FROM appointments
     WHERE business_phone = $1 AND status = 'confirmed' AND datetime >= NOW()
     ORDER BY datetime ASC LIMIT 60`,
    [bizPhone]
  )).rows;

  const numbered = upcoming.length
    ? upcoming.map((a, i) => `${i + 1}. ${formatHe(a.datetime)} | ${a.customer_name || 'לקוח'} | ${normalizePhone(a.customer_phone)}`).join('\n')
    : 'אין תורים קרובים';

  const systemPrompt = `אתה TorBot, עוזר לבעל העסק "${business?.name || ''}". דבר עברית, מקצועי וקצר.
החזר אך ורק JSON תקין במבנה:
{"reply":"<טקסט בעברית>","action":"none"|"list"|"block"|"unblock"|"cancel"|"set_hours","date":"YYYY-MM-DD או null","when":"today|tomorrow|week|all או null","name":"<שם הלקוח לביטול או null>","time":"HH:MM או null","appointment_number":<מספר מהרשימה או null>,"start":"HH:MM או null","end":"HH:MM או null"}

טבלת תאריכים (המר "מחר"/"יום חמישי" לתאריך מדויק לפי הטבלה בלבד, אל תחשב לבד):
${dateReferenceTable(14)}

שעות העבודה הרגילות: ${settings.start}–${settings.end}.

התורים הקרובים (ממוספרים):
${numbered}

חוקים:
- אתה עוזר לניהול תורים בלבד. אם ההודעה אינה קשורה לתורים/ניהול העסק (שאלה כללית, סתם שיחה, חשבון וכו') — action:"none", ו-reply קצר שמסביר שאתה עוזר לניהול תורים (לראות/לבטל/לחסום/שעות מיוחדות). אל תשתמש ב-"list" במקרה כזה.
- רק כשמבקשים במפורש לראות תורים ("איזה תורים יש לי", "מה התורים שלי") — action:"list". קבע when רק לפי מה שנאמר במפורש: "היום"→today, "מחר"→tomorrow, "השבוע"→week, יום/תאריך מסוים→date. בלי מסגרת זמן → when:"all".
- כשמבקש לבטל תור — action:"cancel" עם name (שם הלקוח שהוזכר, למשל "תבטל את דנה" → name:"דנה"). אם הוזכרה גם שעה, הוסף time.
- כשמבקש לחסום יום שלם — action:"block" עם date.
- כשמבקש לבטל חסימה של יום — action:"unblock" עם date.
- כשמבקש שעות מיוחדות ליום ספציפי (למשל "חמישי הזה עד 19:30") — action:"set_hours" עם date ו-end, ואם ציין שעת התחלה גם start.
- אל תמציא תורים או שעות שלא ברשימה.`;

  const messages = [{ role: 'system', content: systemPrompt }, ...conv.messages.slice(-MAX_HISTORY)];
  let parsed;
  try {
    const r = await groqChat({ model: MODEL, max_tokens: 400, response_format: { type: 'json_object' }, messages });
    parsed = parseJSON(r.choices[0].message.content);
  } catch (e) {
    return 'מצטער, יש תקלה זמנית. נסה שוב בעוד רגע.';
  }
  if (!parsed) return 'לא הצלחתי לעבד את הבקשה, אפשר לנסח מחדש?';

  // --- list (nicely formatted) ---
  if (parsed.action === 'list') {
    // Guard against the model narrowing a general request: only honor today/tomorrow/week
    // when the owner actually said so; otherwise show everything.
    let when = parsed.when;
    if (!parsed.date && !/היום|מחר|שבוע/.test(message || '')) when = 'all';
    const rows = parsed.date
      ? upcoming.filter(a => dayKeyOf(a.datetime) === parsed.date)
      : filterByScope(upcoming, when || 'all');
    const header = parsed.date ? `התורים ל־${parsed.date}:`
      : when === 'today' ? 'התורים להיום:'
        : when === 'tomorrow' ? 'התורים למחר:'
          : when === 'week' ? 'התורים לשבוע הקרוב:'
            : 'התורים הקרובים:';
    return rows.length ? `${header}\n\n${formatGroupedByDay(rows)}` : 'אין תורים בטווח שביקשת 🎉';
  }

  // --- cancel a specific appointment + notify the customer ---
  if (parsed.action === 'cancel') {
    const timeOf = (dt) => { const d = new Date(dt); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    let candidates;
    if (parsed.appointment_number) {
      const a = upcoming[parsed.appointment_number - 1];
      candidates = a ? [a] : [];
    } else if (parsed.name) {
      const nm = String(parsed.name).trim();
      candidates = upcoming.filter(a => (a.customer_name || '').includes(nm) || (nm && nm.includes(a.customer_name || '')));
    } else {
      candidates = [];
    }
    // If several match the same name, narrow by a time if the owner gave one.
    if (parsed.time && candidates.length > 1) {
      candidates = candidates.filter(a => timeOf(a.datetime) === parsed.time.padStart(5, '0'));
    }
    if (candidates.length === 0) {
      return parsed.name
        ? `לא מצאתי תור על השם "${parsed.name}". הנה התורים הקרובים:\n\n${formatGroupedByDay(upcoming)}`
        : `לא ברור איזה תור לבטל. הנה התורים:\n\n${formatGroupedByDay(upcoming)}`;
    }
    if (candidates.length > 1) {
      return `יש כמה תורים${parsed.name ? ` על השם "${parsed.name}"` : ''}. איזה לבטל? השב עם השעה:\n\n${formatGroupedByDay(candidates)}`;
    }
    const apt = candidates[0];
    await cancelAppointment(apt.id);
    const when = formatHe(apt.datetime);
    const custMsg = `שלום${apt.customer_name ? ' ' + apt.customer_name : ''}, התור שלך ל${when}${business && business.name ? ' ב־' + business.name : ''} בוטל על ידי העסק. לתיאום תור חדש שלח/י לנו הודעה כאן 🙏`;
    sendWhatsApp(apt.customer_phone, custMsg).catch(e => console.error('owner-cancel notify failed:', e.message));
    return `בוטל ✅ התור של ${apt.customer_name || 'הלקוח'} ל${when} בוטל, ונשלחה אליו הודעה בוואטסאפ.`;
  }

  // --- block a whole day ---
  if (parsed.action === 'block' && parsed.date) {
    const existing = await pool.query(
      `SELECT customer_name, customer_phone, datetime FROM appointments
       WHERE business_phone = $1 AND DATE(datetime) = $2 AND status = 'confirmed' ORDER BY datetime ASC`,
      [bizPhone, parsed.date]
    );
    await pool.query(
      `INSERT INTO blocked_dates (business_phone, date) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [bizPhone, parsed.date]
    );
    if (existing.rows.length) {
      return `התאריך ${parsed.date} נחסם ✅\nשים לב, יש תורים קיימים באותו יום:\n\n${formatGroupedByDay(existing.rows)}`;
    }
    return `התאריך ${parsed.date} נחסם בהצלחה ✅ לא יהיה ניתן לקבוע בו תורים.`;
  }

  // --- unblock a day ---
  if (parsed.action === 'unblock' && parsed.date) {
    await pool.query(`DELETE FROM blocked_dates WHERE business_phone = $1 AND date = $2`, [bizPhone, parsed.date]);
    return `החסימה על ${parsed.date} הוסרה ✅ שוב אפשר לקבוע תורים באותו יום.`;
  }

  // --- special hours for a specific date ---
  if (parsed.action === 'set_hours' && parsed.date && parsed.end) {
    const start = (parsed.start || settings.start).padStart(5, '0');
    const end = parsed.end.padStart(5, '0');
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
      return 'לא הבנתי את השעות. נסה שוב (למשל: "חמישי עד 19:30").';
    }
    await setDateOverride(bizPhone, parsed.date, start, end);
    return `עודכן ✅ ביום ${parsed.date} שעות מיוחדות: ${start}–${end}. אפשר לקבוע תורים לפי השעות האלה.`;
  }

  return parsed.reply || 'איך אפשר לעזור?';
}

// ---------- customer side ----------
async function handleCustomerMessage({ customerPhone, businessPhone, conv }) {
  const business = await fetchBusiness(businessPhone);
  const apts = await getCustomerAppointments(customerPhone, businessPhone);
  const aptsList = apts.length
    ? apts.map((a, i) => `${i + 1}. ${formatHe(a.datetime)}`).join('\n')
    : 'אין';

  // Returning customer? use their stored name.
  if (!conv.name && apts.length && apts[0].customer_name && cleanName(apts[0].customer_name)) {
    conv.name = cleanName(apts[0].customer_name);
  }
  // Resolve the name deterministically from what the customer just typed (before prompting the model).
  if (!conv.name) {
    const userMsgs = conv.messages.filter(m => m.role === 'user');
    const lastUser = userMsgs.length ? userMsgs[userMsgs.length - 1].content : '';
    const prevAssistant = [...conv.messages].reverse().find(m => m.role === 'assistant');
    const guess = localNameGuess(lastUser, prevAssistant && prevAssistant.content);
    if (guess) conv.name = guess;
  }

  const summary = await availabilitySummary(businessPhone, 6);

  const systemPrompt = `אתה TorBot, עוזר ידידותי לקביעת תורים לעסק "${business?.name || ''}". דבר עברית, חם וקצר.
החזר אך ורק JSON תקין במבנה:
{"reply":"<טקסט בעברית ללקוח>","action":"none"|"book"|"cancel"|"reschedule","date":"YYYY-MM-DD או null","time":"HH:MM או null","appointment_number":<מספר או null>,"new_date":"YYYY-MM-DD או null","new_time":"HH:MM או null","customer_name":"<שם הלקוח אם נמסר, אחרת null>"}

טבלת תאריכים (המר "מחר"/"יום ראשון" לתאריך מדויק לפי הטבלה בלבד, אל תחשב לבד):
${dateReferenceTable(14)}

שעות פנויות בימים הקרובים:
${summary}

${conv.name ? `שם הלקוח: ${conv.name}` : 'שם הלקוח עדיין לא ידוע.'}
התורים הקיימים של הלקוח (למספור בביטול/הזזה):
${aptsList}

חוקים:
- אם שם הלקוח לא ידוע, בקש אותו בנימוס והחזר action:"none". אל תקבע תור בלי שם.
- הצע רק שעות שמופיעות ברשימת השעות הפנויות. אל תמציא שעות.
- קבע (action:"book") רק אחרי שהלקוח אישר במפורש (כן/מאשר/👍). קודם הצג את הפרטים לאישור עם action:"none".
- לביטול תור: action:"cancel" עם appointment_number מהרשימה.
- להזזת תור: action:"reschedule" עם appointment_number, new_date, new_time.
- אל תחשוף מזהים פנימיים או פרטים טכניים.`;

  const messages = [{ role: 'system', content: systemPrompt }, ...conv.messages.slice(-MAX_HISTORY)];
  let parsed;
  try {
    const r = await groqChat({
      model: MODEL, max_tokens: 500, response_format: { type: 'json_object' }, messages,
    });
    parsed = parseJSON(r.choices[0].message.content);
  } catch (e) {
    return 'מצטער, יש תקלה זמנית. נסה שוב בעוד רגע 🙏';
  }
  if (!parsed) return 'לא בטוח שהבנתי 😅 אפשר לנסח שוב?';

  const maybeName = cleanName(parsed.customer_name);
  if (maybeName) conv.name = maybeName;

  // --- book ---
  if (parsed.action === 'book' && parsed.date && parsed.time) {
    const v = await validateSlot(businessPhone, parsed.date, parsed.time);
    if (!v.ok) return await reasonMessage(v, businessPhone, parsed.date);
    const name = conv.name || (await extractCustomerName(conv.messages)) || 'לקוח';
    conv.name = name;
    try {
      await bookAppointment({ customerPhone, businessPhone, customerName: name, datetime: v.datetime });
    } catch (e) {
      if (String(e.message || '').includes('uniq_confirmed_slot') || String(e.code) === '23505') {
        return await reasonMessage({ reason: 'taken' }, businessPhone, parsed.date);
      }
      throw e;
    }
    return `מעולה${name !== 'לקוח' ? ' ' + name : ''}! קבעתי לך תור ל־${formatHe(v.datetime)} ✅ נתראה!`;
  }

  // --- cancel ---
  if (parsed.action === 'cancel' && parsed.appointment_number) {
    const apt = apts[parsed.appointment_number - 1];
    if (!apt) return apts.length ? `לא מצאתי את התור. התורים שלך:\n${aptsList}` : 'אין לך תורים קיימים לביטול.';
    if (hoursUntil(apt.datetime) < 24) return 'ביטול אפשרי רק עד 24 שעות לפני התור. לביטול דחוף פנה ישירות לעסק.';
    await cancelAppointment(apt.id);
    return `התור ל־${formatHe(apt.datetime)} בוטל בהצלחה ✅`;
  }

  // --- reschedule ---
  if (parsed.action === 'reschedule' && parsed.appointment_number && parsed.new_date && parsed.new_time) {
    const apt = apts[parsed.appointment_number - 1];
    if (!apt) return apts.length ? `לא מצאתי את התור. התורים שלך:\n${aptsList}` : 'אין לך תורים קיימים להזזה.';
    if (hoursUntil(apt.datetime) < 24) return 'הזזה אפשרית רק עד 24 שעות לפני התור. לשינוי דחוף פנה ישירות לעסק.';
    const v = await validateSlot(businessPhone, parsed.new_date, parsed.new_time);
    if (!v.ok) return await reasonMessage(v, businessPhone, parsed.new_date);
    try {
      await rescheduleAppointment(apt.id, v.datetime);
    } catch (e) {
      if (String(e.message || '').includes('uniq_confirmed_slot') || String(e.code) === '23505') {
        return await reasonMessage({ reason: 'taken' }, businessPhone, parsed.new_date);
      }
      throw e;
    }
    return `התור הוזז בהצלחה ל־${formatHe(v.datetime)} ✅`;
  }

  return parsed.reply || 'איך אפשר לעזור? 😊';
}

// ---------- entry point ----------
async function handleIncomingMessage({ customerPhone, businessPhone, message }) {
  const key = `${customerPhone}-${businessPhone}`;
  const conv = getConversation(key);
  conv.messages.push({ role: 'user', content: message });

  const pool = require('../db/index');
  // The sender is the owner if their WhatsApp number matches the business's owner_phone
  // (or the business's own login phone, for non-sandbox setups).
  const bizRow = (await pool.query(
    `SELECT phone, owner_phone FROM businesses WHERE phone = $1`, [normalizePhone(businessPhone)]
  )).rows[0];
  const from = normalizePhone(customerPhone);
  const isOwner = !!bizRow && (from === normalizePhone(bizRow.owner_phone) || from === normalizePhone(bizRow.phone));

  let reply;
  try {
    reply = isOwner
      ? await handleOwnerMessage({ businessPhone, message, conv })
      : await handleCustomerMessage({ customerPhone, businessPhone, conv });
  } catch (e) {
    console.error('handleIncomingMessage error:', e);
    reply = 'אירעה שגיאה זמנית. אפשר לנסות שוב בעוד רגע 🙏';
  }

  conv.messages.push({ role: 'assistant', content: reply });
  if (conv.messages.length > MAX_HISTORY * 2) conv.messages = conv.messages.slice(-MAX_HISTORY * 2);
  return reply;
}

module.exports = { handleIncomingMessage, resetConversation };
