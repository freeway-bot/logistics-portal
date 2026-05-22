require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const bcrypt       = require('bcrypt');
const jwt          = require('jsonwebtoken');
const { sheets: sheetsAPI } = require('@googleapis/sheets');
const { GoogleAuth } = require('google-auth-library');
const path         = require('path');
const webpush      = require('web-push');

const app  = express();
// Railway / Netlify прокси: доверять X-Forwarded-For,
// иначе rate-limit будет считать всех клиентов как одного.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const CACHE_TTL  = (parseInt(process.env.CACHE_TTL_SECONDS) || 60) * 1000;
const USE_MOCK   = process.env.USE_MOCK_DATA === 'true';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
const IS_PROD    = process.env.NODE_ENV === 'production';

const SCANS_SPREADSHEET_ID     = process.env.SCANS_SPREADSHEET_ID     || process.env.SPREADSHEET_ID;
const LOGISTICS_SPREADSHEET_ID = process.env.LOGISTICS_SPREADSHEET_ID || process.env.SPREADSHEET_ID;
const LOGISTICS_CARGO_SHEET    = process.env.LOGISTICS_CARGO_SHEET    || '送货 Логистика';

// ─── Web Push (VAPID) ─────────────────────────────────────────────────────────

const VAPID_PUBLIC_KEY  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL       = process.env.VAPID_EMAIL || 'mailto:admin@freewaychina.com';
const PUSH_SUBS_SHEET   = 'PushSubs';

// client_id → Map<endpoint, subscription>
const pushSubsCache = new Map();

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('  ⚠  VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY не заданы — push-уведомления отключены');
}

const rawOrigins = process.env.ALLOWED_ORIGINS || '*';
app.use(cors({
  origin: rawOrigins === '*' ? true : rawOrigins.split(',').map(s => s.trim()),
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_SCANS = [
  { client_id: 'CLIENT001', track_number: 'TRK-2024-001', status: 'на складе',  date: '2024-03-01', category: 'Электроника', comment: 'Хрупкое', photo_1: '', photo_2: '', send_session: 'SS-03', box_number: '' },
  { client_id: 'CLIENT001', track_number: 'TRK-2024-002', status: 'на складе',  date: '2024-03-03', category: 'Одежда',      comment: '', photo_1: '', photo_2: '', send_session: 'SS-03', box_number: '' },
  { client_id: 'CLIENT001', track_number: 'TRK-2024-003', status: 'упаковано',  date: '2024-03-05', category: 'Игрушки',     comment: '', photo_1: '', photo_2: '', send_session: 'SS-03', box_number: 'BOX-01' },
  { client_id: 'CLIENT001', track_number: 'TRK-2024-004', status: 'упаковано',  date: '2024-03-05', category: 'Одежда',      comment: '', photo_1: '', photo_2: '', send_session: 'SS-03', box_number: 'BOX-01' },
  { client_id: 'CLIENT001', track_number: 'TRK-2024-005', status: 'отправлено', date: '2024-02-20', category: 'Косметика',   comment: '', photo_1: '', photo_2: '', send_session: 'SS-02', box_number: 'BOX-02' },
  { client_id: 'CLIENT002', track_number: 'TRK-2024-010', status: 'на складе',  date: '2024-03-07', category: 'Электроника', comment: '', photo_1: '', photo_2: '', send_session: '', box_number: '' },
  { client_id: 'CLIENT002', track_number: 'TRK-2024-011', status: 'отправлено', date: '2024-03-01', category: 'Одежда',      comment: '', photo_1: '', photo_2: '', send_session: 'SS-03', box_number: 'BOX-05' },
];

const MOCK_USERS = [
  { _row: 2, username: 'admin',     client_id: '',         password_hash: '', role: 'admin',    full_name: 'Администратор', lang: 'ru', active: 'true', _mock_pw: 'admin123' },
  { _row: 3, username: 'employee1', client_id: '',         password_hash: '', role: 'employee', full_name: 'Сотрудник',     lang: 'ru', active: 'true', _mock_pw: 'emp123'   },
  { _row: 4, username: 'CLIENT001', client_id: 'CLIENT001', password_hash: '', role: 'client',  full_name: 'Тест Клиент',  lang: 'ru', active: 'true', _mock_pw: 'client123' },
  { _row: 5, username: 'CLIENT002', client_id: 'CLIENT002', password_hash: '', role: 'client',  full_name: 'Клиент 2',     lang: 'zh', active: 'true', _mock_pw: 'client123' },
];

const MOCK_CARGO = [
  { date:'2024-03-01', cargo_number:'CLIENT001-1-1004-1', category:'Электроника', places:'3', weight:'12.50', volume:'0.08', price_per_kg:'5.00', density:'', cargo_cost:'62.50', insurance_pct:'1', insurance_usd:'0.63', packaging:'20', loading:'10', total:'93.13', status:'Отправлено', arrival:'' },
  { date:'2024-03-10', cargo_number:'CLIENT001-2-1004-2', category:'Одежда',      places:'5', weight:'8.20',  volume:'0.12', price_per_kg:'5.00', density:'', cargo_cost:'41.00', insurance_pct:'1', insurance_usd:'0.41', packaging:'30', loading:'15', total:'86.41', status:'На складе',  arrival:'' },
  { date:'2024-03-15', cargo_number:'CLIENT001-3-1004-3', category:'Аксессуары',  places:'2', weight:'3.40',  volume:'0.04', price_per_kg:'5.00', density:'', cargo_cost:'17.00', insurance_pct:'1', insurance_usd:'0.17', packaging:'10', loading:'5',  total:'32.17', status:'На складе',  arrival:'' },
  { date:'2024-03-01', cargo_number:'CLIENT002-1-1005-1', category:'Игрушки',     places:'8', weight:'22.00', volume:'0.30', price_per_kg:'4.50', density:'', cargo_cost:'99.00', insurance_pct:'1', insurance_usd:'0.99', packaging:'40', loading:'20', total:'159.99', status:'Отправлено', arrival:'' },
];

// ─── Google Sheets auth ───────────────────────────────────────────────────────

const SCOPES_RW = ['https://www.googleapis.com/auth/spreadsheets'];
const SCOPES_RO = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

async function getAuth(write = false) {
  const scopes = write ? SCOPES_RW : SCOPES_RO;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return new GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), scopes });
  }
  return new GoogleAuth({ keyFile: process.env.GOOGLE_KEY_FILE || './credentials/service-account.json', scopes });
}

// ─── Column mapping (Scans) ───────────────────────────────────────────────────

const APPSHEET_FILE_URL = 'https://www.appsheet.com/template/gettablefileurl?appName=Scans-300030298&tableName=Scans&fileName=';

const COLUMN_MAP = {
  clientid:        'client_id',
  tracknumber:     'track_number',
  category:        'category',
  timestamp:       'date',
  labelphoto:      '_label_path',
  photo:           '_photo_path',
  'фото_товара':   null,
  'фото_этикетки': null,
  status:          'status',
  box:             'box_number',
  comment:         'comment',
};

function buildPhotoUrl(p) {
  return p && p.trim() ? APPSHEET_FILE_URL + encodeURIComponent(p.trim()) : '';
}

async function fetchSheetRows() {
  const auth   = await getAuth(false);
  const sheets = sheetsAPI({ version: 'v4', auth });
  const res    = await sheets.spreadsheets.values.get({
    spreadsheetId: SCANS_SPREADSHEET_ID,
    range: process.env.SHEET_RANGE || 'Scans!A:Z',
  });
  return res.data.values || [];
}

function parseRows(rows) {
  if (!rows || rows.length < 2) return { headers: [], rawHeaders: [], data: [] };
  const rawHeaders = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));

  const data = rows.slice(1).map(row => {
    const obj = {};
    rawHeaders.forEach((rk, i) => {
      const val    = (row[i] !== undefined ? row[i] : '').toString().trim();
      const mapped = Object.prototype.hasOwnProperty.call(COLUMN_MAP, rk) ? COLUMN_MAP[rk] : rk;
      if (mapped === null) return;
      obj[mapped] = val;
    });
    obj.photo_1 = buildPhotoUrl(obj._photo_path || '');
    obj.photo_2 = buildPhotoUrl(obj._label_path || '');
    delete obj._photo_path; delete obj._label_path;
    return obj;
  }).filter(row => Object.values(row).some(v => v !== ''));

  return { rawHeaders, data };
}

// ─── Scans cache ──────────────────────────────────────────────────────────────

