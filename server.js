require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { google } = require('googleapis');
const path = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const CACHE_TTL = (parseInt(process.env.CACHE_TTL_SECONDS) || 60) * 1000;
const USE_MOCK  = process.env.USE_MOCK_DATA === 'true';

// Allow requests from Netlify frontend (or any origin if ALLOWED_ORIGINS is *)
const rawOrigins = process.env.ALLOWED_ORIGINS || '*';
app.use(cors({
  origin: rawOrigins === '*' ? true : rawOrigins.split(',').map(s => s.trim()),
  credentials: true,
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_DATA = [
  { client_id: 'CLIENT001', track_number: 'TRK-2024-001', status: 'на складе',  date: '2024-03-01', category: 'Электроника', comment: 'Хрупкое', photo_1: '', photo_2: '', send_session: 'SS-03', box_number: '' },
  { client_id: 'CLIENT001', track_number: 'TRK-2024-002', status: 'на складе',  date: '2024-03-03', category: 'Одежда',      comment: '', photo_1: '', photo_2: '', send_session: 'SS-03', box_number: '' },
  { client_id: 'CLIENT001', track_number: 'TRK-2024-003', status: 'упаковано',  date: '2024-03-05', category: 'Игрушки',     comment: '', photo_1: '', photo_2: '', send_session: 'SS-03', box_number: 'BOX-01' },
  { client_id: 'CLIENT001', track_number: 'TRK-2024-004', status: 'упаковано',  date: '2024-03-05', category: 'Одежда',      comment: '', photo_1: '', photo_2: '', send_session: 'SS-03', box_number: 'BOX-01' },
  { client_id: 'CLIENT001', track_number: 'TRK-2024-005', status: 'отправлено', date: '2024-02-20', category: 'Косметика',   comment: '', photo_1: '', photo_2: '', send_session: 'SS-02', box_number: 'BOX-02' },
  { client_id: 'CLIENT002', track_number: 'TRK-2024-010', status: 'на складе',  date: '2024-03-07', category: 'Электроника', comment: '', photo_1: '', photo_2: '', send_session: '', box_number: '' },
  { client_id: 'CLIENT002', track_number: 'TRK-2024-011', status: 'отправлено', date: '2024-03-01', category: 'Одежда',      comment: '', photo_1: '', photo_2: '', send_session: 'SS-03', box_number: 'BOX-05' },
];

// ─── Google Sheets auth ───────────────────────────────────────────────────────

// Read+Write scope for admin updates
const SCOPES_RW = ['https://www.googleapis.com/auth/spreadsheets'];
const SCOPES_RO = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

async function getAuth(write = false) {
  const scopes = write ? SCOPES_RW : SCOPES_RO;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), scopes });
  }
  return new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_KEY_FILE || './credentials/service-account.json', scopes });
}

// ─── Column mapping ───────────────────────────────────────────────────────────

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
    spreadsheetId: process.env.SPREADSHEET_ID,
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

// ─── Cache ────────────────────────────────────────────────────────────────────

let cache = { rawHeaders: [], data: null, ts: 0 };

// ─── Operation log ────────────────────────────────────────────────────────────

const opLog = [];
const OP_LOG_MAX = 500;

function addOpLog(entry) {
  opLog.unshift({ id: Date.now(), ...entry });
  if (opLog.length > OP_LOG_MAX) opLog.length = OP_LOG_MAX;
}

async function getAllData() {
  if (USE_MOCK) return { rawHeaders: [], data: MOCK_DATA };
  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_TTL) return cache;
  const rows   = await fetchSheetRows();
  const parsed = parseRows(rows);
  cache = { ...parsed, ts: now };
  return cache;
}

function invalidateCache() { cache.ts = 0; }

// ─── Shipments helpers ────────────────────────────────────────────────────────

const SHIPMENTS_SHEET_NAME = process.env.SHIPMENTS_SHEET_NAME || 'Shipments';

let shipmentsCache = { data: null, ts: 0 };
function invalidateShipmentsCache() { shipmentsCache.ts = 0; }

async function fetchShipmentsRows() {
  const auth   = await getAuth(false);
  const sheets = google.sheets({ version: 'v4', auth });
  const res    = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
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

// ─── Status normalization ─────────────────────────────────────────────────────

const STATUS_MAP_NORM = {
  'на складе':'warehouse','склад':'warehouse','received':'warehouse','in stock':'warehouse','warehouse':'warehouse','在仓库':'warehouse','仓库':'warehouse',
  'упаковано':'packed','packed':'packed','pack':'packed','已打包':'packed',
  'отправлено':'shipped','shipped':'shipped','sent':'shipped','delivered':'shipped','已发货':'shipped',
};

function normStatus(s) { return STATUS_MAP_NORM[(s||'').toLowerCase().trim()] || 'other'; }

// ─── Sort helper ──────────────────────────────────────────────────────────────

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

// ─── Date helpers ─────────────────────────────────────────────────────────────

function parseItemDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return startOfDay(d); }

