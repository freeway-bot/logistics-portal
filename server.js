require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');
const bcrypt       = require('bcrypt');
const jwt          = require('jsonwebtoken');
const { google }   = require('googleapis');
const path         = require('path');

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
    return new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), scopes });
  }
  return new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_KEY_FILE || './credentials/service-account.json', scopes });
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
  const sheets = google.sheets({ version: 'v4', auth });
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
  const sheets = google.sheets({ version: 'v4', auth });
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
    const sheets = google.sheets({ version: 'v4', auth });
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
    const sheets = google.sheets({ version: 'v4', auth });
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

// ─── Shipments helpers ────────────────────────────────────────────────────────

const SHIPMENTS_SHEET_NAME = process.env.SHIPMENTS_SHEET_NAME || 'Shipments';

let shipmentsCache = { data: null, ts: 0 };
function invalidateShipmentsCache() { shipmentsCache.ts = 0; }

async function fetchShipmentsRows() {
  const auth   = await getAuth(false);
  const sheets = google.sheets({ version: 'v4', auth });
  const res    = await sheets.spreadsheets.values.get({
    spreadsheetId: SCANS_SPREADSHEET_ID,
    range: `${SHIPMENTS_SHEET_NAME}!A:J`,
  });
  return res.data.values || [];
}

function parseShipmentRows(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (row[i] !== undefined ? row[i] : '').toString().trim(); });
    return obj;
  }).filter(r => r.shipment_id);
}

async function getAllShipments() {
  if (USE_MOCK) return [];
  const now = Date.now();
  if (shipmentsCache.data && now - shipmentsCache.ts < CACHE_TTL) return shipmentsCache.data;
  const rows = await fetchShipmentsRows();
  const data = parseShipmentRows(rows);
  shipmentsCache = { data, ts: now };
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
  const sheets = google.sheets({ version: 'v4', auth });
  const res    = await sheets.spreadsheets.values.get({
    spreadsheetId: LOGISTICS_SPREADSHEET_ID,
    range: `${LOGISTICS_CARGO_SHEET}!A:Z`,
  });
  return res.data.values || [];
}

