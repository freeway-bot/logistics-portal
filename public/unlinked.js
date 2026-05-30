// unlinked.js — отправленные треки без привязки к коду груза

checkAuth(['admin', 'employee']);

const PAGE_SIZE = 50;

let allData     = [];
let filtered    = [];
let selected    = new Set();
let currentPage = 1;

// ─── DOM refs ────────────────────────────────────────────────────────────────

const stateLoading   = document.getElementById('stateLoading');
const stateError     = document.getElementById('stateError');
const stateEmpty     = document.getElementById('stateEmpty');
const stateTable     = document.getElementById('stateTable');
const tableBody      = document.getElementById('tableBody');
const pageInfo       = document.getElementById('pageInfo');
const prevBtn        = document.getElementById('prevBtn');
const nextBtn        = document.getElementById('nextBtn');
const clientFilter   = document.getElementById('clientFilter');
const searchInput    = document.getElementById('searchInput');
const selectAllCheck = document.getElementById('selectAllCheck');
const headerCheck    = document.getElementById('headerCheck');
const toolbarCount   = document.getElementById('toolbarCount');
const actionBar      = document.getElementById('actionBar');
const selectedCount  = document.getElementById('selectedCount');
const cargoInput     = document.getElementById('cargoInput');
const linkBtn        = document.getElementById('linkBtn');
const deselectBtn    = document.getElementById('deselectBtn');
const statTotal      = document.getElementById('statTotal');
const statClients    = document.getElementById('statClients');

// ─── State helpers ────────────────────────────────────────────────────────────

function showState(state) {
  stateLoading.classList.toggle('hidden', state !== 'loading');
  stateError.classList.toggle('hidden',   state !== 'error');
  stateEmpty.classList.toggle('hidden',   state !== 'empty');
  stateTable.classList.toggle('hidden',   state !== 'table');
}

// ─── Load ─────────────────────────────────────────────────────────────────────

async function loadData() {
  showState('loading');
  selected.clear();
  updateActionBar();
  try {
    const res  = await fetch('/api/admin/unlinked-parcels');
    if (res.status === 401) { window.location.href = '/'; return; }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка загрузки');

    allData = body.data || [];

    if (allData.length === 0) { showState('empty'); return; }

    // Fill client filter
    const clients = [...new Set(allData.map(r => r.client_id).filter(Boolean))].sort();
    clientFilter.innerHTML = '<option value="">Все клиенты</option>' +
      clients.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    statTotal.textContent   = allData.length;
    statClients.textContent = clients.length;

    applyFilter();
    showState('table');
  } catch (err) {
    document.getElementById('errorMsg').textContent = err.message;
    showState('error');
  }
}

// ─── Filter ───────────────────────────────────────────────────────────────────

function applyFilter() {
  const client = clientFilter.value;
  const q      = searchInput.value.trim().toLowerCase();
  filtered = allData.filter(r => {
    if (client && r.client_id !== client) return false;
    if (q && !(r.track_number || '').toLowerCase().includes(q)) return false;
    return true;
  });
  currentPage = 1;
  render();
}

clientFilter.addEventListener('change', applyFilter);
searchInput.addEventListener('input', applyFilter);

// ─── Render table ─────────────────────────────────────────────────────────────

function render() {
  const total  = filtered.length;
  const pages  = Math.ceil(total / PAGE_SIZE) || 1;
  currentPage  = Math.max(1, Math.min(currentPage, pages));

  const start  = (currentPage - 1) * PAGE_SIZE;
  const end    = Math.min(start + PAGE_SIZE, total);
  const rows   = filtered.slice(start, end);

  tableBody.innerHTML = rows.map(r => {
    const chk = selected.has(r.track_number);
    return `<tr class="${chk ? 'selected' : ''}" data-track="${esc(r.track_number)}">
      <td><input type="checkbox" ${chk ? 'checked' : ''} data-track="${esc(r.track_number)}" class="row-check" /></td>
      <td><span class="track-mono">${esc(r.track_number || '—')}</span></td>
      <td><span class="client-chip">${esc(r.client_id || '—')}</span></td>
      <td style="color:var(--text-2);font-size:12px">${esc(r.date || '—')}</td>
      <td style="color:var(--text-2)">${esc(r.category || '—')}</td>
    </tr>`;
  }).join('');

  // Attach row checkbox listeners
  tableBody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => toggleTrack(cb.dataset.track, cb.checked));
  });

  // Header checkbox state
  const pageSelected = rows.filter(r => selected.has(r.track_number)).length;
  headerCheck.checked       = rows.length > 0 && pageSelected === rows.length;
  headerCheck.indeterminate = pageSelected > 0 && pageSelected < rows.length;

  // selectAll checkbox state
  selectAllCheck.checked       = filtered.length > 0 && filtered.every(r => selected.has(r.track_number));
  selectAllCheck.indeterminate = false;

  // Toolbar count
  toolbarCount.textContent = `${total} трек${total === 1 ? '' : total < 5 ? 'а' : 'ов'}`;

  // Pagination
  pageInfo.textContent = total > 0 ? `Показано ${start + 1}–${end} из ${total}` : 'Нет результатов';
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= pages;

  updateActionBar();
}

// ─── Selection ────────────────────────────────────────────────────────────────

function toggleTrack(track, checked) {
  if (checked) selected.add(track);
  else         selected.delete(track);
  // Update row style
  const row = tableBody.querySelector(`tr[data-track="${esc(track)}"]`);
  if (row) row.classList.toggle('selected', checked);
  syncHeaderCheck();
  updateActionBar();
}