// ─── ═══════════════════ API ROUTES ═══════════════════ ────────────────────────

// GET /api/client/:clientId
app.get('/api/client/:clientId', async (req, res) => {
  try {
    const clientId = (req.params.clientId || '').trim();
    if (!clientId) return res.status(400).json({ error: 'Client ID не указан' });

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
  } catch (err) { console.error('[/client]', err.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// GET /api/search?track=XXX
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

// GET /api/admin/stats — aggregate metrics for dashboard
app.get('/api/admin/stats', async (req, res) => {
  try {
    const { data: allData } = await getAllData();
    const now      = new Date();
    const today    = startOfDay(now);
    const yesterday= daysAgo(1);
    const week7    = daysAgo(7);

    // Status counts
    const byStatus = { warehouse: 0, packed: 0, shipped: 0, other: 0 };
    allData.forEach(r => { const n = normStatus(r.status); byStatus[n] = (byStatus[n]||0)+1; });

    // Date-based
    let addedToday=0, addedYesterday=0, shippedToday=0, shippedWeek=0;
    const clientsOnWarehouse = new Set();

    allData.forEach(r => {
      const d = parseItemDate(r.date);
      if (d) {
        if (d >= today)     addedToday++;
        const yStart = daysAgo(1), yEnd = today;
        if (d >= yStart && d < yEnd) addedYesterday++;
      }
      if (normStatus(r.status) === 'shipped' && d) {
        if (d >= today) shippedToday++;
        if (d >= week7) shippedWeek++;
      }
      if (normStatus(r.status) === 'warehouse' && r.client_id) {
        clientsOnWarehouse.add(r.client_id.toLowerCase());
      }
    });

    // Problems
    const problems = {
      noStatus:    allData.filter(r => !r.status).length,
      noClientId:  allData.filter(r => !r.client_id).length,
      noTrack:     allData.filter(r => !r.track_number).length,
      duplicates:  (() => {
        const seen = {}; let dups = 0;
        allData.forEach(r => { if (r.track_number) { seen[r.track_number] = (seen[r.track_number]||0)+1; } });
        Object.values(seen).forEach(c => { if (c > 1) dups += c - 1; });
        return dups;
      })(),
    };

    // Top clients by warehouse count
    const clientWarehouse = {};
    allData.forEach(r => {
      if (normStatus(r.status) === 'warehouse' && r.client_id) {
        clientWarehouse[r.client_id] = (clientWarehouse[r.client_id]||0)+1;
      }
    });
    const topClients = Object.entries(clientWarehouse)
      .sort((a,b) => b[1]-a[1]).slice(0,10)
      .map(([id, count]) => ({ id, count }));

    // Status distribution for chart
    const statusDist = Object.entries(byStatus).map(([status, count]) => ({ status, count }));

    res.json({
      total:            allData.length,
      addedToday,
      addedYesterday,
      warehouse:        byStatus.warehouse,
      packed:           byStatus.packed,
      shipped:          byStatus.shipped,
      shippedToday,
      shippedWeek,
      uniqueClients:    clientsOnWarehouse.size,
      problems,
      topClients,
      statusDist,
    });
  } catch (err) { console.error('[/admin/stats]', err.message); res.status(500).json({ error: 'Ошибка' }); }
});

// GET /api/admin/recent?limit=10 — latest arrivals and shipments
app.get('/api/admin/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit)||10, 50);
    const { data: allData } = await getAllData();

    const sorted    = sortData(allData, 'date', 'desc');
    const recent    = sorted.slice(0, limit);
    const recentShipped = sortData(
      allData.filter(r => normStatus(r.status) === 'shipped'), 'date', 'desc'
    ).slice(0, limit);

    res.json({ recent, recentShipped });
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

// GET /api/admin/daily?days=14 — daily breakdown for chart
app.get('/api/admin/daily', async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days)||14, 60);
    const { data: allData } = await getAllData();

    const result = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = daysAgo(i);
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

// POST /api/admin/upload — bulk status update
// Body: { tracks: ["T1","T2"], status: "отправлено", date, send_session, comment, operator }
app.post('/api/admin/upload', async (req, res) => {
  try {
    if (USE_MOCK) return res.json({ message: 'Mock-режим: запись в таблицу недоступна', updated: 0, notFound: [], duplicates: [], alreadyShipped: [] });

    const { tracks: rawTracks = [], status = 'отправлено', date = '', send_session = '', comment = '', operator = '' } = req.body;

    // Clean + deduplicate input
    const seen = new Set(); const duplicates = [];
    const tracks = rawTracks
      .map(t => t.toString().trim())
      .filter(t => {
        if (!t) return false;
        if (seen.has(t)) { duplicates.push(t); return false; }
        seen.add(t); return true;
      });

    if (tracks.length === 0) return res.status(400).json({ error: 'Список треков пуст' });

    // Fetch full sheet (with row indices)
    const auth   = await getAuth(true);
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetRange = process.env.SHEET_RANGE || 'Scans!A:Z';
    const sheetName  = sheetRange.split('!')[0];

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: sheetRange,
    });
    const rows = readRes.data.values || [];
    if (rows.length < 2) return res.status(500).json({ error: 'Таблица пустая' });

    const rawHeaders  = rows[0].map(h => h.toString().trim().toLowerCase().replace(/\s+/g, '_'));
    const trackCol    = rawHeaders.indexOf('tracknumber');
    const statusCol   = rawHeaders.indexOf('status');
    const dateCol     = rawHeaders.indexOf('timestamp');
    const sessionCol  = rawHeaders.indexOf('send_session') !== -1 ? rawHeaders.indexOf('send_session') : -1;
    const commentCol  = rawHeaders.indexOf('comment');

    if (trackCol === -1 || statusCol === -1) {
      return res.status(500).json({ error: 'Не найдены колонки TrackNumber / Status в таблице' });
    }

    // Build lookup: track → row index (1-based, header is row 1)
    const trackIndex = {}; // track → [rowNumber, ...]
    rows.slice(1).forEach((row, i) => {
      const t = (row[trackCol] || '').toString().trim();
      if (t) { if (!trackIndex[t]) trackIndex[t] = []; trackIndex[t].push(i + 2); } // +2: 1 for header, 1 for 0-index
    });

    const updated = []; const notFound = []; const alreadyShipped = [];
    const batchData = [];
    const updateDate    = date || new Date().toLocaleDateString('en-US');
    const toLetterCol   = n => { let s=''; n++; while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-1)/26);} return s; };

    for (const track of tracks) {
      const rowNums = trackIndex[track];
      if (!rowNums) { notFound.push(track); continue; }

      for (const rowNum of rowNums) {
        const currentStatus = (rows[rowNum - 1][statusCol] || '').toString().trim();
        if (normStatus(currentStatus) === 'shipped') { alreadyShipped.push(track); continue; }

        // Update status
        batchData.push({ range: `${sheetName}!${toLetterCol(statusCol)}${rowNum}`, values: [[status]] });
        // Update date
        if (dateCol !== -1) batchData.push({ range: `${sheetName}!${toLetterCol(dateCol)}${rowNum}`, values: [[updateDate]] });
        // Update send_session
        if (sessionCol !== -1 && send_session) batchData.push({ range: `${sheetName}!${toLetterCol(sessionCol)}${rowNum}`, values: [[send_session]] });
        // Update comment (append)
        if (commentCol !== -1 && comment) {
          const existing = (rows[rowNum - 1][commentCol] || '').toString().trim();
          const newComment = existing ? `${existing}; ${comment}` : comment;
          batchData.push({ range: `${sheetName}!${toLetterCol(commentCol)}${rowNum}`, values: [[newComment]] });
        }
        updated.push(track);
      }
    }

    // Execute batch update
    if (batchData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: process.env.SPREADSHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
      });
    }

    invalidateCache();

    // Log operation
    const logEntry = {
      ts:           new Date().toISOString(),
      operator:     operator || 'unknown',
      status,
      send_session,
      comment,
      submitted:    tracks.length + duplicates.length,
      updated:      updated.length,
      notFound,
      duplicates,
      alreadyShipped,
    };
    console.log('[UPLOAD]', JSON.stringify({
      ts: logEntry.ts, operator: logEntry.operator, status, send_session,
      submitted: logEntry.submitted, updated: logEntry.updated,
      notFound: notFound.length, duplicates: duplicates.length,
    }));
    addOpLog(logEntry);

    res.json({
      submitted:    tracks.length + duplicates.length,
      updated:      updated.length,
      notFound,
      duplicates,
      alreadyShipped,
    });
  } catch (err) {
    console.error('[/admin/upload]', err.message);
    res.status(500).json({ error: 'Ошибка обновления таблицы: ' + err.message });
  }
});

