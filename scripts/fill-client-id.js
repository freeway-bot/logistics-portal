// scripts/fill-client-id.js
// One-time migration: adds "ID клиента" column to "送货 Логистика" sheet
// and fills it by extracting the first segment of the cargo number.
//
// Usage:  node scripts/fill-client-id.js
//         node scripts/fill-client-id.js --dry-run   (preview only)

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.LOGISTICS_SPREADSHEET_ID;
const SHEET_NAME     = '送货 Логистика';
const NEW_HEADER     = 'ID клиента';
const DRY_RUN        = process.argv.includes('--dry-run');

if (!SPREADSHEET_ID) {
  console.error('LOGISTICS_SPREADSHEET_ID not set in .env');
  process.exit(1);
}

async function getAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_KEY_FILE || './credentials/service-account.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function toLetterCol(n) {
  let s = ''; n++;
  while (n > 0) { s = String.fromCharCode(64 + (n % 26 || 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function run() {
  console.log(`\n${DRY_RUN ? '[DRY-RUN] ' : ''}Adding "${NEW_HEADER}" to "${SHEET_NAME}"...\n`);

  const auth   = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Read all rows
  const res  = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:Z`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) { console.error('Sheet is empty.'); process.exit(1); }

  const headers = rows[0].map(h => (h || '').toString().trim());
  console.log(`Found ${headers.length} columns: ${headers.join(', ')}\n`);

  // Find the cargo number column
  const cargoColIdx = headers.findIndex(h =>
    h.includes('货物编号') || /номер.?груза/i.test(h)
  );
  if (cargoColIdx === -1) {
    console.error('Cannot find cargo number column (货物编号 / Номер груза).');
    process.exit(1);
  }
  console.log(`Cargo number column: "${headers[cargoColIdx]}" → ${toLetterCol(cargoColIdx)}`);

  // Check if ID клиента column already exists
  const existIdx = headers.findIndex(h =>
    h === NEW_HEADER || h.toLowerCase() === 'id клиента' || h.toLowerCase() === 'id_клиента'
  );

  const targetColIdx = existIdx !== -1 ? existIdx : headers.length;
  if (existIdx !== -1) {
    console.log(`Column "${NEW_HEADER}" already exists at ${toLetterCol(targetColIdx)} — will overwrite values.\n`);
  } else {
    console.log(`Appending new column "${NEW_HEADER}" at ${toLetterCol(targetColIdx)}\n`);
  }

  // Build batch update
  const batchData = [];

  if (existIdx === -1) {
    batchData.push({
      range: `${SHEET_NAME}!${toLetterCol(targetColIdx)}1`,
      values: [[NEW_HEADER]],
    });
  }

  let filled = 0;
  for (let i = 1; i < rows.length; i++) {
    const row      = rows[i];
    const cargoNum = (row[cargoColIdx] || '').toString().trim();
    if (!cargoNum) continue;

    // Extract client ID = first segment before '-'
    const clientId = cargoNum.split('-')[0].trim();
    if (!clientId) continue;

    batchData.push({
      range: `${SHEET_NAME}!${toLetterCol(targetColIdx)}${i + 1}`,
      values: [[clientId]],
    });
    filled++;
    if (filled <= 5 || i === rows.length - 1) {
      console.log(`  Row ${i + 1}: "${cargoNum}" → "${clientId}"`);
    } else if (filled === 6) {
      console.log('  ...');
    }
  }

  console.log(`\nTotal: ${filled} rows will be filled.\n`);

  if (DRY_RUN) {
    console.log('[DRY-RUN] No changes written. Re-run without --dry-run to apply.');
    return;
  }

  if (batchData.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: batchData,
    },
  });

  console.log(`Done! Column "${NEW_HEADER}" added/updated with ${filled} values.`);
}

run().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
