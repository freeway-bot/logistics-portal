// dashboard.js — client dashboard v2

const PER_PAGE = 50;

let allItems  = [];
let activeTab = 'all';
let searchQ   = '';
let sortKey   = 'date';
let sortDir   = 'desc';
let viewMode  = 'table';
let page      = 1;
let clientId  = '';

// ─── DOM ──────────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const el = {
  clientIdDisplay: $('clientIdDisplay'),
  totalCount:      $('totalCount'),
  warehouseCount:  $('warehouseCount'),
  packedCount:     $('packedCount'),
  shippedCount:    $('shippedCount'),
  cntAll:          $('cntAll'),
  cntWarehouse:    $('cntWarehouse'),
  cntPacked:       $('cntPacked'),
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

// ─── Data ─────────────────────────────────────────────────────────────────────

async function loadData() {
  showState('loading');
  try {
    const res  = await fetch(`/api/client/${encodeURIComponent(clientId)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка загрузки');
    allItems = body.data || [];
    updateStats();
    showState('items');
    render();
  } catch (err) {
    el.errorMessage.textContent = err.message;
    showState('error');
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function updateStats() {
  const c = { warehouse: 0, packed: 0, shipped: 0 };
  allItems.forEach(item => { const n = normStatus(item.status); if (n in c) c[n]++; });

  el.totalCount.textContent     = allItems.length;
  el.warehouseCount.textContent = c.warehouse;
  el.packedCount.textContent    = c.packed;
  el.shippedCount.textContent   = c.shipped;
  el.cntAll.textContent         = allItems.length;
  el.cntWarehouse.textContent   = c.warehouse;
  el.cntPacked.textContent      = c.packed;
  el.cntShipped.textContent     = c.shipped;
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
      const da = new Date(va), db = new Date(vb);
      if (!isNaN(da) && !isNaN(db)) return sortDir === 'asc' ? da - db : db - da;
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

function renderTable(items, total, totalPages) {
  el.tableBody.innerHTML = items.map(item => {
    const photos = getPhotos(item);
    const photoCells = photos.map(([url, lbl]) => `
      <button class="photo-icon-btn" onclick="openPhotoModal('${esc(url)}')" title="${esc(lbl)}">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
      </button>`).join('');

    return `<tr>
      <td>
        <div class="cell-track">
          <span class="cell-track-num">${esc(item.track_number||'—')}</span>
          ${item.track_number
            ? `<button class="copy-sm" onclick="copyText('${esc(item.track_number)}','${esc(item.track_number)}')" title="Скопировать">
                <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="13" height="13" rx="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>` : ''}
        </div>
      </td>
      <td class="cell-cat"  title="${esc(item.category||'')}">${esc(item.category||'—')}</td>
      <td><span class="badge ${statusClass(item.status)}">${esc(statusLabel(item.status))}</span></td>
      <td class="cell-box">${esc(item.box_number||'—')}</td>
      <td class="cell-date">${esc(fmtDate(item.date))}</td>
      <td class="cell-comment" title="${esc(item.comment||'')}">${esc(item.comment||'—')}</td>
      <td><div class="cell-photos">${photoCells||'<span style="color:var(--text-3);font-size:12px">—</span>'}</div></td>
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
    const fields = getCardFields(item, false);
    const photos = getPhotos(item);

    return `<div class="card">
      <div class="card-head">
        <div class="card-track-row">
          <span class="card-track-num" title="${esc(item.track_number||'')}">${esc(item.track_number||'—')}</span>
          ${item.track_number
            ? `<button class="copy-btn" onclick="copyText('${esc(item.track_number)}','${esc(item.track_number)}')" title="Скопировать">
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
      ${photos.length ? `
        <div class="card-photos">
          ${photos.map(([url,lbl]) => `
            <button class="card-photo-btn" onclick="openPhotoModal('${esc(url)}')">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              ${esc(lbl)}
            </button>`).join('')}
        </div>` : ''}
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

el.logoutBtn.addEventListener('click', () => { window.location.href = '/'; });

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

(function init() {
  clientId = new URLSearchParams(window.location.search).get('id')?.trim() || '';
  if (!clientId) { window.location.href = '/'; return; }
  el.clientIdDisplay.textContent = clientId;
  document.title = `${clientId} — Мои грузы`;
  loadData();
})();