function parseCargoRows(rows) {
  if (!rows || rows.length < 2) return { rawHeaders: [], data: [] };
  const rawHeaders = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
  const data = rows.slice(1).map((row, idx) => {
    const obj = { _row: idx + 2 };
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
function normalizeCargoRow(r) {
  return {
    date:          findField(r, 'data', 'дата'),
    cargo_number:  findField(r, '货物编号', 'номер_груза'),
    category:      findField(r, '货物类型', 'категория'),
    places:        findField(r, '件数', 'место'),
    weight:        findField(r, '重量', 'вес'),
    volume:        findField(r, '体积', 'объем'),
    price_per_kg:  findField(r, '运费单价', 'цена_за'),
    density:       findField(r, '密度', 'плотность'),
    cargo_cost:    findField(r, '货值', 'стоимость_груза', 'стоимость'),
    insurance_pct: findField(r, '保险比例', 'страховка%'),
    insurance_usd: findField(r, '保险金额', 'страховка$'),
    packaging:     findField(r, '包装费', 'упаковка'),
    loading:       findField(r, '搬运费', 'погрузка'),
    total:         findField(r, '总计', 'итого'),
    status:        findField(r, 'статус'),
    arrival:       findField(r, '到货日期', 'прибытие'),
  };
}

// ─── Status normalization ─────────────────────────────────────────────────────

const STATUS_MAP_NORM = {
  'на складе':'warehouse','склад':'warehouse','received':'warehouse','in stock':'warehouse','warehouse':'warehouse','在仓库':'warehouse','仓库':'warehouse',
  'упаковано':'packed','packed':'packed','pack':'packed','已打包':'packed',
  'отправлено':'shipped','shipped':'shipped','sent':'shipped','delivered':'shipped','已发货':'shipped',
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
      const sheets = google.sheets({ version: 'v4', auth });
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

    if (USE_MOCK) {
      const prefix = clientId.toLowerCase() + '-';
      const data   = MOCK_CARGO.filter(r => (r.cargo_number || '').toLowerCase().startsWith(prefix));
      return res.json({ clientId, total: data.length, data });
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

    res.json({ clientId, total: data.length, data: data.map(normalizeCargoRow) });
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
    const sheets    = google.sheets({ version: 'v4', auth });
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

// POST /api/admin/shipments — create shipment
app.post('/api/admin/shipments', requireRole('admin', 'employee'), async (req, res) => {
  try {
    if (USE_MOCK) return res.json({ message: 'Mock-режим', shipment_id: 'SHIP-MOCK', updated: 0, notFound: [], duplicates: [], alreadyShipped: [] });

    const {
      tracks: rawTracks = [],
      shipment_code = '',
      shipped_at    = '',
      total_weight  = '',
      total_volume  = '',
      comment  = '',
      operator = '',
    } = req.body;
    const operatorName = operator || req.user?.username || 'unknown';

    const seen = new Set(); const duplicates = [];
    const tracks = rawTracks
      .map(t => t.toString().trim())
      .filter(t => { if (!t) return false; if (seen.has(t)) { duplicates.push(t); return false; } seen.add(t); return true; });

    if (tracks.length === 0) return res.status(400).json({ error: 'Список треков пуст' });

    const shipment_id = generateShipmentId();
    const created_at  = new Date().toISOString();
    const updateDate  = shipped_at || new Date().toLocaleDateString('en-US');

    const auth      = await getAuth(true);
    const sheets    = google.sheets({ version: 'v4', auth });
    const sheetRange = process.env.SHEET_RANGE || 'Scans!A:Z';
    const sheetName  = sheetRange.split('!')[0];

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SCANS_SPREADSHEET_ID,
      range: sheetRange,
    });
    const rows = readRes.data.values || [];
    if (rows.length < 2) return res.status(500).json({ error: 'Таблица пустая' });

    const rawHeaders    = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
    const trackCol      = rawHeaders.indexOf('tracknumber');
    const statusCol     = rawHeaders.indexOf('status');
    const dateCol       = rawHeaders.indexOf('timestamp');
    const sessionCol    = rawHeaders.indexOf('send_session');
    const commentCol    = rawHeaders.indexOf('comment');
    const shipmentIdCol = rawHeaders.indexOf('shipment_id');

    if (trackCol === -1 || statusCol === -1) {
      return res.status(500).json({ error: 'Не найдены колонки TrackNumber / Status' });
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
        if (dateCol       !== -1) batchData.push({ range: `${sheetName}!${toLetterCol(dateCol)}${rowNum}`,       values: [[updateDate]] });
        if (sessionCol    !== -1) batchData.push({ range: `${sheetName}!${toLetterCol(sessionCol)}${rowNum}`,    values: [[shipment_id]] });
        if (shipmentIdCol !== -1) batchData.push({ range: `${sheetName}!${toLetterCol(shipmentIdCol)}${rowNum}`, values: [[shipment_id]] });
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

    await sheets.spreadsheets.values.append({
      spreadsheetId: SCANS_SPREADSHEET_ID,
      range: `${SHIPMENTS_SHEET_NAME}!A:J`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[shipment_id, shipment_code, updateDate, total_weight, total_volume, updated.length, comment, operatorName, 'отправлено', created_at]] },
    });

    invalidateCache();
    invalidateShipmentsCache();

    addOpLog({
      ts: created_at, operator: operatorName, status: 'отправлено', send_session: shipment_id,
      comment, shipment_id, shipment_code,
      submitted: tracks.length + duplicates.length, updated: updated.length, notFound, duplicates, alreadyShipped,
    });

    res.json({ shipment_id, shipment_code, total_places: updated.length, updated: updated.length, notFound, duplicates, alreadyShipped });
  } catch (err) {
    console.error('[/admin/shipments POST]', err.message);
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

// GET /api/admin/shipments
app.get('/api/admin/shipments', requireRole('admin', 'employee'), async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
    const page   = Math.max(parseInt(req.query.page)  || 1, 1);
    const status = req.query.status || '';

    let data = await getAllShipments();
    if (status) data = data.filter(s => s.status === status);
    data = data.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    const total  = data.length;
    const offset = (page - 1) * limit;
    res.json({ total, page, pages: Math.ceil(total / limit) || 1, data: data.slice(offset, offset + limit) });
  } catch (err) {
    console.error('[/admin/shipments GET]', err.message);
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

// GET /api/admin/shipments/:id
app.get('/api/admin/shipments/:id', requireRole('admin', 'employee'), async (req, res) => {
  try {
    const id        = req.params.id;
    const shipments = await getAllShipments();
    const shipment  = shipments.find(s => s.shipment_id === id);
    if (!shipment) return res.status(404).json({ error: 'Отправка не найдена' });

    const { data: allData } = await getAllData();
    const tracks = allData.filter(r =>
      (r.shipment_id && r.shipment_id === id) ||
      (!r.shipment_id && r.send_session === id)
    );

    res.json({ shipment, tracks });
  } catch (err) {
    console.error('[/admin/shipments/:id GET]', err.message);
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

// PATCH /api/admin/shipments/:id
app.patch('/api/admin/shipments/:id', requireRole('admin', 'employee'), async (req, res) => {
  try {
    if (USE_MOCK) return res.json({ ok: true });
    const id = req.params.id;
    const { status, comment, total_weight, total_volume } = req.body;

    const auth   = await getAuth(true);
    const sheets = google.sheets({ version: 'v4', auth });

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SCANS_SPREADSHEET_ID,
      range: `${SHIPMENTS_SHEET_NAME}!A:J`,
    });
    const rows = readRes.data.values || [];
    if (rows.length < 2) return res.status(404).json({ error: 'Лист отправок пуст' });

    const headers = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
    const idCol   = headers.indexOf('shipment_id');
    if (idCol === -1) return res.status(500).json({ error: 'Колонка shipment_id не найдена' });

    const rowIdx = rows.slice(1).findIndex(r => (r[idCol] || '') === id);
    if (rowIdx === -1) return res.status(404).json({ error: 'Отправка не найдена' });
    const rowNum = rowIdx + 2;

    const batchData = [];
    const colUpdate = (name, value) => {
      const col = headers.indexOf(name);
      if (col !== -1) batchData.push({ range: `${SHIPMENTS_SHEET_NAME}!${toLetterCol(col)}${rowNum}`, values: [[value]] });
    };

    if (status       !== undefined) colUpdate('status',       status);
    if (comment      !== undefined) colUpdate('comment',      comment);
    if (total_weight !== undefined) colUpdate('total_weight', total_weight);
    if (total_volume !== undefined) colUpdate('total_volume', total_volume);

    if (batchData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SCANS_SPREADSHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
      });
    }

    invalidateShipmentsCache();
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
      const sheets = google.sheets({ version: 'v4', auth });
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
      const sheets = google.sheets({ version: 'v4', auth });
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
      const sheets = google.sheets({ version: 'v4', auth });
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
});