// GET /api/admin/history
app.get('/api/admin/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  res.json({ total: opLog.length, data: opLog.slice(0, limit) });
});

// POST /api/admin/shipments — create shipment + update tracks
app.post('/api/admin/shipments', async (req, res) => {
  try {
    if (USE_MOCK) return res.json({ message: 'Mock-режим: запись в таблицу недоступна', shipment_id: 'SHIP-MOCK', updated: 0, notFound: [], duplicates: [], alreadyShipped: [] });

    const {
      tracks: rawTracks = [],
      shipment_code = '',
      shipped_at    = '',
      total_weight  = '',
      total_volume  = '',
      comment  = '',
      operator = '',
    } = req.body;

    // Clean + deduplicate
    const seen = new Set(); const duplicates = [];
    const tracks = rawTracks
      .map(t => t.toString().trim())
      .filter(t => {
        if (!t) return false;
        if (seen.has(t)) { duplicates.push(t); return false; }
        seen.add(t); return true;
      });

    if (tracks.length === 0) return res.status(400).json({ error: 'Список треков пуст' });

    const shipment_id = generateShipmentId();
    const created_at  = new Date().toISOString();
    const updateDate  = shipped_at || new Date().toLocaleDateString('en-US');

    // Read Scans sheet
    const auth   = await getAuth(true);
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetRange = process.env.SHEET_RANGE || 'Scans!A:Z';
    const sheetName  = sheetRange.split('!')[0];

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
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
      return res.status(500).json({ error: 'Не найдены колонки TrackNumber / Status в таблице' });
    }

    const toLetterCol = n => { let s=''; n++; while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-1)/26);} return s; };

    // Build lookup
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
        if (dateCol !== -1)      batchData.push({ range: `${sheetName}!${toLetterCol(dateCol)}${rowNum}`,   values: [[updateDate]] });
        if (sessionCol !== -1)   batchData.push({ range: `${sheetName}!${toLetterCol(sessionCol)}${rowNum}`, values: [[shipment_id]] });
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
        spreadsheetId: process.env.SPREADSHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data: batchData },
      });
    }

    // Append row to Shipments sheet
    const shipmentRow = [
      shipment_id, shipment_code, updateDate,
      total_weight, total_volume, updated.length,
      comment, operator, 'отправлено', created_at,
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SHIPMENTS_SHEET_NAME}!A:J`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [shipmentRow] },
    });

    invalidateCache();
    invalidateShipmentsCache();

    addOpLog({
      ts: created_at, operator: operator || 'unknown',
      status: 'отправлено', send_session: shipment_id,
      comment, shipment_id, shipment_code,
      submitted: tracks.length + duplicates.length,
      updated: updated.length,
      notFound, duplicates, alreadyShipped,
    });

    res.json({ shipment_id, shipment_code, total_places: updated.length, updated: updated.length, notFound, duplicates, alreadyShipped });
  } catch (err) {
    console.error('[/admin/shipments POST]', err.message);
    res.status(500).json({ error: 'Ошибка: ' + err.message });
  }
});

// GET /api/admin/shipments — list
app.get('/api/admin/shipments', async (req, res) => {
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

// GET /api/admin/shipments/:id — detail
app.get('/api/admin/shipments/:id', async (req, res) => {
  try {
    const id        = req.params.id;
    const shipments = await getAllShipments();
    const shipment  = shipments.find(s => s.shipment_id === id);
    if (!shipment) return res.status(404).json({ error: 'Отправка не найдена' });

    const { data: allData } = await getAllData();
    // Match by shipment_id column or send_session (fallback for legacy)
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

// PATCH /api/admin/shipments/:id — update status / metadata
app.patch('/api/admin/shipments/:id', async (req, res) => {
  try {
    if (USE_MOCK) return res.json({ ok: true });
    const id = req.params.id;
    const { status, comment, total_weight, total_volume } = req.body;

    const auth   = await getAuth(true);
    const sheets = google.sheets({ version: 'v4', auth });

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
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

    const toLetterCol = n => { let s=''; n++; while(n>0){s=String.fromCharCode(64+(n%26||26))+s;n=Math.floor((n-1)/26);} return s; };
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
        spreadsheetId: process.env.SPREADSHEET_ID,
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

// GET /api/health
app.get('/api/health', (_req, res) => res.json({ status: 'ok', mock: USE_MOCK, cached: !!cache.data }));

// SPA fallback
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`\n  Logistics Portal v3  →  http://localhost:${PORT}`);
  console.log(`  Данные             →  ${USE_MOCK ? 'DEMO' : 'Google Sheets'}\n`);
});
