require('dotenv').config();

// ---- Local mode: PGlite (a real Postgres running inside Node, stored on disk) ----
// Enable by setting USE_LOCAL_DB=true in .env  (great for local dev/testing).
if (process.env.USE_LOCAL_DB === 'true') {
  const fs = require('fs');
  const path = require('path');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

  let dbPromise;
  async function getDb() {
    if (!dbPromise) {
      dbPromise = (async () => {
        const { PGlite } = await import('@electric-sql/pglite');
        // PGLITE_MEMORY=true → fresh in-memory DB (used by the test suite so it never
        // touches the on-disk dev data).
        const db = process.env.PGLITE_MEMORY === 'true'
          ? new PGlite()
          : new PGlite(path.join(__dirname, 'local-data'));
        await db.exec(schema); // idempotent: CREATE TABLE IF NOT EXISTS ...
        if (process.env.PGLITE_MEMORY !== 'true') console.log('Using local PGlite database (db/local-data)');
        return db;
      })();
    }
    return dbPromise;
  }

  module.exports = {
    query: async (text, params) => {
      const db = await getDb();
      return db.query(text, params);
    },
  };

// ---- Cloud mode: regular Postgres via connection string (Neon/Railway/etc.) ----
} else {
  const fs = require('fs');
  const path = require('path');
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  // Apply the schema on startup (idempotent) so a fresh cloud database gets its tables.
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  pool.query(schema)
    .then(() => console.log('Cloud database schema ensured'))
    .catch(e => console.error('Schema init failed:', e.message));
  module.exports = pool;
}
