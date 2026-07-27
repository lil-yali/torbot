-- WhatsApp Booking — database schema
-- Reconstructed from application code, extended for reliability features.

CREATE TABLE IF NOT EXISTS businesses (
  phone           TEXT PRIMARY KEY,
  name            TEXT,
  password        TEXT,
  working_hours   JSONB,
  slot_duration   INTEGER DEFAULT 30,
  max_days_ahead  INTEGER DEFAULT 30,
  owner_phone     TEXT,
  whatsapp_number TEXT
);

-- Migrations for pre-existing databases (idempotent).
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS owner_phone       TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS whatsapp_number   TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN DEFAULT FALSE;

-- Bot conversation state, so it survives restarts / works across instances.
CREATE TABLE IF NOT EXISTS conversations (
  key        TEXT PRIMARY KEY,
  data       JSONB,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  phone TEXT PRIMARY KEY,
  name  TEXT
);

CREATE TABLE IF NOT EXISTS appointments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_phone TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_name  TEXT,
  datetime       TIMESTAMP NOT NULL,
  status         TEXT DEFAULT 'confirmed',
  reminded       BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMP DEFAULT NOW()
);

-- Migrations for pre-existing databases (idempotent).
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminded   BOOLEAN   DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

CREATE TABLE IF NOT EXISTS blocked_dates (
  business_phone TEXT NOT NULL,
  date           DATE NOT NULL,
  UNIQUE (business_phone, date)
);

-- Special working hours for a specific date (overrides the business's normal hours,
-- and opens the day even if it's normally closed). E.g. "this Thursday until 19:30".
CREATE TABLE IF NOT EXISTS date_overrides (
  business_phone TEXT NOT NULL,
  date           DATE NOT NULL,
  start_time     TEXT NOT NULL,
  end_time       TEXT NOT NULL,
  UNIQUE (business_phone, date)
);

CREATE INDEX IF NOT EXISTS idx_appointments_business ON appointments (business_phone, datetime);
CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments (customer_phone, business_phone);

-- Hard guarantee against double-booking: at most one CONFIRMED appointment
-- per business at a given datetime, enforced by the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_confirmed_slot
  ON appointments (business_phone, datetime)
  WHERE status = 'confirmed';
