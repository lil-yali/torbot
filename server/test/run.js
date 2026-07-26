// Minimal test runner (no external deps). Uses an in-memory PGlite DB so it never
// touches the on-disk dev data.  Run:  npm test
process.env.USE_LOCAL_DB = 'true';
process.env.PGLITE_MEMORY = 'true';
process.env.TZ = 'Asia/Jerusalem';

let pass = 0, fail = 0;
global.check = (name, cond) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
};
global.eq = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  global.check(ok ? name : `${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`, ok);
};

(async () => {
  console.log('\navailability (pure logic):');
  await require('./availability.test.js')();
  console.log('\nbooking & validation (in-memory DB):');
  await require('./booking.test.js')();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
