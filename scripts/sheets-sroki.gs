/**
 * Настройка колонки "Сроки" (R) в листе "送货 Логистика"
 *
 * Как использовать:
 * 1. Откройте таблицу → Расширения → Apps Script
 * 2. Вставьте этот код, заменив всё содержимое
 * 3. Запустите функцию setup()
 * 4. При запросе — разрешите доступ
 *
 * После этого колонка R заполнится днями, цвета появятся автоматически.
 * Ежедневно в 06:00 скрипт пересчитает значения для грузов "в пути".
 */

var SHEET_NAME   = '送货 Логистика';
var SEND_COL     = 1;   // A — Дата отправки (1-based)
var ARRIVAL_COL  = 19;  // S — Дата прибытия (1-based, сдвинута после вставки R)
var SROKI_COL    = 18;  // R — Сроки (1-based)
var HEADER_ROW   = 1;
var DATA_START   = 2;

// ── Парсинг дат ───────────────────────────────────────────────────────────────

function parseDate(val) {
  if (!val || val === '') return null;
  if (val instanceof Date) {
    var d = new Date(val);
    d.setHours(0, 0, 0, 0);
    return isNaN(d) ? null : d;
  }
  var s = val.toString().trim();
  // DD.MM.YYYY
  var m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  // Fallback
  var d2 = new Date(s);
  if (!isNaN(d2)) { d2.setHours(0,0,0,0); return d2; }
  return null;
}

function daysBetween(d1, d2) {
  return Math.floor((d2 - d1) / 86400000);
}

// ── Заполнение колонки ────────────────────────────────────────────────────────

function calcSroki() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { Logger.log('Лист не найден: ' + SHEET_NAME); return; }

  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START) return;

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var numRows = lastRow - DATA_START + 1;
  // Читаем колонки A (1) и S (19)
  var sendDates    = sheet.getRange(DATA_START, SEND_COL,   numRows, 1).getValues();
  var arrivalDates = sheet.getRange(DATA_START, ARRIVAL_COL, numRows, 1).getValues();

  var output = [];
  for (var i = 0; i < numRows; i++) {
    var sent    = parseDate(sendDates[i][0]);
    if (!sent) { output.push(['']); continue; }

    var arrived = parseDate(arrivalDates[i][0]);
    var days    = arrived ? daysBetween(sent, arrived) : daysBetween(sent, today);
    output.push([days]);
  }

  sheet.getRange(DATA_START, SROKI_COL, numRows, 1).setValues(output);
  sheet.getRange(DATA_START, SROKI_COL, numRows, 1).setNumberFormat('0');
}

// ── Условное форматирование ───────────────────────────────────────────────────

function setupConditionalFormatting() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  var cfRange = sheet.getRange(DATA_START, SROKI_COL, 2000, 1);

  // Удалить существующие правила для колонки R
  var kept = sheet.getConditionalFormatRules().filter(function(rule) {
    return !rule.getRanges().some(function(r) {
      return r.getColumn() === SROKI_COL &&
             r.getSheet().getSheetId() === sheet.getSheetId();
    });
  });

  // Порядок важен: первое правило имеет приоритет
  // >45 дн — тёмно-красный
  // >35 дн — ярко-красный
  // >25 дн — жёлтый
  // >20 дн — ярко-зелёный
  var newRules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(45)
      .setBackground('#B71C1C').setFontColor('#FFFFFF').setBold(true)
      .setRanges([cfRange]).build(),

    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(35)
      .setBackground('#F44336').setFontColor('#FFFFFF').setBold(true)
      .setRanges([cfRange]).build(),

    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(25)
      .setBackground('#FFEB3B').setFontColor('#000000')
      .setRanges([cfRange]).build(),

    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(20)
      .setBackground('#69F0AE').setFontColor('#000000')
      .setRanges([cfRange]).build(),
  ];

  sheet.setConditionalFormatRules(kept.concat(newRules));
}

// ── Триггер — пересчёт каждый день в 06:00 ───────────────────────────────────

function setupDailyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'calcSroki'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('calcSroki')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
}

// ── Главная функция — запустите один раз ─────────────────────────────────────

function setup() {
  calcSroki();
  setupConditionalFormatting();
  setupDailyTrigger();
  SpreadsheetApp.getUi().alert(
    '✅ Готово!\n\n' +
    'Колонка R "Сроки" заполнена.\n' +
    'Цветовое форматирование применено:\n' +
    '  > 20 дней — зелёный\n' +
    '  > 25 дней — жёлтый\n' +
    '  > 35 дней — красный\n' +
    '  > 45 дней — тёмно-красный\n\n' +
    'Автообновление: каждый день в 06:00.'
  );
}
