// search.js — global track search results page

let results   = [];
let sortKey   = 'date';
let sortDir   = 'desc';
let viewMode  = 'table';
let query     = '';

// ─── DOM ──────────────────────────────────────────────────────────────────────

const el = {
  resultInfo:   document.getElementById('resultInfo'),
  searchInput:  document.getElementById('searchInput'),
  searchBtn:    document.getElementById('searchBtn'),
  controlsBar:  document.getElementById('controlsBar'),
  loadingState: document.getElementById('loadingState'),
  errorState:   document.getElementById('errorState'),
  errorMessage: document.getElementById('errorMessage'),
  tableView:    document.getElementById('tableView'),
  tableBody:    document.getElementById('tableBody'),
  tableInfo:    document.getElementById('tableInfo'),
  gridView:     document.getElementById('gridView'),
  cardsGrid:    document.getElementById('cardsGrid'),
  btnTableView: document.getElementById('btnTableView'),
  btnGridView:  document.getElementById('btnGridView'),
  exportBtn:    document.getElementById('exportBtn'),
  exportMenu:   document.getElementById('exportMenu'),
  exportCSVBtn: document.getElementById('exportCSVBtn'),
  exportXLSXBtn:document.getElementById('exportXLSXBtn'),
  modal:        document.getElementById('photoModal'),
  modalClose:   document.getElementById('modalClose'),
  sortHeaders:  document.querySelectorAll('th.sortable'),
};

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function doSearch(track) {
  query = track;
  showState('loading');
  el.controlsBar.style.display = 'none';
  el.resultInfo.textContent = 'Поиск…';
  el.searchInput.value = track;

  try {
    const res  = await fetch(`/api/search?track=${encodeURIComponent(track)}&limit=500`);
    const body = await res.json();

    if (!res.ok || body.total === 0) {
      el.errorMessage.textContent = body.error || `По запросу «${track}» ничего не найдено`;
      showState('error');
      return;
    }

    results = body.data;
    el.resultInfo.innerHTML = `Найдено <strong>${results.length}</strong> результатов по запросу «<strong>${esc(track)}</strong>»`;
    el.controlsBar.style.display = 'flex';
    document.title = `${track} — Поиск`;

    showState('items');
    render();
  } catch {
    el.errorMessage.textContent = 'Ошибка соединения с сервером';
    showState('error');
  }
}

// ─── Sort + render ────────────────────────────────────────────────────────────

function getSorted() {
  return [...results].sort((a, b) => {
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

function render() {
  const items = getSorted();
  if (viewMode === 'table') {
    el.gridView.classList.add('hidden');
    el.tableView.classList.remove('hidden');
    renderTable(items);
  } else {
    el.tableView.classList.add('hidden');
    el.gridView.classList.remove('hidden');
    renderCards(items);
  }
}

// ─── Table ────────────────────────────────────────────────────────────────────

function renderTable(items) {
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
      <td class="cell-client">${esc(item.client_id||'—')}</td>
      <td><span class="badge ${statusClass(item.status)}">${esc(statusLabel(item.status))}</span></td>
      <td class="cell-cat"   title="${esc(item.category||'')}">${esc(item.category||'—')}</td>
      <td class="cell-box">${esc(item.box_number||'—')}</td>
      <td class="cell-date">${esc(fmtDate(item.date))}</td>
      <td class="cell-comment" title="${esc(item.comment||'')}">${esc(item.comment||'—')}</td>
      <td><div class="cell-photos">${photoCells || '<span style="color:var(--text-3);font-size:12px">—</span>'}</div></td>
    </tr>`;
  }).join('');

  el.tableInfo.textContent = `${items.length} записей`;

  // Sort indicators
  el.sortHeaders.forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === sortKey) th.classList.add(`sort-${sortDir}`);
  });
}

// ─── Cards ────────────────────────────────────────────────────────────────────

function renderCards(items) {
  el.cardsGrid.innerHTML = items.map(item => {
    const fields  = getCardFields(item, true); // show client_id in search results
    const photos  = getPhotos(item);

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
}

// ─── State ────────────────────────────────────────────────────────────────────

function showState(s) {
  el.loadingState.classList.toggle('hidden', s !== 'loading');
  el.errorState.classList.toggle('hidden',   s !== 'error');
  el.tableView.classList.add('hidden');
  el.gridView.classList.add('hidden');
}

// ─── Events ───────────────────────────────────────────────────────────────────

el.searchBtn.addEventListener('click', () => {
  const t = el.searchInput.value.trim();
  if (t.length < 3) return toast('Минимум 3 символа', 'error');
  history.pushState(null, '', `/search.html?track=${encodeURIComponent(t)}`);
  doSearch(t);
});

el.searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') el.searchBtn.click(); });

// Sort
el.sortHeaders.forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    sortDir = (sortKey === key && sortDir === 'asc') ? 'desc' : (key === 'date' ? 'desc' : 'asc');
    sortKey = key;
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

// Export toggle
el.exportBtn.addEventListener('click', () => el.exportMenu.classList.toggle('hidden'));
document.addEventListener('click', e => {
  if (!el.exportBtn.contains(e.target) && !el.exportMenu.contains(e.target)) {
    el.exportMenu.classList.add('hidden');
  }
});

el.exportCSVBtn.addEventListener('click', () => {
  exportCSV(getSorted(), `search_${query}_${today()}.csv`);
  el.exportMenu.classList.add('hidden');
});

el.exportXLSXBtn.addEventListener('click', () => {
  exportXLSX(getSorted(), `search_${query}_${today()}.xlsx`);
  el.exportMenu.classList.add('hidden');
});

// Modal
el.modalClose.addEventListener('click', () => closePhotoModal());
el.modal.addEventListener('click', e => { if (e.target === el.modal) closePhotoModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePhotoModal(); });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(function init() {
  const track = new URLSearchParams(location.search).get('track')?.trim();
  if (!track) { window.location.href = '/'; return; }
  doSearch(track);
})();
