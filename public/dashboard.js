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
  if (section === 'shipments' && !shipmentsLoaded) loadShipments();
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

  const groups = groupByMonth(sorted);
  const showHeaders = groups.length > 1;

  container.innerHTML = groups.map(g => {
    const sum = monthSummary(g.items);
    const head = showHeaders ? `
      <div class="month-head">
        <div class="month-title">${esc(monthTitle(g))}</div>
        <div class="month-stats">
          <strong>${g.items.length}</strong> ${pluralRu(g.items.length,'груз','груза','грузов')}
          · <strong>${fmtRuNum(sum.w, 1)}</strong> кг
          · <strong>${fmtMoney(sum.t)}</strong>
        </div>
      </div>` : '';

    return `<div class="month-group">
      ${head}
      <div class="cargo-cards">${g.items.map(renderCargoCard).join('')}</div>
    </div>`;
  }).join('');
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

// ─── Single card render ──────────────────────────────────────────────────────
function renderCargoCard(r) {
  const cls      = cargoStatusClass(r.status);
  const badgeMap = { delivered: 'Доставлен', transit: 'В пути', warehouse: 'На складе' };
  const badgeLabel = r.status || badgeMap[cls] || '—';

  const insLabel = (() => {
    const pct = ruNum(r.insurance_pct);
    return !isNaN(pct) && pct > 0 ? `Страховка ${pct}%` : 'Страховка';
  })();

  const costRows = [
    ['Стоимость груза', r.cargo_cost],
    [insLabel,          r.insurance_usd],
    ['Упаковка',        r.packaging],
    ['Погрузка',        r.loading],
  ].filter(([, v]) => ruNum(v) > 0);

  // Efficiency: price/kg + density
  const pkg = ruNum(r.price_per_kg);
  const dens = ruNum(r.density);
  const effItems = [];
  if (!isNaN(pkg) && pkg > 0)  effItems.push(`<span class="cc-eff-item"><strong>${fmtMoney(pkg)}</strong> / кг</span>`);
  if (!isNaN(dens) && dens > 0) effItems.push(`<span class="cc-eff-item"><strong>${fmtRuNum(dens, 0)}</strong> кг/м³</span>`);
  const efficiencyRow = effItems.length
    ? `<div class="cc-efficiency">${effItems.join('<span class="cc-eff-sep">·</span>')}</div>`
    : '';

  // Status timeline (3 steps: загружен → в пути → прибыл)
  const tl = (() => {
    if (cls === 'delivered') return ['done','done','done'];
    if (cls === 'transit')   return ['done','active',''];
    if (cls === 'warehouse') return ['warehouse-active','',''];
    return ['','',''];
  })();

  // Smart arrival
  const arr = smartArrivalLabel(r);
  const arrivalRow = arr ? `
    <div class="cc-arrival ${arr.kind}">
      <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        ${arr.kind === 'delivered'
          ? '<polyline points="20 6 9 17 4 12"/>'
          : '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'}
      </svg>
      <strong>${esc(arr.label)}</strong>
      <span style="margin-left:auto;opacity:.7">${esc(arr.date)}</span>
    </div>` : '';

  const cargoNum = r.cargo_number || '—';
  const detailUrl = `/cargo-detail.html?id=${encodeURIComponent(cargoNum)}`;

  return `
  <a class="cargo-card ${cls}" href="${esc(detailUrl)}" data-cargo="${esc(cargoNum)}">
    <div class="cc-head">
      <div class="cc-number-wrap">
        <span class="cc-number" title="${esc(cargoNum)}">${esc(cargoNum)}</span>
        <button class="cc-copy" onclick="copyCargoNum(event, this, '${esc(cargoNum)}')" title="Скопировать">
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
      </div>
      <div class="cc-badge ${cls}">${esc(badgeLabel)}</div>
    </div>
    <div class="cc-meta">
      <span>${esc(fmtDate(r.date))}</span>
      ${r.category ? `<span class="cc-meta-dot">·</span><span class="cc-cat-tag">${esc(r.category)}</span>` : ''}
    </div>
    <div class="cc-timeline">
      <div class="cc-tl-step ${tl[0]}"></div>
      <div class="cc-tl-step ${tl[1]}"></div>
      <div class="cc-tl-step ${tl[2]}"></div>
    </div>
    <div class="cc-tl-labels">
      <span>Загружен</span><span>В пути</span><span>Прибыл</span>
    </div>
    <div class="cc-metrics">
      <div class="cc-metric">
        <span class="cc-m-val">${esc(r.places || '—')}</span>
        <span class="cc-m-lbl">мест</span>
      </div>
      <div class="cc-metric">
        <span class="cc-m-val">${esc(fmtRuNum(r.weight, 1))}</span>
        <span class="cc-m-lbl">кг</span>
      </div>
      <div class="cc-metric">
        <span class="cc-m-val">${esc(fmtRuNum(r.volume, 3))}</span>
        <span class="cc-m-lbl">м³</span>
      </div>
    </div>
    ${efficiencyRow}
    <div class="cc-cost">
      ${costRows.map(([lbl, val]) => `
        <div class="cc-cost-row dim">
          <span>${esc(lbl)}</span>
          <span>${esc(fmtMoney(val))}</span>
        </div>`).join('')}
      ${costRows.length ? '<div class="cc-cost-divider"></div>' : ''}
      <div class="cc-cost-total">
        <span class="cc-cost-total-lbl">Итого</span>
        <span class="cc-cost-total-val">${esc(fmtMoney(r.total))}</span>
      </div>
    </div>
    ${arrivalRow}
  </a>`;
}

// Copy cargo number (preserve event so card link doesn't trigger)
function copyCargoNum(e, btn, val) {
  e.preventDefault();
  e.stopPropagation();
  navigator.clipboard.writeText(val).then(() => {
    btn.classList.add('copied');
    btn.innerHTML = '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = '<svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    }, 1500);
  });
}

// ─── Export CSV ──────────────────────────────────────────────────────────────
function exportCargoCSV() {
  const items = getSortedShipments(getFilteredShipments());
  if (!items.length) return;

  const headers = ['Номер груза','Дата','Категория','Статус','Мест','Вес (кг)','Объём (м³)','Цена/кг','Плотность','Стоимость груза','Страховка %','Страховка $','Упаковка','Погрузка','Итого','Прибытие'];
  const rows = items.map(r => [
    r.cargo_number, r.date, r.category, r.status,
    r.places, r.weight, r.volume, r.price_per_kg, r.density,
    r.cargo_cost, r.insurance_pct, r.insurance_usd, r.packaging, r.loading, r.total, r.arrival
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
  return `<button class="photo-icon-btn" onclick="openPhotoModal('${esc(url)}')" title="${esc(label)}">
    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
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
      <button class="card-photo-btn" onclick="openPhotoModal('${esc(url)}')">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        ${esc(lbl)}
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
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePhotoModal(); });

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

  loadData();
})();