let cache = { rawHeaders: [], data: null, ts: 0 };
function invalidateCache() { cache.ts = 0; }

async function getAllData() {
  if (USE_MOCK) return { rawHeaders: [], data: MOCK_SCANS };
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) return cache;
  const rows   = await fetchSheetRows();
  const parsed = parseRows(rows);
  cache = { ...parsed, ts: now };
  return cache;
}

// ─── Users (Logistics spreadsheet) ───────────────────────────────────────────

const USERS_SHEET_NAME     = process.env.USERS_SHEET_NAME     || 'Users';
const PASSWORDS_SHEET_NAME = process.env.PASSWORDS_SHEET_NAME || 'Пароли';

let usersCache = { data: null, ts: 0 };
function invalidateUsersCache() { usersCache.ts = 0; }

async function fetchUsersRows() {
  const auth   = await getAuth(false);
  const sheets = sheetsAPI({ version: 'v4', auth });
  const res    = await sheets.spreadsheets.values.get({
    spreadsheetId: LOGISTICS_SPREADSHEET_ID,
    range: `${USERS_SHEET_NAME}!A:K`,
  });
  return res.data.values || [];
}

function parseUsers(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map((row, idx) => {
    const obj = { _row: idx + 2 };
    headers.forEach((h, i) => { obj[h] = (row[i] !== undefined ? row[i] : '').toString().trim(); });
    return obj;
  }).filter(u => (u.username || u.client_id) && u.active !== 'false' && u.active !== 'FALSE');
}

async function getAllUsers(forceRefresh = false) {
  if (USE_MOCK) return MOCK_USERS;
  const now = Date.now();
  if (!forceRefresh && usersCache.data && now - usersCache.ts < CACHE_TTL) return usersCache.data;
  const rows = await fetchUsersRows();
  const data = parseUsers(rows);
  usersCache = { data, ts: now };
  return data;
}

function toLetterCol(n) {
  let s = ''; n++;
  while (n > 0) { s = String.fromCharCode(64 + (n % 26 || 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function updateUserLastLogin(row) {
  try {
    const rows = await fetchUsersRows();
    if (!rows || rows.length < 1) return;
    const headers = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
    const col = headers.indexOf('last_login');
    if (col === -1) return;
    const auth   = await getAuth(true);
    const sheets = sheetsAPI({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
      spreadsheetId: LOGISTICS_SPREADSHEET_ID,
      range: `${USERS_SHEET_NAME}!${toLetterCol(col)}${row}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[new Date().toISOString()]] },
    });
    invalidateUsersCache();
  } catch (err) {
    console.error('[updateUserLastLogin]', err.message);
  }
}

// ─── Passwords sheet helper ───────────────────────────────────────────────────

async function writeToPasswordsSheet(clientId, password, role = 'Клиент', note = '') {
  if (USE_MOCK) return;
  try {
    const auth   = await getAuth(true);
    const sheets = sheetsAPI({ version: 'v4', auth });
    const date   = new Date().toLocaleDateString('ru-RU');

    // Check if row for this clientId already exists → update it, else append
    const res  = await sheets.spreadsheets.values.get({
      spreadsheetId: LOGISTICS_SPREADSHEET_ID,
      range: `${PASSWORDS_SHEET_NAME}!A:A`,
    });
    const col   = (res.data.values || []);
    const rowIdx = col.findIndex(r => (r[0] || '').toLowerCase() === clientId.toLowerCase());

    if (rowIdx > 0) {
      // Update existing row (password reset)
      await sheets.spreadsheets.values.update({
        spreadsheetId: LOGISTICS_SPREADSHEET_ID,
        range: `${PASSWORDS_SHEET_NAME}!A${rowIdx + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[clientId, password, role, date, note || 'сброс пароля']] },
      });
    } else {
      // Append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId: LOGISTICS_SPREADSHEET_ID,
        range: `${PASSWORDS_SHEET_NAME}!A:E`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[clientId, password, role, date, note]] },
      });
    }
  } catch (err) {
    console.error('[writeToPasswordsSheet]', err.message);
  }
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ code: 'auth.required', error: 'Необходима авторизация' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('token');
    res.status(401).json({ code: 'auth.expired', error: 'Сессия истекла, войдите снова' });
  }
}

function requireRole(...roles) {
  return [requireAuth, (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ code: 'auth.forbidden', error: 'Недостаточно прав' });
    }
    next();
  }];
}

// ─── Operation log ────────────────────────────────────────────────────────────

const opLog = [];
const OP_LOG_MAX = 500;

function addOpLog(entry) {
  opLog.unshift({ id: Date.now(), ...entry });
  if (opLog.length > OP_LOG_MAX) opLog.length = OP_LOG_MAX;
}

// ─── Отправления sheet helpers ────────────────────────────────────────────────
// Отдельный лист в таблице Scans: Дата | НомерГруза | Трек | Клиент | Оператор
// Хранит привязку трек → груз (вместо колонки shipment_id в листе Scans).

const OTPRAVLENIYA_SHEET = 'Отправления';
const OTPRAVLENIYA_HEADERS = ['Дата', 'НомерГруза', 'Трек', 'Клиент', 'Оператор'];

let otpravleniyaCache = { data: null, ts: 0 };
function invalidateOtpravleniyaCache() { otpravleniyaCache.ts = 0; }