function syncHeaderCheck() {
  const start = (currentPage - 1) * PAGE_SIZE;
  const rows  = filtered.slice(start, start + PAGE_SIZE);
  const pageSelected = rows.filter(r => selected.has(r.track_number)).length;
  headerCheck.checked       = rows.length > 0 && pageSelected === rows.length;
  headerCheck.indeterminate = pageSelected > 0 && pageSelected < rows.length;
  selectAllCheck.checked       = filtered.length > 0 && filtered.every(r => selected.has(r.track_number));
  selectAllCheck.indeterminate = false;
}

headerCheck.addEventListener('change', () => {
  const start = (currentPage - 1) * PAGE_SIZE;
  const rows  = filtered.slice(start, start + PAGE_SIZE);
  rows.forEach(r => { if (headerCheck.checked) selected.add(r.track_number); else selected.delete(r.track_number); });
  render();
});

selectAllCheck.addEventListener('change', () => {
  if (selectAllCheck.checked) filtered.forEach(r => selected.add(r.track_number));
  else                         filtered.forEach(r => selected.delete(r.track_number));
  render();
});

// ─── Action bar ───────────────────────────────────────────────────────────────

function updateActionBar() {
  const n = selected.size;
  selectedCount.textContent = n;
  actionBar.classList.toggle('visible', n > 0);
}

deselectBtn.addEventListener('click', () => {
  selected.clear();
  render();
});

// ─── Pagination ───────────────────────────────────────────────────────────────

prevBtn.addEventListener('click', () => { currentPage--; render(); window.scrollTo(0, 0); });
nextBtn.addEventListener('click', () => { currentPage++; render(); window.scrollTo(0, 0); });

// ─── Link action ──────────────────────────────────────────────────────────────

linkBtn.addEventListener('click', async () => {
  const cargo = cargoInput.value.trim();
  if (!cargo) { cargoInput.focus(); toast('Введите номер груза', 'error'); return; }
  if (selected.size === 0) return;

  const tracks = [...selected];
  linkBtn.disabled    = true;
  linkBtn.textContent = 'Привязываем…';

  try {
    const res = await fetch('/api/admin/shipments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tracks, cargo_number: cargo, link_only: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    const linked = data.updated || 0;
    const notFound = (data.notFound || []).length;
    toast(
      linked > 0
        ? `${linked} трек${linked === 1 ? '' : linked < 5 ? 'а' : 'ов'} привязано к грузу ${cargo}`
        : 'Ни один трек не привязан',
      linked > 0 ? 'success' : 'error'
    );

    // Remove successfully linked tracks from list
    if (linked > 0) {
      const linkedSet = new Set(tracks.slice(0, linked));
      // Re-fetch to get accurate state
      await loadData();
    }
    cargoInput.value = '';
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    linkBtn.disabled    = false;
    linkBtn.textContent = 'Привязать к грузу →';
  }
});

// ─── Cargo lookup ─────────────────────────────────────────────────────────────

const lookupInput    = document.getElementById('lookupInput');
const lookupBtn      = document.getElementById('lookupBtn');
const lookupResult   = document.getElementById('lookupResult');
const lookupBody     = document.getElementById('lookupBody');
const lookupEmpty    = document.getElementById('lookupEmpty');
const lookupTotal    = document.getElementById('lookupTotal');
const lookupCargoLbl = document.getElementById('lookupCargoLabel');
const lookupClearBtn = document.getElementById('lookupClearBtn');

const STATUS_LABELS = {
  'на складе': { label: 'На складе',  cls: 'badge-warning' },
  'отправлено': { label: 'Отправлено', cls: 'badge-info'    },
  'доставлено': { label: 'Доставлено', cls: 'badge-success'  },
  'упаковано':  { label: 'Упаковано',  cls: 'badge-warning' },
};

function statusBadge(s) {
  const sl = (s || '').toLowerCase().trim();
  const info = STATUS_LABELS[sl];
  if (info) return `<span class="badge ${info.cls}">${esc(info.label)}</span>`;
  return s ? `<span class="badge">${esc(s)}</span>` : '<span style="color:var(--text-3)">—</span>';
}

async function runLookup() {
  const cargo = lookupInput.value.trim();
  if (!cargo) { lookupInput.focus(); return; }

  lookupBtn.disabled    = true;
  lookupBtn.textContent = 'Ищем…';

  try {
    const res  = await fetch(`/api/admin/cargo-tracks?cargo_number=${encodeURIComponent(cargo)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка');

    lookupCargoLbl.textContent = cargo.toUpperCase();
    lookupTotal.textContent    = data.total;
    lookupResult.style.display = 'block';

    if (data.total === 0) {
      lookupBody.innerHTML       = '';
      lookupEmpty.style.display  = 'block';
    } else {
      lookupEmpty.style.display  = 'none';
      lookupBody.innerHTML = data.data.map(r => `
        <tr>
          <td><span class="track-mono">${esc(r.track_number || '—')}</span></td>
          <td><span class="client-chip">${esc(r.client_id || '—')}</span></td>
          <td style="color:var(--text-2)">${esc(r.category || '—')}</td>
          <td style="color:var(--text-2);font-size:12px">${esc(r.date || '—')}</td>
          <td>${statusBadge(r.status)}</td>
          <td style="color:var(--text-3);font-size:12px">${esc(r.date_linked || '—')}</td>
        </tr>`).join('');
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    lookupBtn.disabled    = false;
    lookupBtn.textContent = 'Найти →';
  }
}

lookupBtn.addEventListener('click', runLookup);
lookupInput.addEventListener('keydown', e => { if (e.key === 'Enter') runLookup(); });
lookupClearBtn.addEventListener('click', () => {
  lookupInput.value          = '';
  lookupResult.style.display = 'none';
  lookupInput.focus();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

loadData();
