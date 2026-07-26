# TorBot — WhatsApp Appointment Booking

A "Calendly over WhatsApp" for small businesses. Customers book, cancel, and reschedule
appointments by chatting in natural Hebrew with a WhatsApp bot. Business owners manage
everything from a web dashboard and can query/​block dates straight from WhatsApp too.

## How it works

```
Customer (WhatsApp) ──▶ Twilio ──▶ /webhook ──▶ AI brain (Groq) ──▶ Postgres
                                                      │
Business owner (web) ──▶ React dashboard ──▶ REST API ┘
```

- **Server** (`server/`, Node + Express, port 3000) — REST API, the Twilio webhook, and the bot logic.
- **Client** (`client/`, React, port 3001) — the business dashboard (login, settings, calendar).
- **AI brain** — Groq (`llama-3.3-70b`) turns each message into a structured intent; **all booking
  rules (working hours, availability, blocked dates, look-ahead window, double-booking) are enforced
  in code**, not left to the model.
- **Database** — Postgres. For local development it runs entirely on-disk via **PGlite** (no install).

## Quick start

### 1. Configure

```bash
cd server
cp .env.example .env      # then fill in GROQ_API_KEY (and Twilio keys if using real WhatsApp)
```

`USE_LOCAL_DB=true` (the default) uses a local on-disk database — nothing else to install.

### 2. Run the server

```bash
cd server
npm install
npm start
```

Server: http://localhost:3000

### 3. Run the dashboard

```bash
cd client
npm install
npm start        # opens http://localhost:3001
```

> The client must run on **3001** because the server uses 3000. On Windows: `set PORT=3001&& npm start`,
> or use the provided `npm start` (already configured).

### 4. Seed demo data (optional)

```bash
cd server
npm run seed     # creates a demo business + sample appointments (server must be stopped first)
```

Demo login: phone `+972500000001`, password `1234`.

## Try the bot without WhatsApp

Open **http://localhost:3000/chat** — a WhatsApp-style tester that talks to the real AI brain.
Switch between "customer" and "business owner" roles. No Twilio needed.

## Connecting real WhatsApp (Twilio)

1. Fill `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` in `.env`.
2. Expose the server publicly (e.g. `ngrok http 3000`).
3. In the Twilio WhatsApp sandbox, set the inbound webhook to `https://<your-tunnel>/webhook`.
4. Join the sandbox from your phone and start chatting.

## Project layout

```
server/
  index.js              # Express app, REST API, static chat tester
  routes/webhook.js     # Twilio inbound webhook
  services/
    ai.js               # conversation → structured intent → validated action
    availability.js     # deterministic slots, working hours, validation
    calender.js         # appointment DB operations
    twilio.js           # WhatsApp send helper
    reminders.js        # 24h reminder scheduler
  db/
    index.js            # DB connection (PGlite local / Postgres cloud)
    schema.sql          # table definitions
  utils/phone.js        # phone normalization
  scripts/seed.js       # demo data
  test/                 # automated tests
client/                 # React dashboard
```

## Notes

- **PGlite is single-process.** Don't run separate DB scripts while the server is running — stop the
  server first. In normal use only the server touches the database, so this isn't an issue.
- For cloud deployment, use a real Postgres (Neon has a genuinely free tier) and set `USE_LOCAL_DB=false`
  with a `DATABASE_URL`.
