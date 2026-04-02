// utils.js — shared helpers used by dashboard.js, search.js
// Include this file BEFORE the page-specific script

// ─── Status ───────────────────────────────────────────────────────────────────

const STATUS_MAP = {
  'на складе':'warehouse','склад':'warehouse','получено':'warehouse','в наличии':'warehouse',
  'упаковано':'packed','упаковка':'packed','запакован':'packed',
  'отправлено':'shipped','доставлено':'shipped','выслано':'shipped','в пути':'shipped',
  'warehouse':'warehouse','in stock':'warehouse','stock':'warehouse','received':'warehouse',
  'packed':'packed','pack':'packed','packaging':'packed',
  'shipped':'shipped','sent':'shipped','delivered':'shipped',
  '在仓库':'warehouse','仓库':'warehouse','已收到':'warehouse',
  '已打包':'packed','打包':'packed',
  '已发货':'shipped','已发出':'shipped','运输中':'shipped',
};

const STATUS_LABELS  = { warehouse:'На складе', packed:'Упаковано', shipped:'Отправлено' };
const STATUS_CLASSES = { warehouse:'badge-warehouse', packed:'badge-packed', shipped:'badge-shipped' };

function normStatus(s) { return STATUS_MAP[(s||'').toLowerCase().trim()] || 'other'; }
function statusLabel(s) { return STATUS_LABELS[normStatus(s)] || s || '—'; }
function statusClass(s) { return STATUS_CLASSES[normStatus(s)] || 'badge-other'; }

// ─── Photo URL ────────────────────────────────────────────────────────────────

function toDirectUrl(url) {
  if (!url || !url.trim()) return null;
  url = url.trim();
  if (/\.(jpe?g|png|gif|webp)(\?.*)?$/i.test(url)) return url;
  const m = url.match(/drive\.google\.com\/file\/d\/([^/?&#]+)/);
  if (m) return `https://lh3.googleusercontent.com/d/${m[1]}`;
  return url;
}

// ─── Date ─────────────────────────────────────────────────────────────────────

function fmtDate(str) {
  if (!str) return '—';
  try {
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) return str;
    const d = new Date(str);
    if (isNaN(d)) return str;
    return d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric' });
  } catch { return str; }
}

// ─── Escape ───────────────────────────────────────────────────────────────────

function esc(v) {
  return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function toast(msg, type = 'default') {
  const t = document.createElement('div');
  t.className = 'toast' + (type !== 'default' ? ` toast-${type}` : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2400);
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

function copyText(text, label) {
  const done = () => toast(`Скопировано: ${label || text}`);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text, cb) {
  const ta = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;opacity:0' });
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  cb();
}

// ─── Modal ────────────────────────────────────────────────────────────────────

function openPhotoModal(url, modalId = 'photoModal', imgId = 'modalImg') {
  const modal = document.getElementById(modalId);
  const img   = document.getElementById(imgId);
  if (!modal || !img) return;
  img.src = url;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closePhotoModal(modalId = 'photoModal', imgId = 'modalImg') {
  const modal = document.getElementById(modalId);
  const img   = document.getElementById(imgId);
  if (!modal) return;
  modal.classList.add('hidden');
  if (img) img.src = '';
  document.body.style.overflow = '';
}

// ─── Export CSV ───────────────────────────────────────────────────────────────

function exportCSV(items, filename) {
  const COLS = [
    ['Трек-номер',   r => r.track_number],
    ['Клиент',       r => r.client_id],
    ['Статус',       r => statusLabel(r.status)],
    ['Категория',    r => r.category],
    ['Дата',         r => r.date],
    ['Коробка',      r => r.box_number],
    ['Сессия',       r => r.send_session],
    ['Комментарий',  r => r.comment],
  ];

  const headers = COLS.map(([h]) => `"${h}"`).join(',');
  const rows    = items.map(item =>
    COLS.map(([, fn]) => `"${(fn(item) || '').toString().replace(/"/g, '""')}"`).join(',')
  );

  const csv  = [headers, ...rows].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, filename || 'gruzы.csv');
  toast('CSV скачан');
}

// ─── Export XLSX ──────────────────────────────────────────────────────────────

function exportXLSX(items, filename) {
  if (typeof XLSX === 'undefined') {
    toast('Excel недоступен, используйте CSV', 'error');
    return;
  }

  const data = items.map(r => ({
    'Трек-номер':  r.track_number  || '',
    'Клиент':      r.client_id     || '',
    'Статус':      statusLabel(r.status),
    'Категория':   r.category      || '',
    'Дата':        r.date          || '',
    'Коробка':     r.box_number    || '',
    'Сессия':      r.send_session  || '',
    'Комментарий': r.comment       || '',
  }));

  const ws = XLSX.utils.json_to_sheet(data);

  // Column widths
  ws['!cols'] = [
    { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 18 },
    { wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 30 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Грузы');
  XLSX.writeFile(wb, filename || 'gruzы.xlsx');
  toast('Excel скачан');
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── Table / card shared renderer helpers ────────────────────────────────────

// Known internal field names (not shown as "extra" fields)
const KNOWN_KEYS = new Set([
  'client_id','track_number','status','date','comment',
  'photo_1','photo_2','photo_3','send_session','box_number','category',
]);

function getPhotos(item) {
  return [
    [item.photo_1, 'Фото товара'],
    [item.photo_2, 'Этикетка'],
    [item.photo_3, 'Фото 3'],
  ].map(([u, lbl]) => [toDirectUrl(u), lbl]).filter(([u]) => u);
}

// Build a card's fields array (label, value pairs)
function getCardFields(item, includeClient = false) {
  const f = [];
  if (includeClient && item.client_id) f.push(['Клиент',     item.client_id]);
  if (item.category)     f.push(['Категория',   item.category]);
  if (item.box_number)   f.push(['Коробка',     item.box_number]);
  if (item.date)         f.push(['Дата',         fmtDate(item.date)]);
  if (item.send_session) f.push(['Сессия',      item.send_session]);
  if (item.comment)      f.push(['Комментарий', item.comment]);
  // Extra unknown columns
  for (const [k, v] of Object.entries(item)) {
    if (!KNOWN_KEYS.has(k) && v) f.push([k.replace(/_/g,' '), v]);
  }
  return f;
}
