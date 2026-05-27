// dashboard.js — client dashboard v2

const PER_PAGE = 50;

let allItems      = [];
let allShipments  = [];
let activeTab     = 'all';
let activeSection = 'parcels';
let searchQ       = '';
let sortKey       = 'date';
let sortDir       = 'desc';
let viewMode      = 'table';
let page          = 1;
let clientId      = '';
let shipmentsLoaded = false;
let _cargoDataMap   = {};

// ─── DOM ──────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const el = {
  clientIdDisplay: $('clientIdDisplay'),
  totalCount:      $('totalCount'),
  warehouseCount:  $('warehouseCount'),
  deliveredCount:  $('deliveredCount'),
  shippedCount:    $('shippedCount'),
  cntAll:          $('cntAll'),
  cntWarehouse:    $('cntWarehouse'),
  cntDelivered:    $('cntDelivered'),
  cntShipped:      $('cntShipped'),
  searchInput:     $('searchInput'),
  sortSelect:      $('sortSelect'),
  tabBtns:         document.querySelectorAll('.tab-btn'),
  tableView:       $('tableView'),
  tableBody:       $('tableBody'),
  tableInfo:       $('tableInfo'),
  pagination:      $('pagination'),
  paginationCards: $('paginationCards'),
  gridView:        $('gridView'),
  cardsGrid:       $('cardsGrid'),
  loadingState:    $('loadingState'),
  errorState:      $('errorState'),
  errorMessage:    $('errorMessage'),
  emptyState:      $('emptyState'),
  emptyMessage:    $('emptyMessage'),
  btnTableView:    $('btnTableView'),
  btnGridView:     $('btnGridView'),
  exportBtn:       $('exportBtn'),
  exportMenu:      $('exportMenu'),
  exportCSVBtn:    $('exportCSVBtn'),
  exportXLSXBtn:   $('exportXLSXBtn'),
  modal:           $('photoModal'),
  modalClose:      $('modalClose'),
  sortHeaders:     document.querySelectorAll('th.sortable'),
  logoutBtn:       $('logoutBtn'),
};

// ─── Section switching ────────────────────────────────────────────────────────

function activateSection(section) {
  activeSection = section;
  document.querySelectorAll('.section-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.section === section));
  document.getElementById('parcelsSection').classList.toggle('hidden', section !== 'parcels');
  document.getElementById('shipmentsSection').classList.toggle('hidden', section !== 'shipments');
  document.getElementById('calcSection').classList.toggle('hidden', section !== 'calc');
  document.getElementById('statsSection').classList.toggle('hidden', section !== 'stats');
  if (section === 'shipments' && !shipmentsLoaded) loadShipments();
  if (section === 'stats') {
    if (!shipmentsLoaded) loadShipments();
    else renderStats();
  }
  writeCargoStateToHash();
}

document.querySelectorAll('.section-tab').forEach(btn => {
  btn.addEventListener('click', () => activateSection(btn.dataset.section));
});

// ─── Data ─────────────────────────────────────────────────────────────────────

async function loadData() {
  showState('loading');
  try {
    const url  = clientId ? `/api/client/parcels?client_id=${encodeURIComponent(clientId)}` : '/api/client/parcels';
    const res  = await fetch(url);
    if (res.status === 401) { window.location.href = '/'; return; }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка загрузки');
    if (!clientId && body.clientId) clientId = body.clientId;
    allItems = body.data || [];
    updateStats();
    showState('items');
    render();
  } catch (err) {
    el.errorMessage.textContent = err.message;
    showState('error');
  }
}

// ─── Shipments ────────────────────────────────────────────────────────────────

// Parse Russian-format numbers (comma decimal) and strip % signs
function ruNum(v) {
  if (!v && v !== 0) return NaN;
  return parseFloat(String(v).replace('%','').replace(/\s/g,'').replace(',','.'));
}

function fmtRuNum(v, decimals = 2) {
  const n = ruNum(v);
  if (isNaN(n) || n === 0) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function fmtMoney(v) {
  const n = ruNum(v);
  if (isNaN(n) || n === 0) return '—';
  return '$\u202f' + n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function cargoStatusClass(s) {
  const sl = (s || '').toLowerCase();
  if (/доставлен|delivered|получен/.test(sl))               return 'delivered';
  if (/отправ|в пути|transit|shipped|sent/.test(sl))        return 'transit';
  if (/склад|warehouse|хранени/.test(sl))                   return 'warehouse';
  return '';
}

// ─── Shipments state ─────────────────────────────────────────────────────────
let cargoFilter = 'all';
let cargoSearch = '';
let cargoSort   = 'date_desc';
let cargoPeriod = 'all';

// Read filter state from URL hash
function readCargoStateFromHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.has('cf'))     cargoFilter = h.get('cf');
  if (h.has('csort'))  cargoSort   = h.get('csort');
  if (h.has('cp'))     cargoPeriod = h.get('cp');
  if (h.has('cq'))     cargoSearch = h.get('cq');
  if (h.has('sec'))    activeSection = h.get('sec');
}
function writeCargoStateToHash() {
  const h = new URLSearchParams();
  if (activeSection !== 'parcels') h.set('sec', activeSection);
  if (cargoFilter !== 'all')       h.set('cf', cargoFilter);
  if (cargoSort   !== 'date_desc') h.set('csort', cargoSort);
  if (cargoPeriod !== 'all')       h.set('cp', cargoPeriod);
  if (cargoSearch)                 h.set('cq', cargoSearch);
  const s = h.toString();
  history.replaceState(null, '', s ? `#${s}` : location.pathname);
}

async function loadShipments() {
  shipState('loading');
  try {
    const url  = `/api/client/shipments${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''}`;
    const res  = await fetch(url);
    if (res.status === 401) { window.location.href = '/'; return; }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка загрузки');

    allShipments    = body.data || [];
    shipmentsLoaded = true;

    const stc = document.getElementById('stcShipments');
    if (stc) stc.textContent = allShipments.length;

    renderShipments();
    if (activeSection === 'stats') renderStats();
  } catch (err) {
    document.getElementById('shipErrorMsg').textContent = err.message;
    shipState('error');
  }
}

function shipState(s) {
  document.getElementById('shipLoadingState').classList.toggle('hidden', s !== 'loading');
  document.getElementById('shipErrorState').classList.toggle('hidden',   s !== 'error');
  document.getElementById('shipEmptyState').classList.toggle('hidden',   s !== 'empty');
  document.getElementById('shipContent').classList.toggle('hidden',      s !== 'content');
}

// ─── Wiring controls ─────────────────────────────────────────────────────────
document.querySelectorAll('.cargo-ftab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cargo-ftab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    cargoFilter = btn.dataset.cf;
    writeCargoStateToHash();
    renderCargoGroups();
  });
});