async function ensureOtpravleniyaSheet(sheetsClient) {
  const spreadsheet = await sheetsClient.spreadsheets.get({ spreadsheetId: SCANS_SPREADSHEET_ID });
  const exists = spreadsheet.data.sheets.some(s => s.properties.title === OTPRAVLENIYA_SHEET);
  if (!exists) {
    await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId: SCANS_SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: OTPRAVLENIYA_SHEET } } }] },
    });
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SCANS_SPREADSHEET_ID,
      range: `${OTPRAVLENIYA_SHEET}!A1:E1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [OTPRAVLENIYA_HEADERS] },
    });
  }
}

async function fetchOtpravleniyaRows() {
  const auth   = await getAuth(false);
  const sheets = sheetsAPI({ version: 'v4', auth });
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SCANS_SPREADSHEET_ID,
      range: `${OTPRAVLENIYA_SHEET}!A:E`,
    });
    return res.data.values || [];
  } catch { return []; }
}

async function getOtpravleniya(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && otpravleniyaCache.data && now - otpravleniyaCache.ts < CACHE_TTL) {
    return otpravleniyaCache.data;
  }
  const rows = await fetchOtpravleniyaRows();
  if (rows.length < 2) { otpravleniyaCache = { data: [], ts: now }; return []; }
  const data = rows.slice(1).map(r => ({
    date:        (r[0] || '').trim(),
    cargo_number:(r[1] || '').trim(),
    track:       (r[2] || '').trim(),
    client_id:   (r[3] || '').trim(),
    operator:    (r[4] || '').trim(),
  })).filter(r => r.track);
  otpravleniyaCache = { data, ts: now };
  return data;
}

function generateShipmentId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `SHIP-${date}-${rand}`;
}

// ─── Cargo helpers (送货 Логистика) ──────────────────────────────────────────

let cargoCache = { data: null, rawHeaders: [], ts: 0 };
function invalidateCargoCache() { cargoCache.ts = 0; }

async function fetchCargoRows() {
  const auth   = await getAuth(false);
  const sheets = sheetsAPI({ version: 'v4', auth });
  const res    = await sheets.spreadsheets.values.get({
    spreadsheetId: LOGISTICS_SPREADSHEET_ID,
    range: `${LOGISTICS_CARGO_SHEET}!A:AM`,
  });
  return res.data.values || [];
}

function parseCargoRows(rows) {
  if (!rows || rows.length < 2) return { rawHeaders: [], data: [] };
  const rawHeaders = rows[0].map(h => h.toString().trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '_'));
  const data = rows.slice(1).map((row, idx) => {
    const obj = { _row: idx + 2, _vals: row }; // _vals = raw values by index
    rawHeaders.forEach((h, i) => { obj[h] = (row[i] !== undefined ? row[i] : '').toString().trim(); });
    return obj;
  }).filter(r => Object.entries(r).some(([k, v]) => k !== '_row' && v !== ''));
  return { rawHeaders, data };
}

async function getAllCargo(forceRefresh = false) {
  if (USE_MOCK) return { rawHeaders: [], data: MOCK_CARGO };
  const now = Date.now();
  if (!forceRefresh && cargoCache.data && now - cargoCache.ts < CACHE_TTL) return cargoCache;
  const rows   = await fetchCargoRows();
  const parsed = parseCargoRows(rows);
  cargoCache   = { ...parsed, ts: now };
  return cargoCache;
}

// Find a field value in a row by keyword match on key names
function findField(row, ...keywords) {
  for (const [key, val] of Object.entries(row)) {
    if (key === '_row') continue;
    if (keywords.some(kw => key.includes(kw))) return val || '';
  }
  return '';
}

// Normalize a raw cargo row to a consistent shape for the frontend
// Фиксированные индексы колонок «送货 Логистика»:
// 0=Дата, 1=Клиент, 3=Категория, 4=НомерГруза, 5=Мест, 6=Вес, 7=Объём,
// 8=Цена/кг, 9=Плотность, 10=Стоимость, 11=Страховка%, 12=Страховка$,
// 13=Упаковка, 14=Погрузка, 15=Итого, 16=Статус, 17=Прибытие,
// 20=Маршрут, 21=Перевозчик, 23=Комментарии
const CARGO_COLS = {
  date:0, client_id:1, category:3, cargo_number:4, places:5,
  weight:6, volume:7, price_per_kg:8, density:9, cargo_cost:10,
  insurance_pct:11, insurance_usd:12, packaging:13, loading:14,
  total:15, status:16, arrival:17, route:20, carrier:21, comment:23,
};

function getCol(r, idx) {
  const v = r._vals ? (r._vals[idx] !== undefined ? r._vals[idx] : '') : '';
  return v.toString().trim();
}

function normalizeCargoRow(r) {
  return {
    date:          getCol(r, CARGO_COLS.date),
    client_id:     getCol(r, CARGO_COLS.client_id),
    cargo_number:  getCol(r, CARGO_COLS.cargo_number),
    category:      getCol(r, CARGO_COLS.category),
    places:        getCol(r, CARGO_COLS.places),
    weight:        getCol(r, CARGO_COLS.weight),
    volume:        getCol(r, CARGO_COLS.volume),
    price_per_kg:  getCol(r, CARGO_COLS.price_per_kg),
    density:       getCol(r, CARGO_COLS.density),
    cargo_cost:    getCol(r, CARGO_COLS.cargo_cost),
    insurance_pct: getCol(r, CARGO_COLS.insurance_pct),
    insurance_usd: getCol(r, CARGO_COLS.insurance_usd),
    packaging:     getCol(r, CARGO_COLS.packaging),
    loading:       getCol(r, CARGO_COLS.loading),
    total:         getCol(r, CARGO_COLS.total),
    status:        getCol(r, CARGO_COLS.status),
    arrival:       getCol(r, CARGO_COLS.arrival),
    route:         getCol(r, CARGO_COLS.route),
    carrier:       getCol(r, CARGO_COLS.carrier),
    comment:       getCol(r, CARGO_COLS.comment),
  };
}

// ─── Status normalization ─────────────────────────────────────────────────────

const STATUS_MAP_NORM = {
  'на складе':'warehouse','склад':'warehouse','received':'warehouse','in stock':'warehouse','warehouse':'warehouse','在仓库':'warehouse','仓库':'warehouse',
  'упаковано':'warehouse','packed':'warehouse','pack':'warehouse','已打包':'warehouse',
  'отправлено':'shipped','shipped':'shipped','sent':'shipped','已发货':'shipped','运输中':'shipped',
  'доставлено':'delivered','delivered':'delivered','получен':'delivered','получено':'delivered','已收到':'delivered','已签收':'delivered',
};

function normStatus(s) { return STATUS_MAP_NORM[(s||'').toLowerCase().trim()] || 'other'; }

// ─── Sort / date helpers ──────────────────────────────────────────────────────

function sortData(items, by = 'date', dir = 'desc') {
  return [...items].sort((a, b) => {
    const va = (a[by]||'').toString().toLowerCase();
    const vb = (b[by]||'').toString().toLowerCase();
    if (by === 'date') {
      const da = new Date(va), db = new Date(vb);
      if (!isNaN(da) && !isNaN(db)) return dir === 'asc' ? da - db : db - da;
    }
    return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
  });
}

function parseItemDate(str) {
  if (!str) return null;
  const s = str.toString().trim();
  // DD.MM.YYYY or DD,MM,YYYY — must parse before new Date() misreads as MM/DD
  let m = s.match(/^(\d{1,2})[.,](\d{1,2})[.,](\d{4})$/);
  if (m) {
    let dd = +m[1], mm = +m[2];
    if (mm > 12 && dd <= 12) { const tmp = dd; dd = mm; mm = tmp; }
    const d = new Date(+m[3], mm - 1, dd);
    return isNaN(d) ? null : d;
  }
  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return startOfDay(d); }

// ─── ═══════════════════ API ROUTES ═══════════════════ ────────────────────────

// ── Auth routes ────────────────────────────────────────────────────────────────

// Rate limiter: 5 попыток логина / 15 мин / IP. Защита от брутфорса паролей.
// При превышении возвращает 429 с локализуемым кодом.
const loginLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,
  max:            5,
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: true,
  message: {
    code:  'auth.too_many_attempts',
    error: 'Слишком много попыток входа. Попробуйте через 15 минут.',
  },
});

// Rate limiter: 5 запросов смены пароля / 15 мин / IP.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    code:  'auth.too_many_attempts',
    error: 'Слишком много попыток. Попробуйте через 15 минут.',
  },
});

// POST /api/auth/login
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ code: 'auth.missing_fields', error: 'Укажите логин и пароль' });
    }

    const loginLow = login.trim().toLowerCase();
    const users = await getAllUsers(true);
    const user  = users.find(u =>
      (u.username  || '').toLowerCase() === loginLow ||
      (u.client_id || '').toLowerCase() === loginLow
    );

    if (!user) {
      return res.status(401).json({ code: 'auth.invalid_credentials', error: 'Неверный логин или пароль' });
    }

    let passwordMatch = false;
    if (USE_MOCK) {
      passwordMatch = (password === user._mock_pw);
    } else {
      passwordMatch = await bcrypt.compare(password, user.password_hash || '');
    }

    if (!passwordMatch) {
      return res.status(401).json({ code: 'auth.invalid_credentials', error: 'Неверный логин или пароль' });
    }

    const payload = {
      username: user.username || user.client_id,
      clientId: user.client_id || '',
      role:     user.role     || 'client',
      lang:     user.lang     || 'ru',
      fullName: user.full_name || '',
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'Lax',
      secure:   IS_PROD,
      maxAge:   7 * 24 * 60 * 60 * 1000,
    });

    if (!USE_MOCK && user._row) {
      updateUserLastLogin(user._row).catch(() => {});
    }

    res.json({ ok: true, user: payload });
  } catch (err) {
    console.error('[/auth/login]', err.message);
    res.status(500).json({ code: 'server.error', error: 'Ошибка сервера' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', changePasswordLimiter, requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ code: 'auth.missing_fields', error: 'Укажите текущий и новый пароль' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ code: 'auth.weak_password', error: 'Минимум 6 символов' });
    }

    const users    = await getAllUsers(true);
    const loginLow = (req.user.username || req.user.clientId).toLowerCase();
    const user     = users.find(u =>
      (u.username  || '').toLowerCase() === loginLow ||
      (u.client_id || '').toLowerCase() === loginLow
    );

    if (!user) return res.status(404).json({ code: 'auth.user_not_found', error: 'Пользователь не найден' });

    const match = USE_MOCK
      ? current_password === user._mock_pw
      : await bcrypt.compare(current_password, user.password_hash || '');

    if (!match) return res.status(401).json({ code: 'auth.invalid_credentials', error: 'Неверный текущий пароль' });

    if (!USE_MOCK) {
      const newHash = await bcrypt.hash(new_password, 10);
      const rows    = await fetchUsersRows();
      const headers = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
      const col     = headers.indexOf('password_hash');
      if (col === -1) return res.status(500).json({ code: 'server.error', error: 'Колонка password_hash не найдена' });

      const auth   = await getAuth(true);
      const sheets = sheetsAPI({ version: 'v4', auth });
      await sheets.spreadsheets.values.update({
        spreadsheetId: LOGISTICS_SPREADSHEET_ID,
        range: `${USERS_SHEET_NAME}!${toLetterCol(col)}${user._row}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[newHash]] },
      });
      invalidateUsersCache();
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[/auth/change-password]', err.message);
    res.status(500).json({ code: 'server.error', error: 'Ошибка сервера' });
  }
});

