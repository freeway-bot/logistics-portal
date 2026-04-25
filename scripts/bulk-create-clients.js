// scripts/bulk-create-clients.js
// Creates user accounts for all unique client IDs in 送货 Логистика
// that don't already have an account in the Users sheet.
// Passwords are written to the "Пароли" sheet.
//
// Usage:  node scripts/bulk-create-clients.js
//         node scripts/bulk-create-clients.js --dry-run

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { google } = require('googleapis');
const bcrypt     = require('bcrypt');
const crypto     = require('crypto');
const path       = require('path');

const LOGISTICS_ID   = process.env.LOGISTICS_SPREADSHEET_ID;
const CARGO_SHEET    = '送货 Логистика';
const USERS_SHEET    = process.env.USERS_SHEET_NAME     || 'Users';
const PASSWORDS_SHEET = process.env.PASSWORDS_SHEET_NAME || 'Пароли';
const DRY_RUN        = process.argv.includes('--dry-run');
const BCRYPT_ROUNDS  = 10;

// IDs that look like data errors — skip them
const SKIP_IDS = new Set(['дубль', 'dao', '', 'fwc', '890', 'h890']);

if (!LOGISTICS_ID) { console.error('LOGISTICS_SPREADSHEET_ID not set'); process.exit(1); }

async function getAuth(write = false) {
  const scopes = write
    ? ['https://www.googleapis.com/auth/spreadsheets']
    : ['https://www.googleapis.com/auth/spreadsheets.readonly'];
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), scopes });
  }
  return new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_KEY_FILE || './credentials/service-account.json', scopes });
}

function genPassword() { return crypto.randomBytes(4).toString('hex'); }

async function run() {
  console.log(`\n${DRY_RUN ? '[DRY-RUN] ' : ''}Bulk-creating client accounts from ${CARGO_SHEET}...\n`);

  const authRO = await getAuth(false);
  const sheets = google.sheets({ version: 'v4', authRO });
  const s      = google.sheets({ version: 'v4', auth: authRO });

  // 1. Get unique client IDs from Логистика
  console.log('Reading cargo sheet...');
  const cargoRes = await s.spreadsheets.values.get({
    spreadsheetId: LOGISTICS_ID,
    range: `${CARGO_SHEET}!A:Z`,
  });
  const cargoRows = cargoRes.data.values || [];
  const cargoHdrs = cargoRows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
  const cidCol    = cargoHdrs.findIndex(h => h === 'id_клиента' || h.includes('id_клиента'));
  if (cidCol === -1) { console.error('Column "ID клиента" not found. Run fill-client-id.js first.'); process.exit(1); }

  const allIds = new Set();
  cargoRows.slice(1).forEach(r => {
    const v = (r[cidCol] || '').toString().trim();
    if (v && !SKIP_IDS.has(v.toLowerCase())) allIds.add(v);
  });
  console.log(`Unique client IDs: ${allIds.size}`);

  // 2. Get existing users
  console.log('Reading Users sheet...');
  const usersRes = await s.spreadsheets.values.get({
    spreadsheetId: LOGISTICS_ID,
    range: `${USERS_SHEET}!A:K`,
  });
  const usersRows = usersRes.data.values || [];
  const existSet  = new Set(
    usersRows.slice(1).map(r => (r[1] || r[0] || '').toString().trim().toLowerCase())
  );
  console.log(`Existing accounts: ${existSet.size}`);

  // 3. Determine which to create
  const toCreate = [...allIds].filter(id => !existSet.has(id.toLowerCase()));
  console.log(`Accounts to create: ${toCreate.length}\n`);

  if (toCreate.length === 0) {
    console.log('All clients already have accounts. Nothing to do.');
    return;
  }

  // 4. Generate passwords and hashes
  console.log('Generating passwords (bcrypt may take a moment)...');
  const entries = [];
  for (let i = 0; i < toCreate.length; i++) {
    const clientId = toCreate[i];
    const password = genPassword();
    const hash     = DRY_RUN ? 'DRYRUN' : await bcrypt.hash(password, BCRYPT_ROUNDS);
    entries.push({ clientId, password, hash });
    if ((i + 1) % 50 === 0 || i === toCreate.length - 1) {
      process.stdout.write(`\r  Hashed ${i + 1}/${toCreate.length}...`);
    }
  }
  console.log('\n');

  if (DRY_RUN) {
    console.log('Sample entries (first 5):');
    entries.slice(0, 5).forEach(e => console.log(`  ${e.clientId} → ${e.password}`));
    console.log('\n[DRY-RUN] No changes written.');
    return;
  }

  // 5. Batch-append to Users sheet
  console.log('Writing to Users sheet...');
  const now      = new Date().toISOString();
  const userRows = entries.map(e => [
    e.clientId,   // username
    e.clientId,   // client_id
    e.hash,       // password_hash
    'client',     // role
    '',           // full_name
    '',           // email
    '',           // phone
    'ru',         // lang
    'true',       // active
    now,          // created_at
    '',           // last_login
  ]);

  const authRW = await getAuth(true);
  const sw     = google.sheets({ version: 'v4', auth: authRW });

  // Write in chunks of 100 to avoid API limits
  const CHUNK = 100;
  for (let i = 0; i < userRows.length; i += CHUNK) {
    const chunk = userRows.slice(i, i + CHUNK);
    await sw.spreadsheets.values.append({
      spreadsheetId: LOGISTICS_ID,
      range: `${USERS_SHEET}!A:K`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: chunk },
    });
    process.stdout.write(`\r  Users: ${Math.min(i + CHUNK, userRows.length)}/${userRows.length}`);
  }
  console.log('\n');

  // 6. Batch-append to Пароли sheet
  console.log('Writing to Пароли sheet...');
  const date     = new Date().toLocaleDateString('ru-RU');
  const pwRows   = entries.map(e => [e.clientId, e.password, 'Клиент', date, 'bulk-create']);

  for (let i = 0; i < pwRows.length; i += CHUNK) {
    const chunk = pwRows.slice(i, i + CHUNK);
    await sw.spreadsheets.values.append({
      spreadsheetId: LOGISTICS_ID,
      range: `${PASSWORDS_SHEET}!A:E`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: chunk },
    });
    process.stdout.write(`\r  Пароли: ${Math.min(i + CHUNK, pwRows.length)}/${pwRows.length}`);
  }
  console.log('\n');

  console.log(`\nDone! Created ${entries.length} accounts.`);
  console.log('Passwords are saved in the "Пароли" sheet.');
  console.log('\nSample credentials (first 5):');
  entries.slice(0, 5).forEach(e => console.log(`  ID: ${e.clientId.padEnd(14)} | Password: ${e.password}`));
}

run().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