(function bindCargoControls() {
  const search = document.getElementById('cargoSearch');
  if (search) search.addEventListener('input', e => {
    cargoSearch = e.target.value.trim();
    writeCargoStateToHash();
    renderCargoGroups();
  });

  const sort = document.getElementById('cargoSort');
  if (sort) sort.addEventListener('change', e => {
    cargoSort = e.target.value;
    writeCargoStateToHash();
    renderCargoGroups();
  });

  const period = document.getElementById('cargoPeriod');
  if (period) period.addEventListener('change', e => {
    cargoPeriod = e.target.value;
    writeCargoStateToHash();
    renderCargoGroups();
  });

  const exp = document.getElementById('cargoExportBtn');
  if (exp) exp.addEventListener('click', exportCargoCSV);
})();

// ─── Date helpers ────────────────────────────────────────────────────────────
function parseRuDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})[.,\/-](\d{1,2})[.,\/-](\d{2,4})/);
  if (m) {
    const yr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    let dd = +m[1], mm = +m[2];
    // If second number > 12 it can't be a month → format is MM,DD (American)
    if (mm > 12 && dd <= 12) { const tmp = dd; dd = mm; mm = tmp; }
    const d = new Date(yr, mm - 1, dd);
    if (!isNaN(d) && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return d;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

function pluralRu(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5)   return few;
  if (b === 1)          return one;
  return many;
}

function transitDaysInfo(r) {
  const shipped = parseRuDate(r.date);
  if (!shipped) return null;
  const cls     = cargoStatusClass(r.status);
  const arrived = parseRuDate(r.arrival);
  if (cls === 'delivered') {
    if (arrived) {
      const days = Math.round((arrived - shipped) / 86400000);
      if (days >= 0) return { kind: 'delivered', text: `Доставлено за ${days} ${pluralRu(days, 'день', 'дня', 'дней')}` };
    }
    return { kind: 'delivered', text: 'Доставлено' };
  }
  if (cls !== 'transit' && cls !== 'shipped') return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const days = Math.round((today - shipped) / 86400000);
  if (days >= 0) return { kind: 'transit', text: `${days} ${pluralRu(days, 'день', 'дня', 'дней')} в пути` };
  return null;
}

function smartArrivalLabel(r) {
  const cls     = cargoStatusClass(r.status);
  const arrival = parseRuDate(r.arrival);
  const start   = parseRuDate(r.date);
  if (!arrival) return null;

  const today = new Date(); today.setHours(0,0,0,0);

  // Delivered: how long it took
  if (cls === 'delivered') {
    if (start) {
      const days = daysBetween(start, arrival);
      if (days != null && days > 0) {
        return { kind: 'delivered',
          label: `Прибыл за ${days} ${pluralRu(days, 'день', 'дня', 'дней')}`,
          date:  fmtDate(r.arrival)
        };
      }
    }
    return { kind: 'delivered', label: 'Доставлен', date: fmtDate(r.arrival) };
  }

  // In transit: countdown
  const left = daysBetween(today, arrival);
  if (left == null) return null;
  if (left < 0)  return { kind: 'overdue',     label: `Просрочка ${-left} ${pluralRu(-left,'день','дня','дней')}`, date: fmtDate(r.arrival) };
  if (left === 0) return { kind: 'transit-soon', label: 'Прибудет сегодня', date: fmtDate(r.arrival) };
  if (left <= 3)  return { kind: 'transit-soon', label: `Прибудет через ${left} ${pluralRu(left,'день','дня','дней')}`, date: fmtDate(r.arrival) };
  return { kind: 'transit', label: `Прибудет через ${left} ${pluralRu(left,'день','дня','дней')}`, date: fmtDate(r.arrival) };
}

// ─── Render orchestrator ─────────────────────────────────────────────────────
function renderShipments() {
  if (!allShipments.length) { shipState('empty'); return; }

  // Summary totals over ALL shipments (not filtered)
  let totalWeight = 0, totalVolume = 0, totalCost = 0;
  let cntAll = allShipments.length, cntTransit = 0, cntDelivered = 0;

  allShipments.forEach(r => {
    const w = ruNum(r.weight); if (!isNaN(w)) totalWeight += w;
    const v = ruNum(r.volume); if (!isNaN(v)) totalVolume += v;
    const t = ruNum(r.total);  if (!isNaN(t)) totalCost   += t;
    const cls = cargoStatusClass(r.status);
    if (cls === 'transit')   cntTransit++;
    if (cls === 'delivered') cntDelivered++;
  });

  document.getElementById('sSum_count').textContent  = cntAll;
  document.getElementById('sSum_weight').textContent = fmtRuNum(totalWeight, 1);
  document.getElementById('sSum_volume').textContent = fmtRuNum(totalVolume, 2);
  document.getElementById('sSum_total').textContent  = fmtMoney(totalCost);

  document.getElementById('cf_all').textContent       = cntAll;
  document.getElementById('cf_transit').textContent   = cntTransit;
  document.getElementById('cf_delivered').textContent = cntDelivered;

  // Sync UI with state from hash
  document.querySelectorAll('.cargo-ftab').forEach(b => b.classList.toggle('active', b.dataset.cf === cargoFilter));
  const sortEl = document.getElementById('cargoSort');
  if (sortEl) sortEl.value = cargoSort;
  const periodEl = document.getElementById('cargoPeriod');
  if (periodEl) periodEl.value = cargoPeriod;
  const searchEl = document.getElementById('cargoSearch');
  if (searchEl) searchEl.value = cargoSearch;

  renderCargoGroups();
  shipState('content');
}

// ─── Filtering + sorting ─────────────────────────────────────────────────────
function getFilteredShipments() {
  const now = new Date();
  let from = null;
  if (cargoPeriod === 'month')   { from = new Date(now.getFullYear(), now.getMonth(), 1); }
  if (cargoPeriod === 'quarter') { const q = Math.floor(now.getMonth()/3)*3; from = new Date(now.getFullYear(), q, 1); }
  if (cargoPeriod === 'year')    { from = new Date(now.getFullYear(), 0, 1); }

  const q = cargoSearch.toLowerCase();

  return allShipments.filter(r => {
    if (cargoFilter !== 'all' && cargoStatusClass(r.status) !== cargoFilter) return false;
    if (from) {
      const d = parseRuDate(r.date);
      if (!d || d < from) return false;
    }
    if (q) {
      const hay = [r.cargo_number, r.category, r.status].map(v => (v||'').toString().toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function getSortedShipments(items) {
  const [key, dir] = cargoSort.split('_');
  const factor = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (key === 'date') {
      const da = parseRuDate(a.date), db = parseRuDate(b.date);
      if (!da && !db) return 0; if (!da) return 1; if (!db) return -1;
      return (da - db) * factor;
    }
    const va = ruNum(a[key]) || 0;
    const vb = ruNum(b[key]) || 0;
    return (va - vb) * factor;
  });
}

// ─── Group by month ──────────────────────────────────────────────────────────
const RU_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function groupByMonth(items) {
  const groups = new Map();
  items.forEach(r => {
    const d = parseRuDate(r.date);
    const key = d ? `${d.getFullYear()}-${String(d.getMonth()).padStart(2,'0')}` : 'no-date';
    if (!groups.has(key)) groups.set(key, { key, date: d, items: [] });
    groups.get(key).items.push(r);
  });
  return [...groups.values()];
}

function monthTitle(g) {
  if (!g.date) return 'Без даты';
  return `${RU_MONTHS[g.date.getMonth()]} ${g.date.getFullYear()}`;
}

function monthSummary(items) {
  let w = 0, v = 0, t = 0;
  items.forEach(r => {
    const wn = ruNum(r.weight); if (!isNaN(wn)) w += wn;
    const vn = ruNum(r.volume); if (!isNaN(vn)) v += vn;
    const tn = ruNum(r.total);  if (!isNaN(tn)) t += tn;
  });
  return { w, v, t };
}

function renderCargoGroups() {
  const filtered = getFilteredShipments();
  const sorted   = getSortedShipments(filtered);
  const container = document.getElementById('cargoGroupsContainer');

  // Populate lookup map for drawer
  _cargoDataMap = {};
  sorted.forEach(r => { if (r.cargo_number) _cargoDataMap[r.cargo_number] = r; });

  if (sorted.length === 0) {
    container.innerHTML = `
      <div class="cargo-empty-filter">
        <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p>${cargoSearch
            ? `Грузов с «${esc(cargoSearch)}» не найдено`
            : 'В выбранной категории нет грузов'}</p>
        <button onclick="resetCargoFilters()">Показать все грузы</button>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="aurora-grid">${sorted.map(r => renderAuroraCard(r)).join('')}</div>`;
}

// ─── Statistics ───────────────────────────────────────────────────────────────
function renderStats() {
  const container = document.getElementById('statsContent');
  if (!container) return;

  const totalParcelCount = allItems.length;
  const totalCargoCount  = allShipments.length;
  const totalSpend       = allShipments.reduce((s, r) => s + (ruNum(r.total)  || 0), 0);
  const totalWeight      = allShipments.reduce((s, r) => s + (ruNum(r.weight) || 0), 0);

  if (!totalParcelCount && !totalCargoCount) {
    container.innerHTML = `<div class="stat-empty">Данных пока нет — они появятся после первой отгрузки</div>`;
    return;
  }

  // Monthly spend — last 6 months
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const lbl = d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
    months.push({ key, lbl, val: 0 });
  }
  allShipments.forEach(r => {
    const d = parseRuDate(r.date);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m   = months.find(x => x.key === key);
    if (m) m.val += ruNum(r.total) || 0;
  });
  const maxVal = Math.max(...months.map(m => m.val), 1);

  // Category breakdown (parcels)
  const catMap = new Map();
  allItems.forEach(item => {
    const cat = item.category || 'Другое';
    catMap.set(cat, (catMap.get(cat) || 0) + 1);
  });
  const cats   = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  const maxCat = cats[0]?.[1] || 1;

  // Cargo status breakdown
  let cTransit = 0, cWarehouse = 0, cDelivered = 0;
  allShipments.forEach(r => {
    const cls = cargoStatusClass(r.status);
    if (cls === 'transit')   cTransit++;
    else if (cls === 'delivered') cDelivered++;
    else cWarehouse++;
  });

  const barsHtml = months.map(m => {
    const h = m.val > 0 ? Math.max(Math.round(m.val / maxVal * 100), 3) : 0;
    return `<div class="stat-bar-col"><div class="stat-bar-fill" style="height:${h}%"></div></div>`;
  }).join('');

  const valsHtml = months.map(m =>
    `<div class="stat-bar-val-top">${m.val > 0 ? '$' + Math.round(m.val) : ''}</div>`
  ).join('');

  const lblsHtml = months.map(m => `<div class="stat-bar-lbl">${m.lbl}</div>`).join('');

  const catsHtml = cats.map(([cat, cnt]) => `
    <div class="stat-cat-row">
      <span class="stat-cat-name" title="${esc(cat)}">${esc(cat)}</span>
      <div class="stat-cat-bar-wrap">
        <div class="stat-cat-bar" style="width:${Math.round(cnt / maxCat * 100)}%"></div>
      </div>
      <span class="stat-cat-count">${cnt}</span>
    </div>`).join('');

  container.innerHTML = `
    <div class="cargo-summary" style="margin-bottom:20px">
      <div class="csum-card">
        <div class="csum-icon blue">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/>
            <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
          </svg>
        </div>
        <div><div class="csum-val">${totalParcelCount}</div><div class="csum-label">Посылок</div></div>
      </div>
      <div class="csum-card">
        <div class="csum-icon purple">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
        </div>
        <div><div class="csum-val">${totalCargoCount}</div><div class="csum-label">Грузов</div></div>
      </div>
      <div class="csum-card">
        <div class="csum-icon green">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
        </div>
        <div><div class="csum-val">${fmtMoney(totalSpend)}</div><div class="csum-label">Потрачено</div></div>
      </div>
      <div class="csum-card">
        <div class="csum-icon amber">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M6.5 6.5h11l1.5 13.5a1 1 0 0 1-1 1.1H6a1 1 0 0 1-1-1.1L6.5 6.5Z"/>
            <path d="M9 6.5V5a3 3 0 0 1 6 0v1.5"/><line x1="3" y1="11" x2="21" y2="11"/>
          </svg>
        </div>
        <div><div class="csum-val">${fmtRuNum(totalWeight, 1)} кг</div><div class="csum-label">Общий вес</div></div>
      </div>
    </div>

    ${totalCargoCount ? `
    <div class="stat-chart-card">
      <div class="stat-chart-title">Расходы по месяцам</div>
      <div class="stat-val-row">${valsHtml}</div>
      <div class="stat-bars">${barsHtml}</div>
      <div class="stat-lbl-row">${lblsHtml}</div>
    </div>` : ''}

    <div class="stat-two-col">
      ${cats.length ? `
      <div class="stat-chart-card">
        <div class="stat-chart-title">Категории посылок</div>
        ${catsHtml}
      </div>` : ''}

      ${totalCargoCount ? `
      <div class="stat-chart-card">
        <div class="stat-chart-title">Статус грузов</div>
        <div class="stat-status-grid">
          <div class="stat-status-item s-transit">
            <div class="stat-status-num">${cTransit}</div>
            <div class="stat-status-lbl">В пути</div>
          </div>
          <div class="stat-status-item s-warehouse">
            <div class="stat-status-num">${cWarehouse}</div>
            <div class="stat-status-lbl">На складе</div>
          </div>
          <div class="stat-status-item s-delivered">
            <div class="stat-status-num">${cDelivered}</div>
            <div class="stat-status-lbl">Доставлено</div>
          </div>
        </div>
      </div>` : ''}
    </div>`;
}

function resetCargoFilters() {
  cargoFilter = 'all';
  cargoSearch = '';
  cargoPeriod = 'all';
  document.querySelectorAll('.cargo-ftab').forEach(b => b.classList.toggle('active', b.dataset.cf === 'all'));
  const s = document.getElementById('cargoSearch'); if (s) s.value = '';
  const p = document.getElementById('cargoPeriod'); if (p) p.value = 'all';
  writeCargoStateToHash();
  renderCargoGroups();
}

// ─── Aurora card render ───────────────────────────────────────────────────────
function renderAuroraCard(r) {
  const cls = cargoStatusClass(r.status);
  const statusLabels = { delivered: 'Доставлен', transit: 'В пути', warehouse: 'На складе' };
  const statusLabel = statusLabels[cls] || r.status || '—';
  const cargoNum = r.cargo_number || '—';
  const di = transitDaysInfo(r);

  return `
  <div class="a-card ${cls}" onclick="openCargoDrawer('${esc(cargoNum)}')">
    <div class="a-head">
      <div class="a-num-block">
        <div class="a-num">${esc(cargoNum)}</div>
        <div class="a-cat">${esc(r.category || '—')}</div>
      </div>
      <div class="a-pill ${cls}"><span class="apulse"></span>${esc(statusLabel)}</div>
    </div>
    <div class="a-metrics">
      <div class="a-metric">
        <div class="a-metric-val">${esc(String(r.places || '—'))}</div>
        <div class="a-metric-label">Мест</div>
      </div>
      <div class="a-metric">
        <div class="a-metric-val">${esc(fmtRuNum(r.weight, 1))}<span class="a-unit">кг</span></div>
        <div class="a-metric-label">Вес</div>
      </div>
      <div class="a-metric">
        <div class="a-metric-val">${esc(fmtRuNum(r.volume, 3))}<span class="a-unit">м³</span></div>
        <div class="a-metric-label">Объём</div>
      </div>
    </div>
    <div class="a-foot">
      <span>${esc(fmtDate(r.date))}</span>
      ${di ? `<span class="a-days-chip ${di.kind}">${esc(di.text)}</span>` : ''}
      <strong>${esc(fmtMoney(r.total))}</strong>
    </div>
  </div>`;
}

// ─── Premium Hero Drawer ──────────────────────────────────────────────────────
function openCargoDrawer(cargoNum) {
  const r = _cargoDataMap[cargoNum];
  if (!r) return;

  const cls = cargoStatusClass(r.status);
  const statusLabels = { delivered: 'Доставлен', transit: 'В пути', warehouse: 'На складе' };
  const statusLabel = statusLabels[cls] || r.status || '—';

  const progDots = (() => {
    if (cls === 'delivered') return ['done','done','done','done'];
    if (cls === 'transit')   return ['done','done','current',''];
    if (cls === 'warehouse') return ['done','current','',''];
    return ['current','','',''];
  })();

  const route = '';

  document.getElementById('phHero').innerHTML = `
    <div class="ph-d-top">
      <div class="ph-d-brand">FreewayChina</div>
      <div class="ph-d-actions">
        <div class="ph-d-status-pill">
          <span class="pp-dot ${cls}"></span>${esc(statusLabel)}
        </div>
        <button class="ph-d-close" onclick="closeCargoDrawer()">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="ph-d-num">${esc(r.cargo_number || '—')}${r.client_id ? ` · Клиент ${esc(r.client_id)}` : ''}</div>
    <div class="ph-d-cat">${esc(r.category || '—')}</div>
    <div class="ph-d-amount-label">К оплате</div>
    <div class="ph-d-amount">${esc(fmtMoney(r.total))}</div>
    ${route ? `<div class="ph-d-amount-sub">${esc(route)}</div>` : ''}
    <div class="ph-d-progress">
      ${progDots.map(d => `<div class="ph-d-pdot ${d}"></div>`).join('')}
    </div>
    <div class="ph-d-stages">
      <span>Отправлен</span><span>Склад</span><span>В пути</span><span>Доставлен</span>
    </div>`;

  const insLabel = (() => {
    const pct = ruNum(r.insurance_pct);
    return !isNaN(pct) && pct > 0 ? `Страховка (${pct}%)` : 'Страховка';
  })();
  const finRows = [
    [insLabel,          r.insurance_usd],
    ['Упаковка',        r.packaging],
    ['Погрузка',        r.loading],
  ].filter(([, v]) => ruNum(v) > 0);

  const di2 = transitDaysInfo(r);
  const daysRow = (() => {
    if (!di2) return null;
    if (di2.kind === 'delivered') {
      const suffix = r.arrival ? ` · ${fmtDate(r.arrival)}` : '';
      return ['Доставлено за', di2.text.replace('Доставлено за ', '') + suffix];
    }
    return ['Дней в пути', di2.text];
  })();
  const infoRows = [
    ['Дата отправки', fmtDate(r.date)],
    daysRow,
    ['ID клиента',    r.client_id],
    ['Тариф',         fmtMoney(r.price_per_kg)],
  ].filter(row => row && row[1] && row[1] !== '—');

  let commentHtml = '';
  if (r.comment) {
    let comments = [];
    try { comments = JSON.parse(r.comment); } catch {}
    if (!Array.isArray(comments)) comments = [{ ts: null, text: r.comment }];
    const latest = comments[comments.length - 1];
    if (latest && latest.text) {
      commentHtml = `<div class="ph-d-comment">${esc(latest.text)}</div>`;
    }
  }

  document.getElementById('phBody').innerHTML = `
    <div class="ph-d-stats">
      <div class="ph-d-stat">
        <div class="ph-d-stat-val">${esc(r.places || '—')}</div>
        <div class="ph-d-stat-label">Мест</div>
      </div>
      <div class="ph-d-stat">
        <div class="ph-d-stat-val">${esc(fmtRuNum(r.weight, 1))}<span class="unit">кг</span></div>
        <div class="ph-d-stat-label">Вес</div>
      </div>
      <div class="ph-d-stat">
        <div class="ph-d-stat-val">${esc(fmtRuNum(r.volume, 3))}<span class="unit">м³</span></div>
        <div class="ph-d-stat-label">Объём</div>
      </div>
    </div>
    ${infoRows.length ? `
    <div class="ph-d-section">
      <div class="ph-d-section-title">Информация</div>
      ${infoRows.map(([k, v]) => `<div class="ph-d-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}
    </div>` : ''}
    ${finRows.length ? `
    <div class="ph-d-section">
      <div class="ph-d-section-title">Финансы</div>
      ${finRows.map(([k, v]) => `<div class="ph-d-row"><span class="k">${esc(k)}</span><span class="v">${esc(fmtMoney(v))}</span></div>`).join('')}
      <div class="ph-d-fin-total">
        <span class="k">К оплате</span>
        <span class="v">${esc(fmtMoney(r.total))}</span>
      </div>
    </div>` : ''}`;

  document.getElementById('phBackdrop').classList.add('open');
  document.getElementById('phDrawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCargoDrawer() {
  document.getElementById('phBackdrop').classList.remove('open');
  document.getElementById('phDrawer').classList.remove('open');
  document.body.style.overflow = '';
}

window.openCargoDrawer  = openCargoDrawer;
window.closeCargoDrawer = closeCargoDrawer;

// ─── Export CSV ──────────────────────────────────────────────────────────────
function exportCargoCSV() {
  const items = getSortedShipments(getFilteredShipments());
  if (!items.length) return;

  const headers = ['Номер груза','Дата','Категория','Статус','Мест','Вес (кг)','Объём (м³)','Цена/кг','Страховка %','Страховка $','Упаковка','Погрузка','Итого','Прибытие'];
  const rows = items.map(r => [
    r.cargo_number, r.date, r.category, r.status,
    r.places, r.weight, r.volume, r.price_per_kg,
    r.insurance_pct, r.insurance_usd, r.packaging, r.loading, r.total, r.arrival
  ].map(v => {
    const s = (v == null ? '' : String(v)).replace(/"/g, '""');
    return /[,;"\n]/.test(s) ? `"${s}"` : s;
  }).join(','));

  const csv = '\ufeff' + [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `cargo_${(clientId||'export')}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function updateStats() {
  const c = { warehouse: 0, shipped: 0, delivered: 0 };
  allItems.forEach(item => { const n = normStatus(item.status); if (n in c) c[n]++; });

  el.totalCount.textContent     = allItems.length;
  el.warehouseCount.textContent = c.warehouse;
  el.deliveredCount.textContent = c.delivered;
  el.shippedCount.textContent   = c.shipped;
  el.cntAll.textContent         = allItems.length;
  el.cntWarehouse.textContent   = c.warehouse;
  el.cntDelivered.textContent   = c.delivered;
  el.cntShipped.textContent     = c.shipped;
  const stcP = document.getElementById('stcParcels');
  if (stcP) stcP.textContent = allItems.length;
}

// ─── Filter + sort ────────────────────────────────────────────────────────────

function getFiltered() {
  return allItems.filter(item => {
    if (activeTab !== 'all' && normStatus(item.status) !== activeTab) return false;
    if (searchQ) {
      const q   = searchQ.toLowerCase();
      const hay = [item.track_number, item.comment, item.box_number, item.send_session, item.category]
        .map(v => (v||'').toLowerCase()).join(' ');
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function getSorted(items) {
  return [...items].sort((a, b) => {
    const va = (a[sortKey] || '').toString().toLowerCase();
    const vb = (b[sortKey] || '').toString().toLowerCase();
    if (sortKey === 'date') {
      const da = parseRuDate(a[sortKey]), db = parseRuDate(b[sortKey]);
      if (da || db) { if (!da) return 1; if (!db) return -1; return sortDir === 'asc' ? da - db : db - da; }
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const filtered = getFiltered();
  const sorted   = getSorted(filtered);

  if (sorted.length === 0) {
    el.tableView.classList.add('hidden');
    el.gridView.classList.add('hidden');
    el.emptyMessage.textContent = searchQ
      ? `Нет грузов с «${searchQ}»`
      : 'В этой категории пока нет грузов';
    el.emptyState.classList.remove('hidden');
    return;
  }

  el.emptyState.classList.add('hidden');

  // Pagination
  const totalPages = Math.ceil(sorted.length / PER_PAGE);
  if (page > totalPages) page = totalPages;
  const paged = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  if (viewMode === 'table') {
    el.gridView.classList.add('hidden');
    el.tableView.classList.remove('hidden');
    renderTable(paged, sorted.length, totalPages);
  } else {
    el.tableView.classList.add('hidden');
    el.gridView.classList.remove('hidden');
    renderCards(paged, sorted.length, totalPages);
  }
}

// ─── Table ────────────────────────────────────────────────────────────────────

function photoBtn(url, label) {
  if (!url) return '<span style="color:var(--text-3);font-size:12px">—</span>';
  const thumb  = thumbUrl(url, 80);
  const medium = thumbUrl(url, 1200);
  return `<button class="thumb-btn" onclick="openPhotoModal('${esc(medium)}','${esc(url)}')" title="${esc(label)}">
    <img class="thumb-img" src="${esc(thumb)}" loading="lazy" alt="${esc(label)}"
         onerror="this.style.opacity=0">
  </button>`;
}

function trackCell(item) {
  const num = item.track_number;
  if (!num) return '<div class="cell-track"><span class="cell-track-num">—</span></div>';
  const st = normStatus(item.status);
  const trackHtml = (st === 'shipped' || st === 'delivered')
    ? `<a class="cell-track-num track-link" href="https://t.17track.net/ru#nums=${esc(num)}" target="_blank" rel="noopener noreferrer" title="Отследить">${esc(num)}</a>`
    : `<span class="cell-track-num">${esc(num)}</span>`;
  return `<div class="cell-track">
    ${trackHtml}
    <button class="copy-sm" onclick="copyText('${esc(num)}','${esc(num)}')" title="Скопировать">
      <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <rect x="9" y="9" width="13" height="13" rx="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
    </button>
  </div>`;
}

function renderTable(items, total, totalPages) {
  el.tableBody.innerHTML = items.map(item => {
    const photo1 = toDirectUrl(item.photo_1);
    const photo2 = toDirectUrl(item.photo_2);

    return `<tr>
      <td>${trackCell(item)}</td>
      <td class="cell-cat"  title="${esc(item.category||'')}">${esc(item.category||'—')}</td>
      <td><span class="badge ${statusClass(item.status)}">${esc(statusLabel(item.status))}</span></td>
      <td class="cell-box">${esc(item.box_number||'—')}</td>
      <td class="cell-date">${esc(fmtDate(item.date))}</td>
      <td class="cell-comment" title="${esc(item.comment||'')}">${esc(item.comment||'—')}</td>
      <td><div class="cell-photos">${photoBtn(photo1, 'Фото товара')}</div></td>
      <td><div class="cell-photos">${photoBtn(photo2, 'Этикетка')}</div></td>
    </tr>`;
  }).join('');

  const from = (page - 1) * PER_PAGE + 1;
  const to   = Math.min(page * PER_PAGE, total);
  el.tableInfo.textContent = `Показано ${from}–${to} из ${total}`;

  el.pagination.innerHTML = buildPagination(totalPages);

  // Sort indicators
  el.sortHeaders.forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortKey) th.classList.add(`sort-${sortDir}`);
  });
}

// ─── Cards ────────────────────────────────────────────────────────────────────

function renderCards(items, total, totalPages) {
  el.cardsGrid.innerHTML = items.map(item => {
    const fields  = getCardFields(item, false);
    const photo1  = toDirectUrl(item.photo_1);
    const photo2  = toDirectUrl(item.photo_2);
    const st      = normStatus(item.status);
    const num     = item.track_number;
    const isActive = st === 'shipped' || st === 'delivered';

    const trackEl = num
      ? (isActive
          ? `<a class="card-track-num track-link" href="https://t.17track.net/ru#nums=${esc(num)}" target="_blank" rel="noopener noreferrer" title="Отследить">${esc(num)}</a>`
          : `<span class="card-track-num" title="${esc(num)}">${esc(num)}</span>`)
      : `<span class="card-track-num">—</span>`;

    const cardPhotoBtn = (url, lbl) => !url ? '' : `
      <button class="thumb-card-btn" onclick="openPhotoModal('${esc(thumbUrl(url, 1200))}','${esc(url)}')" title="${esc(lbl)}">
        <img class="thumb-card-img" src="${esc(thumbUrl(url, 160))}" loading="lazy" alt="${esc(lbl)}"
             onerror="this.style.opacity=0">
        <span class="thumb-card-lbl">${esc(lbl)}</span>
      </button>`;

    const photosHtml = (photo1 || photo2) ? `
      <div class="card-photos">
        ${cardPhotoBtn(photo1, 'Фото товара')}
        ${cardPhotoBtn(photo2, 'Этикетка')}
      </div>` : '';

    return `<div class="card">
      <div class="card-head">
        <div class="card-track-row">
          ${trackEl}
          ${num ? `<button class="copy-btn" onclick="copyText('${esc(num)}','${esc(num)}')" title="Скопировать">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>` : ''}
        </div>
        <span class="badge ${statusClass(item.status)}">${esc(statusLabel(item.status))}</span>
      </div>
      ${fields.length ? `
        <div class="card-fields">
          ${fields.map(([l,v]) => `
            <div class="card-field">
              <span class="field-lbl">${esc(l)}</span>
              <span class="field-val">${esc(v)}</span>
            </div>`).join('')}
        </div>` : ''}
      ${photosHtml}
    </div>`;
  }).join('');

  el.paginationCards.innerHTML = buildPagination(totalPages);
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function buildPagination(totalPages) {
  if (totalPages <= 1) return '';

  let html = `<button class="pg-btn" ${page<=1?'disabled':''} onclick="goPage(${page-1})">‹</button>`;

  const pages = getPagesToShow(page, totalPages);
  let lastP = 0;
  for (const p of pages) {
    if (p === '…') { html += `<span class="pg-sep">…</span>`; lastP = 0; continue; }
    html += `<button class="pg-btn${p===page?' active':''}" onclick="goPage(${p})">${p}</button>`;
    lastP = p;
  }

  html += `<button class="pg-btn" ${page>=totalPages?'disabled':''} onclick="goPage(${page+1})">›</button>`;
  return html;
}

function getPagesToShow(cur, total) {
  if (total <= 7) return Array.from({length: total}, (_, i) => i + 1);
  const pages = new Set([1, total, cur, cur-1, cur+1].filter(p => p >= 1 && p <= total));
  const sorted = [...pages].sort((a,b) => a-b);
  const result = [];
  let last = 0;
  for (const p of sorted) {
    if (last && p - last > 1) result.push('…');
    result.push(p);
    last = p;
  }
  return result;
}

window.goPage = function(p) {
  page = p;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ─── State ────────────────────────────────────────────────────────────────────

function showState(s) {
  el.loadingState.classList.toggle('hidden', s !== 'loading');
  el.errorState.classList.toggle('hidden',   s !== 'error');
  if (s !== 'items') {
    el.tableView.classList.add('hidden');
    el.gridView.classList.add('hidden');
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

el.logoutBtn.addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  window.location.href = '/';
});

el.tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    el.tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    page = 1;
    render();
  });
});

el.searchInput.addEventListener('input', e => {
  searchQ = e.target.value.trim();
  page = 1;
  render();
});

el.sortSelect.addEventListener('change', e => {
  const [key, dir] = e.target.value.split('_');
  // Handle 'track_number_asc' → sortKey='track_number', sortDir='asc'
  const parts = e.target.value.split('_');
  sortDir = parts.pop();
  sortKey = parts.join('_');
  page = 1;
  render();
});

// Column header sort (overrides select)
el.sortHeaders.forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    sortDir = (sortKey === key && sortDir === 'asc') ? 'desc' : (key === 'date' ? 'desc' : 'asc');
    sortKey = key;
    // Sync the select
    const val = `${sortKey}_${sortDir}`;
    if (el.sortSelect.querySelector(`option[value="${val}"]`)) el.sortSelect.value = val;
    page = 1;
    render();
  });
});

// View toggle
el.btnTableView.addEventListener('click', () => {
  viewMode = 'table';
  el.btnTableView.classList.add('active');
  el.btnGridView.classList.remove('active');
  render();
});

el.btnGridView.addEventListener('click', () => {
  viewMode = 'grid';
  el.btnGridView.classList.add('active');
  el.btnTableView.classList.remove('active');
  render();
});

// Export menu toggle
el.exportBtn.addEventListener('click', () => el.exportMenu.classList.toggle('hidden'));
document.addEventListener('click', e => {
  if (!el.exportBtn.contains(e.target) && !el.exportMenu.contains(e.target)) {
    el.exportMenu.classList.add('hidden');
  }
});

el.exportCSVBtn.addEventListener('click', () => {
  const items = getSorted(getFiltered());
  const ts    = new Date().toISOString().slice(0,10);
  exportCSV(items, `${clientId}_gruzы_${ts}.csv`);
  el.exportMenu.classList.add('hidden');
});

el.exportXLSXBtn.addEventListener('click', () => {
  const items = getSorted(getFiltered());
  const ts    = new Date().toISOString().slice(0,10);
  exportXLSX(items, `${clientId}_gruzы_${ts}.xlsx`);
  el.exportMenu.classList.add('hidden');
});

// Modal
el.modalClose.addEventListener('click', () => closePhotoModal());
el.modal.addEventListener('click', e => { if (e.target === el.modal) closePhotoModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeCargoDrawer(); closePhotoModal(); } });

// ─── Service Worker + PWA install prompt ──────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

let _deferredInstall = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredInstall = e;
  if (!sessionStorage.getItem('pwa-dismissed')) {
    setTimeout(() => document.getElementById('pwaBanner')?.classList.remove('hidden'), 4000);
  }
});

document.getElementById('pwaInstall')?.addEventListener('click', async () => {
  if (!_deferredInstall) return;
  _deferredInstall.prompt();
  await _deferredInstall.userChoice;
  _deferredInstall = null;
  document.getElementById('pwaBanner')?.classList.add('hidden');
});

document.getElementById('pwaDismiss')?.addEventListener('click', () => {
  sessionStorage.setItem('pwa-dismissed', '1');
  document.getElementById('pwaBanner')?.classList.add('hidden');
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  const user = await (async () => {
    try {
      const r = await fetch('/api/auth/me');
      if (!r.ok) return null;
      return (await r.json()).user;
    } catch { return null; }
  })();

  if (!user) { window.location.href = '/'; return; }

  // Admin/employee can view specific client via ?id=
  const urlId = new URLSearchParams(window.location.search).get('id')?.trim() || '';
  if (user.role === 'client') {
    clientId = user.clientId;
  } else if (urlId) {
    clientId = urlId;
  } else {
    window.location.href = '/admin.html'; return;
  }

  if (el.clientIdDisplay) el.clientIdDisplay.textContent = clientId;
  document.title = `${clientId} — FreewayChina`;

  // Restore state from URL hash
  readCargoStateFromHash();
  if (activeSection === 'shipments') activateSection('shipments');
  else if (activeSection === 'calc') activateSection('calc');

  loadData();
})();
