/**
 * Чистит даты в листе 送货 Логистика:
 * заменяет запятые на точки в текстовых датах типа "10,04,2023" → "10.04.2023"
 * Затрагивает только текстовые ячейки с датами (числа-серийники не трогает).
 */
require('dotenv').config();
const { sheets: sheetsAPI } = require('@googleapis/sheets');
const { GoogleAuth } = require('google-auth-library');
const path = require('path');

const SPREADSHEET_ID = process.env.LOGISTICS_SPREADSHEET_ID;
const SHEET_NAME     = process.env.LOGISTICS_CARGO_SHEET || '送货 Логистика';
const KEY_FILE       = process.env.GOOGLE_KEY_FILE || './credentials/service-account.json';

// Индексы колонок с датами (0-based)
const DATE_COLS = [
  { idx: 0,  letter: 'A', name: 'Дата отправки' },
  { idx: 18, letter: 'S', name: 'Дата прибытия' },
];

function fixDate(val) {
  if (typeof val !== 'string') return null; // числа не трогаем
  const fixed = val.trim().replace(/,/g, '.');
  return fixed !== val.trim() ? fixed : null; // null = не изменилось
}

async function main() {
  if (!SPREADSHEET_ID) throw new Error('LOGISTICS_SPREADSHEET_ID не задан в .env');

  const auth   = new GoogleAuth({ keyFile: path.resolve(KEY_FILE), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = sheetsAPI({ version: 'v4', auth });

  // Читаем весь лист (только нужные колонки) — UNFORMATTED чтобы видеть текст vs число
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A:S`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values || [];
  console.log(`Всего строк: ${rows.length}`);

  const updates = []; // { range, value }

  for (let i = 1; i < rows.length; i++) { // с 1, пропускаем шапку
    const row = rows[i];
    for (const col of DATE_COLS) {
      const raw   = row[col.idx];
      const fixed = fixDate(raw);
      if (fixed !== null) {
        updates.push({ range: `'${SHEET_NAME}'!${col.letter}${i + 1}`, value: fixed });
      }
    }
  }

  if (updates.length === 0) {
    console.log('Запятых в датах не найдено. Всё чисто.');
    return;
  }

  console.log(`Найдено ячеек с запятыми: ${updates.length}`);
  updates.forEach(u => console.log(`  ${u.range}: "${u.value}"`));

  // Пишем исправления батчами по 500
  const CHUNK = 500;
  for (let start = 0; start < updates.length; start += CHUNK) {
    const batch = updates.slice(start, start + CHUNK);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: batch.map(u => ({ range: u.range, values: [[u.value]] })),
      },
    });
    console.log(`Исправлено: ${Math.min(start + CHUNK, updates.length)}/${updates.length}`);
  }

  console.log('✅ Готово!');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
