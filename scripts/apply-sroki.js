/**
 * Настраивает колонку R "Сроки" в листе 送货 Логистика:
 *   • вставляет живые формулы через batchUpdate/formulaValue
 *     (locale-independent: всегда comma-синтаксис, не зависит от языка таблицы)
 *   • применяет условное форматирование по цветам
 * Запуск: node scripts/apply-sroki.js  (из корня проекта)
 */
require('dotenv').config();
const { sheets: sheetsAPI } = require('@googleapis/sheets');
const { GoogleAuth } = require('google-auth-library');
const path = require('path');

const SPREADSHEET_ID = process.env.LOGISTICS_SPREADSHEET_ID;
const SHEET_NAME     = process.env.LOGISTICS_CARGO_SHEET || '送货 Логистика';
const KEY_FILE       = process.env.GOOGLE_KEY_FILE || './credentials/service-account.json';

const SROKI_COL   = 17; // R (0-based) — Сроки
const SEND_COL    = 0;  // A — Дата отправки
const ARRIVAL_COL = 18; // S — Дата прибытия

function colLetter(idx) {
  let s = '', n = idx;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

// Русская локаль Google Sheets требует ";" как разделитель аргументов.
// A-колонка хранит серийные числа (date serial), S-колонка — текст "DD.MM.YYYY".
function toDate(cell) {
  // IF(ISNUMBER → серийное число, иначе DATEVALUE парсит "DD.MM.YYYY")
  return `IF(ISNUMBER(${cell});${cell};DATEVALUE(${cell}))`;
}

function buildFormula(rowNum) {
  const a = `A${rowNum}`;
  const s = `S${rowNum}`;
  return `=IF(${a}="";"";IF(${s}<>"";${toDate(s)}-${toDate(a)};TODAY()-${toDate(a)}))`;
}

async function main() {
  if (!SPREADSHEET_ID) throw new Error('LOGISTICS_SPREADSHEET_ID не задан в .env');

  const auth   = new GoogleAuth({ keyFile: path.resolve(KEY_FILE), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = sheetsAPI({ version: 'v4', auth });

  // 1. Метаданные листа
  const meta      = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheetInfo = meta.data.sheets.find(s => s.properties.title === SHEET_NAME);
  if (!sheetInfo) throw new Error(`Лист "${SHEET_NAME}" не найден`);
  const sheetId = sheetInfo.properties.sheetId;
  console.log(`Лист: "${SHEET_NAME}" (sheetId=${sheetId})`);

  // 2. Считаем строки (по колонке A)
  const colARes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A:A`,
  });
  const lastRow  = (colARes.data.values || []).length; // 1-based, включая шапку
  const dataRows = lastRow - 1;
  console.log(`Строк с данными: ${dataRows}`);
  if (dataRows < 1) { console.log('Нет данных.'); return; }

  // 3. Записать формулы через batchUpdate / formulaValue
  //    (locale-independent: comma-синтаксис работает независимо от языка таблицы)
  const CHUNK = 500;
  let written  = 0;

  for (let start = 0; start < dataRows; start += CHUNK) {
    const end   = Math.min(start + CHUNK, dataRows);
    const rows  = [];
    for (let i = start; i < end; i++) {
      rows.push({ values: [{ userEnteredValue: { formulaValue: buildFormula(i + 2) } }] });
    }
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          updateCells: {
            range: {
              sheetId,
              startRowIndex:    start + 1,   // 0-based: строка 2 = index 1
              endRowIndex:      end   + 1,
              startColumnIndex: SROKI_COL,
              endColumnIndex:   SROKI_COL + 1,
            },
            rows,
            fields: 'userEnteredValue',
          },
        }],
      },
    });
    written += (end - start);
    console.log(`  Записано формул: ${written}/${dataRows}`);
  }
  console.log(`✅ Формулы вставлены в ${colLetter(SROKI_COL)}2:${colLetter(SROKI_COL)}${lastRow}`);

  // 4. Удалить старые правила форматирования для колонки R
  const existingRules = sheetInfo.conditionalFormats || [];
  const toDelete = [];
  for (let i = existingRules.length - 1; i >= 0; i--) {
    const ranges = existingRules[i].ranges || [];
    if (ranges.some(r => r.startColumnIndex === SROKI_COL && r.endColumnIndex === SROKI_COL + 1)) {
      toDelete.push({ deleteConditionalFormatRule: { sheetId, index: i } });
    }
  }
  if (toDelete.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: toDelete } });
    console.log(`Удалено старых правил форматирования: ${toDelete.length}`);
  }

  // 5. Цветовые правила (index 0 = наивысший приоритет)
  const cfRange = {
    sheetId,
    startRowIndex: 1, endRowIndex: 5000,
    startColumnIndex: SROKI_COL, endColumnIndex: SROKI_COL + 1,
  };
  const colorRules = [
    { gt: 45, bg: { red: 0.718, green: 0.110, blue: 0.110 }, fg: { red: 1, green: 1, blue: 1 }, bold: true  },
    { gt: 35, bg: { red: 0.957, green: 0.263, blue: 0.212 }, fg: { red: 1, green: 1, blue: 1 }, bold: true  },
    { gt: 25, bg: { red: 1.000, green: 0.922, blue: 0.231 }, fg: { red: 0, green: 0, blue: 0 }, bold: false },
    { gt: 20, bg: { red: 0.412, green: 0.941, blue: 0.682 }, fg: { red: 0, green: 0, blue: 0 }, bold: false },
  ];
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: colorRules.map((r, i) => ({
        addConditionalFormatRule: {
          index: i,
          rule: {
            ranges: [cfRange],
            booleanRule: {
              condition: { type: 'NUMBER_GREATER', values: [{ userEnteredValue: String(r.gt) }] },
              format: { backgroundColor: r.bg, textFormat: { foregroundColor: r.fg, bold: r.bold } },
            },
          },
        },
      })),
    },
  });
  console.log('✅ Форматирование: >20 зел, >25 жёл, >35 красн, >45 тёмнокрасн');

  // 6. Задать числовой формат для колонки R (иначе результат показывается как дата)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId, startRowIndex: 1, endRowIndex: 5000, startColumnIndex: SROKI_COL, endColumnIndex: SROKI_COL + 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      }],
    },
  });
  console.log('✅ Числовой формат задан (целые числа)');
  console.log('🎉 Готово! Формулы обновляются автоматически каждый день.');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