// ── Client routes ──────────────────────────────────────────────────────────────

// GET /api/client/parcels — parcels for logged-in client
app.get('/api/client/parcels', requireRole('client', 'admin', 'employee'), async (req, res) => {
  try {
    const clientId = req.user.role === 'client'
      ? req.user.clientId
      : (req.query.client_id || '').trim();

    if (!clientId) return res.status(400).json({ code: 'client.missing_id', error: 'Укажите client_id' });

    const { status, sort_by = 'date', sort_order = 'desc', page = 1, per_page = 500 } = req.query;
    const { data: allData } = await getAllData();

    let data = allData.filter(r => (r.client_id||'').toLowerCase() === clientId.toLowerCase());

    // Cross-reference: mark parcels as "доставлено" if their cargo has an arrival date
    if (!USE_MOCK) {
      try {
        const [otpData, cargoRes] = await Promise.all([getOtpravleniya(), getAllCargo()]);
        const trackToCargo = new Map();
        otpData.forEach(r => {
          if (r.track && r.cargo_number) trackToCargo.set(r.track.toLowerCase(), r.cargo_number.toLowerCase());
        });
        const cargoArrived = new Set();
        (cargoRes.data || []).forEach(r => {
          const norm = normalizeCargoRow(r);
          if (norm.cargo_number && norm.arrival) cargoArrived.add(norm.cargo_number.toLowerCase());
        });
        data = data.map(p => {
          const track = (p.track_number || '').toLowerCase();
          const cargoNum = trackToCargo.get(track);
          if (cargoNum && cargoArrived.has(cargoNum)) return { ...p, status: 'доставлено' };
          return p;
        });
      } catch (e) {
        console.warn('[/client/parcels] delivery cross-ref failed:', e.message);
      }
    }

    if (status) data = data.filter(r => normStatus(r.status) === status);
    data = sortData(data, sort_by, sort_order);

    const limit  = Math.min(Math.max(parseInt(per_page)||500, 1), 1000);
    const offset = (Math.max(parseInt(page)||1, 1) - 1) * limit;
    const total  = data.length;

    res.json({ clientId, total, page: parseInt(page)||1, per_page: limit, pages: Math.ceil(total/limit)||1, data: data.slice(offset, offset+limit) });
  } catch (err) { console.error('[/client/parcels]', err.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// GET /api/client/shipments — cargo lines from 送货 Логистика for logged-in client
app.get('/api/client/shipments', requireRole('client', 'admin', 'employee'), async (req, res) => {
  try {
    const clientId = req.user.role === 'client'
      ? req.user.clientId
      : (req.query.client_id || '').trim();

    if (!clientId) return res.status(400).json({ code: 'client.missing_id', error: 'Укажите client_id' });

    // Клиент не должен видеть внутренние поля: себестоимость, перевозчик, комментарии
    const isClient = req.user.role === 'client';
    const stripInternal = (row) => {
      if (!isClient) return row;
      const { cargo_cost, carrier, comment, ...safe } = row;
      return safe;
    };

    if (USE_MOCK) {
      const prefix = clientId.toLowerCase() + '-';
      const data   = MOCK_CARGO.filter(r => (r.cargo_number || '').toLowerCase().startsWith(prefix));
      return res.json({ clientId, total: data.length, data: data.map(stripInternal) });
    }

    const { data: allData } = await getAllCargo();
    const clientLow = clientId.toLowerCase();

    const data = allData.filter(r => {
      // Primary: dedicated ID клиента column (added by migration script)
      const col = findField(r, 'id_клиента', 'id_client');
      if (col) return col.toLowerCase() === clientLow;
      // Fallback: extract from cargo number first segment
      const num = findField(r, '货物编号', 'номер_груза');
      return num ? num.split('-')[0].trim().toLowerCase() === clientLow : false;
    });

    res.json({ clientId, total: data.length, data: data.map(r => stripInternal(normalizeCargoRow(r))) });
  } catch (err) {
    console.error('[/client/shipments]', err.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// GET /api/client/:clientId — legacy route, now requires auth
app.get('/api/client/:clientId', requireAuth, async (req, res) => {
  try {
    const clientId = (req.params.clientId || '').trim();
    if (!clientId) return res.status(400).json({ error: 'Client ID не указан' });

    // Clients can only view their own data
    if (req.user.role === 'client' && req.user.clientId.toLowerCase() !== clientId.toLowerCase()) {
      return res.status(403).json({ code: 'auth.forbidden', error: 'Нет доступа' });
    }

    const { status, sort_by = 'date', sort_order = 'desc', page = 1, per_page = 500 } = req.query;
    const { data: allData } = await getAllData();

    let data = allData.filter(r => (r.client_id||'').toLowerCase() === clientId.toLowerCase());
    if (data.length === 0) return res.status(404).json({ error: 'Клиент не найден' });
    if (status) data = data.filter(r => normStatus(r.status) === status);

    data = sortData(data, sort_by, sort_order);
    const limit  = Math.min(Math.max(parseInt(per_page)||500, 1), 1000);
    const offset = (Math.max(parseInt(page)||1, 1) - 1) * limit;
    const total  = data.length;

    res.json({ clientId, total, page: parseInt(page)||1, per_page: limit, pages: Math.ceil(total/limit), data: data.slice(offset, offset+limit) });
  } catch (err) { console.error('[/client/:id]', err.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// GET /api/search?track=XXX — still accessible, but auth recommended
app.get('/api/search', async (req, res) => {
  try {
    const track = (req.query.track || '').trim();
    if (!track) return res.status(400).json({ error: 'Укажите трек' });
    if (track.length < 3) return res.status(400).json({ error: 'Минимум 3 символа' });

    const { data: allData } = await getAllData();
    const q = track.toLowerCase();
    const results = allData.filter(r => (r.track_number||'').toLowerCase().includes(q)).slice(0, 500);
    res.json({ query: track, total: results.length, data: results });
  } catch (err) { res.status(500).json({ error: 'Ошибка поиска' }); }
});

// ── Admin analytics routes (employee + admin) ─────────────────────────────────

// GET /api/admin/stats
app.get('/api/admin/stats', requireRole('admin', 'employee'), async (req, res) => {
  try {
    const { data: allData } = await getAllData();
    const now       = new Date();
    const today     = startOfDay(now);
    const week7     = daysAgo(7);

    const byStatus = { warehouse: 0, packed: 0, shipped: 0, other: 0 };
    allData.forEach(r => { const n = normStatus(r.status); byStatus[n] = (byStatus[n]||0)+1; });

    let addedToday=0, addedYesterday=0, shippedToday=0, shippedWeek=0;
    const clientsOnWarehouse = new Set();

    allData.forEach(r => {
      const d = parseItemDate(r.date);
      if (d) {
        if (d >= today) addedToday++;
        const yStart = daysAgo(1);
        if (d >= yStart && d < today) addedYesterday++;
      }
      if (normStatus(r.status) === 'shipped' && d) {
        if (d >= today) shippedToday++;
        if (d >= week7) shippedWeek++;
      }
      if (normStatus(r.status) === 'warehouse' && r.client_id) {
        clientsOnWarehouse.add(r.client_id.toLowerCase());
      }
    });

    const problems = {
      noStatus:   allData.filter(r => !r.status).length,
      noClientId: allData.filter(r => !r.client_id).length,
      noTrack:    allData.filter(r => !r.track_number).length,
      duplicates: (() => {
        const seen = {}; let dups = 0;
        allData.forEach(r => { if (r.track_number) { seen[r.track_number] = (seen[r.track_number]||0)+1; } });
        Object.values(seen).forEach(c => { if (c > 1) dups += c - 1; });
        return dups;
      })(),
    };

    const clientWarehouse = {};
    allData.forEach(r => {
      if (normStatus(r.status) === 'warehouse' && r.client_id) {
        clientWarehouse[r.client_id] = (clientWarehouse[r.client_id]||0)+1;
      }
    });
    const topClients = Object.entries(clientWarehouse)
      .sort((a,b) => b[1]-a[1]).slice(0,10)
      .map(([id, count]) => ({ id, count }));

    res.json({
      total:          allData.length,
      addedToday,
      addedYesterday,
      warehouse:      byStatus.warehouse,
      packed:         byStatus.packed,
      shipped:        byStatus.shipped,
      shippedToday,
      shippedWeek,
      uniqueClients:  clientsOnWarehouse.size,
      problems,
      topClients,
      statusDist:     Object.entries(byStatus).map(([status, count]) => ({ status, count })),
    });
  } catch (err) { console.error('[/admin/stats]', err.message); res.status(500).json({ error: 'Ошибка' }); }
});

// GET /api/admin/recent
app.get('/api/admin/recent', requireRole('admin', 'employee'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit)||10, 50);
    const { data: allData } = await getAllData();
    const sorted     = sortData(allData, 'date', 'desc');
    const recentShipped = sortData(allData.filter(r => normStatus(r.status) === 'shipped'), 'date', 'desc');
    res.json({ recent: sorted.slice(0, limit), recentShipped: recentShipped.slice(0, limit) });
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

// GET /api/admin/daily
app.get('/api/admin/daily', requireRole('admin', 'employee'), async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days)||14, 60);
    const { data: allData } = await getAllData();

    const result = {};
    for (let i = days - 1; i >= 0; i--) {
      const d   = daysAgo(i);
      const key = d.toISOString().slice(0,10);
      result[key] = { date: key, added: 0, shipped: 0 };
    }

    allData.forEach(r => {
      const d = parseItemDate(r.date);
      if (!d) return;
      const key = startOfDay(d).toISOString().slice(0,10);
      if (!result[key]) return;
      result[key].added++;
      if (normStatus(r.status) === 'shipped') result[key].shipped++;
    });

    res.json({ days: Object.values(result) });
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

// GET /api/admin/history
app.get('/api/admin/history', requireRole('admin', 'employee'), (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json({ total: opLog.length, data: opLog.slice(0, limit) });
});

// ── Admin write routes ────────────────────────────────────────────────────────

// POST /api/admin/upload — bulk status update
app.post('/api/admin/upload', requireRole('admin', 'employee'), async (req, res) => {
  try {
    if (USE_MOCK) return res.json({ message: 'Mock-режим: запись в таблицу недоступна', updated: 0, notFound: [], duplicates: [], alreadyShipped: [] });

    const { tracks: rawTracks = [], status = 'отправлено', date = '', send_session = '', comment = '', operator = '' } = req.body;
    const operatorName = operator || req.user?.username || 'unknown';

    const seen = new Set(); const duplicates = [];
    const tracks = rawTracks
      .map(t => t.toString().trim())
      .filter(t => {
        if (!t) return false;
        if (seen.has(t)) { duplicates.push(t); return false; }
        seen.add(t); return true;
      });

    if (tracks.length === 0) return res.status(400).json({ error: 'Список треков пуст' });

    const auth      = await getAuth(true);
    const sheets    = sheetsAPI({ version: 'v4', auth });
    const sheetRange = process.env.SHEET_RANGE || 'Scans!A:Z';
    const sheetName  = sheetRange.split('!')[0];

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SCANS_SPREADSHEET_ID,
      range: sheetRange,
    });
    const rows = readRes.data.values || [];
    if (rows.length < 2) return res.status(500).json({ error: 'Таблица пустая' });

    const rawHeaders = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
    const trackCol   = rawHeaders.indexOf('tracknumber');
    const statusCol  = rawHeaders.indexOf('status');
    const dateCol    = rawHeaders.indexOf('timestamp');
    const sessionCol = rawHeaders.indexOf('send_session');
    const commentCol = rawHeaders.indexOf('comment');

    if (trackCol === -1 || statusCol === -1) {
      return res.status(500).json({ error: 'Не найдены колонки TrackNumber / Status в таблице' });
    }

    const trackIndex = {};
    rows.slice(1).forEach((row, i) => {
      const t = (row[trackCol] || '').toString().trim();
      if (t) { if (!trackIndex[t]) trackIndex[t] = []; trackIndex[t].push(i + 2); }
    });

    const updated = []; const notFound = []; const alreadyShipped = [];
    const batchData   = [];
    const updateDate  = date || new Date().toLocaleDateString('en-US');

    for (const track of tracks) {
      const rowNums = trackIndex[track];
      if (!rowNums) { notFound.push(track); continue; }

      for (const rowNum of rowNums) {
        const currentStatus = (rows[rowNum - 1][statusCol] || '').toString().trim();
        if (normStatus(currentStatus) === 'shipped') { alreadyShipped.push(track); continue; }

        batchData.push({ range: `${sheetName}!${toLetterCol(statusCol)}${rowNum}`,  values: [[status]] });
        if (dateCol    !== -1) batchData.push({ range: `${sheetName}!${toLetterCol(dateCol)}${rowNum}`,    values: [[updateDate]] });
        if (sessionCol !== -1 && send_session) batchData.push({ range: `${sheetName}!${toLetterCol(sessionCol)}${rowNum}`, values: [[send_session]] });
        if (commentCol !== -1 && comment) {
          const existing   = (rows[rowNum - 1][commentCol] || '').toString().trim();
          const newComment = existing ? `${existing}; ${comment}` : comment;
          batchData.push({ range: `${sheetName}!${toLetterCol(commentCol)}${rowNum}`, values: [[newComment]] });
        }
        updated.push(track);
      }
    }

    if (batchData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SCANS_SPREADSHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
      });
    }

    invalidateCache();

    // Push-уведомления клиентам при поступлении посылок на склад
    if (normStatus(status) === 'warehouse' && VAPID_PUBLIC_KEY) {
      const clientCol = rawHeaders.indexOf('clientid');
      if (clientCol !== -1) {
        const clientTracks = new Map();
        for (const track of updated) {
          const rowNums = trackIndex[track];
          if (!rowNums) continue;
          const clientId = (rows[rowNums[0] - 1][clientCol] || '').toString().trim();
          if (!clientId) continue;
          if (!clientTracks.has(clientId)) clientTracks.set(clientId, []);
          clientTracks.get(clientId).push(track);
        }
        for (const [clientId, list] of clientTracks) {
          const n     = list.length;
          const title = n === 1 ? '📦 Посылка прибыла на склад' : `📦 ${n} посылки прибыли на склад`;
          const body  = n === 1
            ? `Трек: ${list[0]}`
            : `${list.slice(0, 2).join(', ')}${n > 2 ? ` и ещё ${n - 2}` : ''}`;
          sendPushToClient(clientId, title, body, { url: '/dashboard.html', tag: 'parcels-arrived' })
            .catch(() => {});
        }
      }
    }

    addOpLog({
      ts: new Date().toISOString(), operator: operatorName, status, send_session, comment,
      submitted: tracks.length + duplicates.length, updated: updated.length, notFound, duplicates, alreadyShipped,
    });

    res.json({ submitted: tracks.length + duplicates.length, updated: updated.length, notFound, duplicates, alreadyShipped });
  } catch (err) {
    console.error('[/admin/upload]', err.message);
    res.status(500).json({ error: 'Ошибка обновления таблицы: ' + err.message });
  }
});

// POST /api/admin/shipments — создать отгрузку.
// Вход: { tracks: string[], cargo_number?: string, client_id?: string }
// Действия:
//   1. В Scans проставляем только status='отправлено' (AppSheet не перегружаем)
//   2. Пишем привязку трек→груз в лист «Отправления» (отдельный от AppSheet)
//   3. Добавляем строку в «送货 Логистика»: Дата(A), ID клиента(B), Номер груза(E)
app.post('/api/admin/shipments', requireRole('admin', 'employee'), async (req, res) => {
  try {
    if (USE_MOCK) return res.json({ cargo_number: req.body?.cargo_number || 'MOCK', updated: 0, notFound: [], duplicates: [], alreadyShipped: [] });

    const { tracks: rawTracks = [], cargo_number = '', client_id = '' } = req.body;
    const cargoNumber  = cargo_number.toString().trim();
    const clientId     = client_id.toString().trim();
    const operatorName = req.user?.username || 'unknown';

    const seen = new Set(); const duplicates = [];
    const tracks = rawTracks
      .map(t => t.toString().trim())
      .filter(t => { if (!t) return false; if (seen.has(t)) { duplicates.push(t); return false; } seen.add(t); return true; });

    if (tracks.length === 0) return res.status(400).json({ error: 'Список треков пуст' });

    const created_at = new Date().toISOString();
    const today      = new Date();
    const dateRu     = `${String(today.getDate()).padStart(2,'0')}.${String(today.getMonth()+1).padStart(2,'0')}.${today.getFullYear()}`;

    const auth       = await getAuth(true);
    const sheets     = sheetsAPI({ version: 'v4', auth });
    const sheetRange = process.env.SHEET_RANGE || 'Scans!A:Z';
    const sheetName  = sheetRange.split('!')[0];

    // 1) Читаем Scans, проставляем только status='отправлено'
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SCANS_SPREADSHEET_ID,
      range: sheetRange,
    });
    const rows = readRes.data.values || [];
    if (rows.length < 2) return res.status(500).json({ error: 'Таблица Scans пуста' });

    const rawHeaders = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
    const trackCol   = rawHeaders.indexOf('tracknumber');
    const statusCol  = rawHeaders.indexOf('status');

    if (trackCol === -1 || statusCol === -1) {
      return res.status(500).json({ error: 'Не найдены колонки TrackNumber / Status в Scans' });
    }

    const trackIndex = {};
    rows.slice(1).forEach((row, i) => {
      const t = (row[trackCol] || '').toString().trim();
      if (t) { if (!trackIndex[t]) trackIndex[t] = []; trackIndex[t].push(i + 2); }
    });

    const updated = []; const notFound = []; const alreadyShipped = [];
    const batchData = [];

    for (const track of tracks) {
      const rowNums = trackIndex[track];
      if (!rowNums) { notFound.push(track); continue; }
      for (const rowNum of rowNums) {
        const currentStatus = (rows[rowNum - 1][statusCol] || '').toString().trim();
        if (normStatus(currentStatus) === 'shipped') { alreadyShipped.push(track); continue; }
        batchData.push({ range: `${sheetName}!${toLetterCol(statusCol)}${rowNum}`, values: [['отправлено']] });
        updated.push(track);
      }
    }

    if (batchData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SCANS_SPREADSHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
      });
    }

    // 2) Пишем привязки трек→груз в лист «Отправления»
    try {
      await ensureOtpravleniyaSheet(sheets);
      const otpRows = updated.map(track => [dateRu, cargoNumber, track, clientId, operatorName]);
      if (otpRows.length > 0) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: SCANS_SPREADSHEET_ID,
          range: `${OTPRAVLENIYA_SHEET}!A:E`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: otpRows },
        });
        invalidateOtpravleniyaCache();
      }
    } catch (otpErr) {
      console.warn('[/admin/shipments POST] Отправления:', otpErr.message);
    }

    // 3) Добавляем строку в «送货 Логистика» с фиксированными адресами ячеек:
    //    A=Дата, B=ID клиента, E=Номер груза
    let cargoRowAdded = false;
    try {
      const colARes = await sheets.spreadsheets.values.get({
        spreadsheetId: LOGISTICS_SPREADSHEET_ID,
        range: `'${LOGISTICS_CARGO_SHEET}'!A:A`,
      });
      const nextRow  = (colARes.data.values || []).length + 1;
      const logBatch = [
        { range: `'${LOGISTICS_CARGO_SHEET}'!A${nextRow}`, values: [[dateRu]] },
        { range: `'${LOGISTICS_CARGO_SHEET}'!B${nextRow}`, values: [[clientId]] },
      ];
      if (cargoNumber) {
        logBatch.push({ range: `'${LOGISTICS_CARGO_SHEET}'!E${nextRow}`, values: [[cargoNumber]] });
      }
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: LOGISTICS_SPREADSHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: logBatch },
      });
      invalidateCargoCache();
      cargoRowAdded = true;
    } catch (cargoErr) {
      console.warn('[/admin/shipments POST] Логистика:', cargoErr.message);
    }

    invalidateCache();

    addOpLog({
      ts: created_at, operator: operatorName, status: 'отправлено',
      cargo_number: cargoNumber, client_id: clientId,
      submitted: tracks.length + duplicates.length, updated: updated.length,
      notFound, duplicates, alreadyShipped,
    });

    res.json({
      cargo_number: cargoNumber,
      cargo_row_added: cargoRowAdded,
      updated: updated.length,
      notFound, duplicates, alreadyShipped,
    });
  } catch (err) {
    console.error('[/admin/shipments POST]', err.message);
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

// Маппинг строки «Логистики» в форму, ожидаемую фронтом отгрузок.
// shipment_id == cargo_number — единый идентификатор груза/отгрузки.
function cargoToShipment(c) {
  return {
    shipment_id:   c.cargo_number,
    shipment_code: c.cargo_number,
    client_id:     c.client_id    || '',
    shipped_at:    c.date         || '',
    arrival:       c.arrival      || '',
    total_places:  c.places       || '',
    total_weight:  c.weight       || '',
    total_volume:  c.volume       || '',
    density:       c.density      || '',
    price_per_kg:  c.price_per_kg || '',
    cargo_cost:    c.cargo_cost   || '',
    insurance_pct: c.insurance_pct|| '',
    insurance_usd: c.insurance_usd|| '',
    packaging:     c.packaging    || '',
    loading:       c.loading      || '',
    total:         c.total        || '',
    category:      c.category     || '',
    route:         c.route        || '',
    carrier:       c.carrier      || '',
    status:        c.status       || '',
    comment:       c.comment      || '',
  };
}

// POST /api/admin/shipments/backfill-arrivals — авто-проставить дату прибытия и статус «доставлено»
// для всех грузов до марта 2026 без даты прибытия.
app.post('/api/admin/shipments/backfill-arrivals', requireRole('admin', 'employee'), async (req, res) => {
  try {
    const { data: cargos, rawHeaders } = await getAllCargo(true);
    const auth   = await getAuth(true);
    const sheets = sheetsAPI({ version: 'v4', auth });
    const cutoff = new Date(2026, 2, 1); // 2026-03-01

    const arrivalLetter = toLetterCol(CARGO_COLS.arrival);
    const statusLetter  = toLetterCol(CARGO_COLS.status);

    const batchData = [];
    let count = 0;

    cargos.forEach(r => {
      const rowNum     = r._row;
      const shippedRaw = getCol(r, CARGO_COLS.date);
      const arrivalRaw = getCol(r, CARGO_COLS.arrival);
      if (arrivalRaw) return;                         // уже есть — пропускаем
      if (!shippedRaw) return;                        // нет даты отправки
      const shipped = parseItemDate(shippedRaw);
      if (!shipped || shipped >= cutoff) return;      // позже марта 2026

      const arrDate = new Date(shipped);
      arrDate.setDate(arrDate.getDate() + 30);
      const dd = String(arrDate.getDate()).padStart(2, '0');
      const mm = String(arrDate.getMonth() + 1).padStart(2, '0');
      const yyyy = arrDate.getFullYear();
      const arrStr = `${dd}.${mm}.${yyyy}`;

      batchData.push({ range: `${LOGISTICS_CARGO_SHEET}!${arrivalLetter}${rowNum}`, values: [[arrStr]] });
      batchData.push({ range: `${LOGISTICS_CARGO_SHEET}!${statusLetter}${rowNum}`,  values: [['доставлено']] });
      count++;
    });

    if (!batchData.length) return res.json({ ok: true, updated: 0 });

    // Разбиваем на чанки по 500 (лимит Sheets API)
    for (let i = 0; i < batchData.length; i += 500) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: LOGISTICS_SPREADSHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: batchData.slice(i, i + 500) },
      });
    }

    invalidateCargoCache();
    res.json({ ok: true, updated: count });
  } catch (err) {
    console.error('[backfill-arrivals]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/debug/cargo-headers — заголовки листа Логистика (для диагностики).
app.get('/api/admin/debug/cargo-headers', requireRole('admin', 'employee'), async (req, res) => {
  try {
    const { rawHeaders, data } = await getAllCargo(true);
    const sample = data.find(r => (r[rawHeaders.find(h => h.includes('货物编号') || h.includes('номер_груза'))] || '').includes(req.query.id || ''));
    res.json({ headers: rawHeaders, sample: sample || data[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/admin/shipments — список отгрузок (читаем из «Логистики»).
app.get('/api/admin/shipments', requireRole('admin', 'employee'), async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 2000);
    const page   = Math.max(parseInt(req.query.page)  || 1, 1);
    const status = (req.query.status || '').toLowerCase();

    const { data: cargos } = await getAllCargo();
    let data = cargos.map(normalizeCargoRow)
      .filter(c => c.cargo_number)
      .map(cargoToShipment);

    if (status) data = data.filter(s => (s.status || '').toLowerCase() === status);
    data = data.sort((a, b) => {
      const da = parseItemDate(a.shipped_at), db = parseItemDate(b.shipped_at);
      if (da && db) return db - da;
      return (b.shipment_id || '').localeCompare(a.shipment_id || '');
    });

    const total  = data.length;
    const offset = (page - 1) * limit;
    res.json({ total, page, pages: Math.ceil(total / limit) || 1, data: data.slice(offset, offset + limit) });
  } catch (err) {
    console.error('[/admin/shipments GET]', err.message);
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

// GET /api/admin/shipments/:id — детали груза + связанные треки.
// Треки ищем в листе «Отправления» по cargo_number.
app.get('/api/admin/shipments/:id', requireRole('admin', 'employee'), async (req, res) => {
  try {
    const id = req.params.id;

    const { data: cargos } = await getAllCargo();
    const cargo = cargos.map(normalizeCargoRow).find(c => c.cargo_number === id);
    if (!cargo) return res.status(404).json({ error: 'Груз не найден' });

    const otpRows    = await getOtpravleniya();
    const trackNums  = new Set(otpRows.filter(r => r.cargo_number === id).map(r => r.track));

    const { data: allData } = await getAllData();
    const tracks = allData.filter(r => trackNums.has(r.track_number));

    res.json({ shipment: cargoToShipment(cargo), tracks });
  } catch (err) {
    console.error('[/admin/shipments/:id GET]', err.message);
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

// PATCH /api/admin/shipments/:id — обновить поля груза в «Логистике».
app.patch('/api/admin/shipments/:id', requireRole('admin', 'employee'), async (req, res) => {
  try {
    if (USE_MOCK) return res.json({ ok: true });
    const id = req.params.id;
    const body = req.body;

    const auth   = await getAuth(true);
    const sheets = sheetsAPI({ version: 'v4', auth });

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: LOGISTICS_SPREADSHEET_ID,
      range: `${LOGISTICS_CARGO_SHEET}!A:AM`,
    });
    const rows = readRes.data.values || [];
    if (rows.length < 2) return res.status(404).json({ error: 'Лист «Логистика» пуст' });

    const headers = rows[0].map(h => h.toString().trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '_'));
    const findCol = (...kw) => headers.findIndex(h => kw.some(k => h.includes(k)));

    const cargoCol  = findCol('货物编号', 'номер_груза');
    if (cargoCol === -1) return res.status(500).json({ error: 'Колонка номера груза не найдена' });

    const rowIdx = rows.slice(1).findIndex(r => (r[cargoCol] || '').toString().trim() === id);
    if (rowIdx === -1) return res.status(404).json({ error: 'Груз не найден' });
    const rowNum = rowIdx + 2;

    // Фиксированная карта: поле запроса → индекс колонки
    const fieldColMap = {
      shipped_at:    CARGO_COLS.date,
      client_id:     CARGO_COLS.client_id,
      category:      CARGO_COLS.category,
      total_places:  CARGO_COLS.places,
      total_weight:  CARGO_COLS.weight,
      total_volume:  CARGO_COLS.volume,
      price_per_kg:  CARGO_COLS.price_per_kg,
      density:       CARGO_COLS.density,
      cargo_cost:    CARGO_COLS.cargo_cost,
      insurance_pct: CARGO_COLS.insurance_pct,
      insurance_usd: CARGO_COLS.insurance_usd,
      packaging:     CARGO_COLS.packaging,
      loading:       CARGO_COLS.loading,
      total:         CARGO_COLS.total,
      status:        CARGO_COLS.status,
      arrival:       CARGO_COLS.arrival,
      route:         CARGO_COLS.route,
      carrier:       CARGO_COLS.carrier,
      comment:       CARGO_COLS.comment,
    };

    const batchData = [];
    for (const [field, colIdx] of Object.entries(fieldColMap)) {
      if (body[field] === undefined) continue;
      batchData.push({ range: `${LOGISTICS_CARGO_SHEET}!${toLetterCol(colIdx)}${rowNum}`, values: [[body[field]]] });
    }

    if (batchData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: LOGISTICS_SPREADSHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
      });
    }

    invalidateCargoCache();

    // Push-уведомление клиенту при изменении статуса
    if (body.status !== undefined) {
      const row      = rows[rowIdx + 1];
      const clientId = (row[CARGO_COLS.client_id] || '').toString().trim();
      if (clientId) {
        const statusLabels = {
          'отправлено':  { title: 'Груз отправлен', body: `Груз ${id} отправлен` },
          'доставлено':  { title: 'Груз доставлен', body: `Груз ${id} прибыл. Можете забрать.` },
          'на складе':   { title: 'Груз на складе', body: `Груз ${id} принят на склад` },
        };
        const statusKey = body.status.toLowerCase();
        const msg = statusLabels[statusKey] || { title: 'Статус обновлён', body: `Груз ${id}: ${body.status}` };
        sendPushToClient(clientId, msg.title, msg.body, { url: '/dashboard.html', tag: `cargo-${id}` })
          .catch(() => {});
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[/admin/shipments/:id PATCH]', err.message);
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

// ── Admin user management ─────────────────────────────────────────────────────

// GET /api/admin/users — list all users
app.get('/api/admin/users', requireRole('admin'), async (req, res) => {
  try {
    const users = await getAllUsers(true);
    const safe  = users.map(({ password_hash, _mock_pw, ...u }) => u);
    res.json({ total: safe.length, data: safe });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/users — create new user, return generated password
app.post('/api/admin/users', requireRole('admin'), async (req, res) => {
  try {
    const { client_id, role = 'client', full_name = '', lang = 'ru' } = req.body;
    if (!client_id) return res.status(400).json({ error: 'Укажите client_id' });

    const users    = await getAllUsers(true);
    const loginLow = client_id.toLowerCase();
    const exists   = users.find(u =>
      (u.username || '').toLowerCase() === loginLow ||
      (u.client_id || '').toLowerCase() === loginLow
    );
    if (exists) return res.status(409).json({ error: `Клиент ${client_id} уже существует` });

    const password = require('crypto').randomBytes(4).toString('hex');
    const hash     = await bcrypt.hash(password, 10);
    const now      = new Date().toISOString();
    const row      = [client_id, client_id, hash, role, full_name, '', '', lang, 'true', now, ''];

    if (!USE_MOCK) {
      const auth   = await getAuth(true);
      const sheets = sheetsAPI({ version: 'v4', auth });
      await sheets.spreadsheets.values.append({
        spreadsheetId: LOGISTICS_SPREADSHEET_ID,
        range: `${USERS_SHEET_NAME}!A:K`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
      invalidateUsersCache();
      writeToPasswordsSheet(client_id, password, role === 'client' ? 'Клиент' : role, '').catch(() => {});
    }

    res.json({ ok: true, client_id, password, role });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/admin/users/:username — update active status or full_name
app.patch('/api/admin/users/:username', requireRole('admin'), async (req, res) => {
  try {
    const { active, full_name, lang } = req.body;
    const users = await getAllUsers(true);
    const user  = users.find(u => (u.username || '').toLowerCase() === req.params.username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    if (!USE_MOCK) {
      const rows = await fetchUsersRows();
      const headers = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
      const auth   = await getAuth(true);
      const sheets = sheetsAPI({ version: 'v4', auth });
      const batch  = [];

      if (active !== undefined) {
        const col = headers.indexOf('active');
        if (col !== -1) batch.push({ range: `${USERS_SHEET_NAME}!${toLetterCol(col)}${user._row}`, values: [[String(active)]] });
      }
      if (full_name !== undefined) {
        const col = headers.indexOf('full_name');
        if (col !== -1) batch.push({ range: `${USERS_SHEET_NAME}!${toLetterCol(col)}${user._row}`, values: [[full_name]] });
      }
      if (lang !== undefined) {
        const col = headers.indexOf('lang');
        if (col !== -1) batch.push({ range: `${USERS_SHEET_NAME}!${toLetterCol(col)}${user._row}`, values: [[lang]] });
      }

      if (batch.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: LOGISTICS_SPREADSHEET_ID,
          requestBody: { valueInputOption: 'USER_ENTERED', data: batch },
        });
        invalidateUsersCache();
      }
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/admin/users/:username/reset-password
app.post('/api/admin/users/:username/reset-password', requireRole('admin'), async (req, res) => {
  try {
    const users = await getAllUsers(true);
    const user  = users.find(u => (u.username || '').toLowerCase() === req.params.username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const password = require('crypto').randomBytes(4).toString('hex');
    const hash     = await bcrypt.hash(password, 10);

    if (!USE_MOCK) {
      const rows = await fetchUsersRows();
      const headers = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
      const col  = headers.indexOf('password_hash');
      if (col === -1) return res.status(500).json({ error: 'Колонка password_hash не найдена' });
      const auth   = await getAuth(true);
      const sheets = sheetsAPI({ version: 'v4', auth });
      await sheets.spreadsheets.values.update({
        spreadsheetId: LOGISTICS_SPREADSHEET_ID,
        range: `${USERS_SHEET_NAME}!${toLetterCol(col)}${user._row}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[hash]] },
      });
      invalidateUsersCache();
      writeToPasswordsSheet(req.params.username, password, '', 'сброс пароля').catch(() => {});
    }

    res.json({ ok: true, password });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Push notifications ────────────────────────────────────────────────────────

async function ensurePushSubsSheet(sheetsClient) {
  try {
    await sheetsClient.spreadsheets.values.get({
      spreadsheetId: LOGISTICS_SPREADSHEET_ID,
      range: `${PUSH_SUBS_SHEET}!A1`,
    });
  } catch {
    await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId: LOGISTICS_SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: PUSH_SUBS_SHEET } } }] },
    });
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: LOGISTICS_SPREADSHEET_ID,
      range: `${PUSH_SUBS_SHEET}!A1:E1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['client_id', 'endpoint', 'p256dh', 'auth', 'created_at']] },
    });
  }
}

async function loadPushSubs() {
  if (USE_MOCK || !VAPID_PUBLIC_KEY) return;
  try {
    const auth   = await getAuth(false);
    const sheets = sheetsAPI({ version: 'v4', auth });
    const res    = await sheets.spreadsheets.values.get({
      spreadsheetId: LOGISTICS_SPREADSHEET_ID,
      range: `${PUSH_SUBS_SHEET}!A:E`,
    });
    pushSubsCache.clear();
    const rows = (res.data.values || []).slice(1);
    for (const [clientId, endpoint, p256dh, auth_key] of rows) {
      if (!clientId || !endpoint) continue;
      if (!pushSubsCache.has(clientId)) pushSubsCache.set(clientId, new Map());
      pushSubsCache.get(clientId).set(endpoint, { endpoint, keys: { p256dh, auth: auth_key } });
    }
    console.log(`  [push] Загружено подписок: ${rows.length}`);
  } catch (e) {
    console.warn('[push] Не удалось загрузить подписки:', e.message);
  }
}

async function sendPushToClient(clientId, title, body, extra = {}) {
  if (!VAPID_PUBLIC_KEY) return;
  const subs = pushSubsCache.get(clientId);
  if (!subs || subs.size === 0) return;
  const payload = JSON.stringify({ title, body, ...extra });
  const stale   = [];
  for (const [endpoint, sub] of subs) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) stale.push(endpoint);
      else console.warn('[push] send error:', e.message);
    }
  }
  stale.forEach(ep => subs.delete(ep));
}

// GET /api/push/vapid-key — публичный ключ VAPID для фронтенда
app.get('/api/push/vapid-key', (_req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push не настроен' });
  res.json({ key: VAPID_PUBLIC_KEY });
});

// POST /api/push/subscribe — сохранить подписку (только для авторизованных клиентов)
app.post('/api/push/subscribe', requireAuth, async (req, res) => {
  if (!VAPID_PUBLIC_KEY) return res.status(503).json({ error: 'Push не настроен' });
  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Неверная подписка' });

  const clientId = req.user.client_id || req.user.username;
  if (!pushSubsCache.has(clientId)) pushSubsCache.set(clientId, new Map());
  pushSubsCache.get(clientId).set(subscription.endpoint, subscription);

  if (!USE_MOCK) {
    try {
      const auth   = await getAuth(true);
      const sheets = sheetsAPI({ version: 'v4', auth });
      await ensurePushSubsSheet(sheets);
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: LOGISTICS_SPREADSHEET_ID,
        range: `${PUSH_SUBS_SHEET}!B:B`,
      });
      const endpoints = (existing.data.values || []).flat();
      if (!endpoints.includes(subscription.endpoint)) {
        await sheets.spreadsheets.values.append({
          spreadsheetId: LOGISTICS_SPREADSHEET_ID,
          range: `${PUSH_SUBS_SHEET}!A:E`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [[
              clientId,
              subscription.endpoint,
              subscription.keys?.p256dh || '',
              subscription.keys?.auth   || '',
              new Date().toISOString(),
            ]],
          },
        });
      }
    } catch (e) {
      console.warn('[push] Ошибка сохранения подписки:', e.message);
    }
  }

  res.json({ ok: true });
});

// POST /api/admin/push/send — вручную отправить уведомление клиенту (admin/employee)
app.post('/api/admin/push/send', requireRole('admin', 'employee'), async (req, res) => {
  const { client_id, title, body } = req.body;
  if (!client_id || !title) return res.status(400).json({ error: 'client_id и title обязательны' });
  await sendPushToClient(client_id, title, body || '');
  res.json({ ok: true });
});

// ── Polling Google Sheets → push при новых посылках на складе ────────────────

const SCAN_POLL_MS = 30 * 60 * 1000; // каждые 30 минут
let scanBaseline   = null;           // кол-во строк при старте (не уведомляем старые)

async function initScanBaseline() {
  if (!VAPID_PUBLIC_KEY || USE_MOCK) return;
  try {
    const auth   = await getAuth(false);
    const sheets = sheetsAPI({ version: 'v4', auth });
    const res    = await sheets.spreadsheets.values.get({
      spreadsheetId: SCANS_SPREADSHEET_ID,
      range: 'Scans!A:A',
    });
    scanBaseline = Math.max(0, (res.data.values || []).length - 1);
    console.log(`  [push-poll] Базовая строка: ${scanBaseline}`);
  } catch (e) {
    console.warn('[push-poll] Не удалось инициализировать baseline:', e.message);
  }
}

async function pollScansAndNotify() {
  if (!VAPID_PUBLIC_KEY || USE_MOCK || scanBaseline === null) return;
  try {
    const auth   = await getAuth(false);
    const sheets = sheetsAPI({ version: 'v4', auth });
    const range  = process.env.SHEET_RANGE || 'Scans!A:Z';
    const res    = await sheets.spreadsheets.values.get({ spreadsheetId: SCANS_SPREADSHEET_ID, range });
    const rows   = res.data.values || [];
    if (rows.length < 2) return;

    const headers   = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
    const trackCol  = headers.indexOf('tracknumber');
    const statusCol = headers.indexOf('status');
    const clientCol = headers.indexOf('clientid');
    if (trackCol === -1 || statusCol === -1 || clientCol === -1) return;

    const dataRows  = rows.slice(1);
    const total     = dataRows.length;
    if (total <= scanBaseline) return;

    // Только новые строки — те что появились после последнего опроса
    const clientTracks = new Map();
    for (const row of dataRows.slice(scanBaseline)) {
      const status   = (row[statusCol] || '').toString().trim();
      const clientId = (row[clientCol] || '').toString().trim();
      const track    = (row[trackCol]  || '').toString().trim();
      if (!clientId || !track || normStatus(status) !== 'warehouse') continue;
      if (!clientTracks.has(clientId)) clientTracks.set(clientId, []);
      clientTracks.get(clientId).push(track);
    }

    for (const [clientId, list] of clientTracks) {
      const n     = list.length;
      const title = n === 1 ? '📦 Посылка прибыла на склад' : `📦 ${n} посылки прибыли на склад`;
      const body  = n === 1
        ? `Трек: ${list[0]}`
        : `${list.slice(0, 2).join(', ')}${n > 2 ? ` и ещё ${n - 2}` : ''}`;
      await sendPushToClient(clientId, title, body, { url: '/dashboard.html', tag: 'parcels-arrived' });
      console.log(`[push-poll] → ${clientId}: ${n} посылок`);
    }

    scanBaseline = total;
  } catch (e) {
    console.warn('[push-poll] Ошибка:', e.message);
  }
}

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ status: 'ok', mock: USE_MOCK, cached: !!cache.data }));

// SPA fallback
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  Logistics Portal v4  →  http://localhost:${PORT}`);
  console.log(`  Данные             →  ${USE_MOCK ? 'DEMO' : 'Google Sheets'}\n`);
  if (JWT_SECRET === 'dev-secret-change-in-prod') {
    console.warn('  ⚠  JWT_SECRET не задан — используется дефолтный ключ (небезопасно в проде)\n');
  }
  loadPushSubs();
  initScanBaseline().then(() => setInterval(pollScansAndNotify, SCAN_POLL_MS));
});
