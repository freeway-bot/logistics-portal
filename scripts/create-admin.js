/**
 * scripts/create-admin.js
 *
 * Создаёт первого администратора в листе Users таблицы Логистика.
 * Также умеет создавать сотрудника или клиента.
 *
 * Использование:
 *   node scripts/create-admin.js
 *   node scripts/create-admin.js --role employee
 *   node scripts/create-admin.js --role client --client-id WAY027
 *
 * Потребуются переменные в .env:
 *   LOGISTICS_SPREADSHEET_ID или SPREADSHEET_ID
 *   GOOGLE_SERVICE_ACCOUNT_JSON или GOOGLE_KEY_FILE
 */

require('dotenv').config();
const { google } = require('googleapis');
const bcrypt     = require('bcrypt');
const readline   = require('readline');

const LOGISTICS_ID   = process.env.LOGISTICS_SPREADSHEET_ID || process.env.SPREADSHEET_ID;
const USERS_SHEET    = process.env.USERS_SHEET_NAME || 'Users';
const USERS_HEADERS  = ['username', 'client_id', 'password_hash', 'role', 'full_name', 'email', 'phone', 'lang', 'active', 'created_at', 'last_login'];

const SCOPES_RW = ['https://www.googleapis.com/auth/spreadsheets'];

const args     = process.argv.slice(2);
const roleIdx  = args.indexOf('--role');
const cidIdx   = args.indexOf('--client-id');
const argRole  = roleIdx  !== -1 ? args[roleIdx + 1]  : 'admin';
const argCid   = cidIdx   !== -1 ? args[cidIdx + 1]   : '';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

async function getAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: SCOPES_RW,
    });
  }
  return new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_KEY_FILE || './credentials/service-account.json',
    scopes: SCOPES_RW,
  });
}

async function ensureUsersSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: LOGISTICS_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === USERS_SHEET);

  if (!exists) {
    console.log(`\n  Создаю лист "${USERS_SHEET}"…`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: LOGISTICS_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: USERS_SHEET } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: LOGISTICS_ID,
      range: `${USERS_SHEET}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [USERS_HEADERS] },
    });
    console.log(`  Лист "${USERS_SHEET}" создан с заголовками.\n`);
  } else {
    console.log(`  Лист "${USERS_SHEET}" уже существует.\n`);
  }
}

async function userExists(sheets, username) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: LOGISTICS_ID,
    range: `${USERS_SHEET}!A:A`,
  });
  const values = (res.data.values || []).flat().map(v => v.toLowerCase());
  return values.includes(username.toLowerCase());
}

async function main() {
  if (!LOGISTICS_ID) {
    console.error('\n  Ошибка: LOGISTICS_SPREADSHEET_ID не задан в .env\n');
    process.exit(1);
  }

  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║   Logistics Portal — Создание    ║');
  console.log('  ║   пользователя в Google Sheets   ║');
  console.log('  ╚══════════════════════════════════╝\n');
  console.log(`  Роль: ${argRole}`);
  console.log(`  Таблица: ${LOGISTICS_ID}\n`);

  const username = (await ask('  Логин (например, admin или WAY027): ')).trim();
  if (!username) { console.error('  Логин не может быть пустым'); process.exit(1); }

  const password = (await ask('  Пароль (мин. 6 символов): ')).trim();
  if (password.length < 6) { console.error('  Пароль слишком короткий'); process.exit(1); }

  const fullName = (await ask('  Имя / ФИО (можно пропустить): ')).trim();
  const email    = (await ask('  Email (можно пропустить): ')).trim();

  let clientId = argCid;
  if (argRole === 'client' && !clientId) {
    clientId = (await ask('  Client ID клиента (например, WAY027): ')).trim();
  }

  const lang = (await ask('  Язык [ru/zh] (по умолчанию ru): ')).trim() || 'ru';

  rl.close();

  console.log('\n  Хэшируем пароль…');
  const hash = await bcrypt.hash(password, 10);

  console.log('  Подключаемся к Google Sheets…');
  const auth   = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await ensureUsersSheet(sheets);

  if (await userExists(sheets, username)) {
    console.error(`  Пользователь "${username}" уже существует. Удалите его из листа и повторите.`);
    process.exit(1);
  }

  const now = new Date().toISOString();
  const row = [
    username,
    clientId || '',
    hash,
    argRole,
    fullName,
    email,
    '',
    lang,
    'true',
    now,
    '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: LOGISTICS_ID,
    range: `${USERS_SHEET}!A:K`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });

  console.log(`\n  ✓ Пользователь создан!`);
  console.log(`    Логин:  ${username}`);
  console.log(`    Роль:   ${argRole}`);
  if (clientId) console.log(`    Client ID: ${clientId}`);
  console.log(`\n  Войдите на портал: /\n`);
}

main().catch(err => {
  console.error('\n  Ошибка:', err.message);
  process.exit(1);
});
