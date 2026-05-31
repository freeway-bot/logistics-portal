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
const errorMsg       = document.getElementById('errorMsg');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function showState(state) {
  stateLoading.classList.toggle('hidden', state !== 'loading');
  stateError.classList.toggle('hidden',   state !== 'error');
  stateEmpty.classList.toggle('hidden',   state !== 'empty');
  stateTable.classList.toggle('hidden',   state !== 'table');
}

// Fetch с таймаутом 45 секунд
async function fetchWithTimeout(url, opts = {}, ms = 45000) {
  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(tid);
  }
}

// ─── Load ─────────────────────────────────────────────────────────────────────

async function loadData() {
  showState('loading');
  selected.clear();
  updateActionBar();
  const loadMsg = stateLoading.querySelector('.state-desc');
  if (loadMsg) loadMsg.textContent = 'Подключаемся к серверу…';
  try {
    if (loadMsg) loadMsg.textContent = 'Запрашиваем данные у Google Sheets…';
    const res  = await fetchWithTimeout('/api/admin/unlinked-parcels');
    if (res.status === 401) { window.location.href = '/'; return; }
    if (loadMsg) loadMsg.textContent = 'Обрабатываем ответ…';
    const body = await res.json();
    if (!res.ok) throw new Error(`[${res.status}] ${body.error || 'Ошибка загрузки'}`);

    allData = body.data || [];

    if (allData.length === 0) { showState('empty'); return; }

    // Заполняем фильтр по клиентам
    const clients = [...new Set(allData.map(r => r.client_id).filter(Boolean))].sort();
    clientFilter.innerHTML = '<option value="">Все клиенты</option>' +
      clients.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    statTotal.textContent   = allData.length;
    statClients.textContent = clients.length;

    applyFilter();
    showState('table');
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'Превышено время ожидания (45 сек). Сервер или Google Sheets не отвечает — попробуйте обновить страницу.'
      : (err.message || 'Неизвестная ошибка');
    if (errorMsg) errorMsg.textContent = msg;
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

  tableBody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => toggleTrack(cb.dataset.track, cb.checked));
  });

  const pageSelected = rows.filter(r => selected.has(r.track_number)).length;
  headerCheck.checked       = rows.length > 0 && pageSelected === rows.length;
  headerCheck.indeterminate = pageSelected > 0 && pageSelected < rows.length;

  selectAllCheck.checked       = filtered.length > 0 && filtered.every(r => selected.has(r.track_number));
  selectAllCheck.indeterminate = false;

  toolbarCount.textContent = `${total} трек${total === 1 ? '' : total < 5 ? 'а' : 'ов'}`;

  pageInfo.textContent = total > 0 ? `Показано ${start + 1}–${end} из ${total}` : 'Нет результатов';
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= pages;

  updateActionBar();
}

// ─── Selection ────────────────────────────────────────────────────────────────

function toggleTrack(track, checked) {
  if (checked) selected.add(track);
  else         selected.delete(track);
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
    const res = await fetchWithTimeout('/api/admin/shipments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tracks, cargo_number: cargo, link_only: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    const linked = data.updated || 0;
    toast(
      linked > 0
        ? `${linked} трек${linked === 1 ? '' : linked < 5 ? 'а' : 'ов'} привязано к грузу ${cargo}`
        : 'Ни один трек не привязан',
      linked > 0 ? 'default' : 'error'
    );

    if (linked > 0) {
      cargoInput.value = '';
      await loadData();
    }
  } catch (err) {
    toast(err.name === 'AbortError' ? 'Превышено время ожидания' : err.message, 'error');
  } finally {
    linkBtn.disabled    = false;
    linkBtn.textContent = 'Привязать к грузу →';
  }
});

// ─── Cargo lookup ─────────────────────────────────────────────────────────────

const lookupInput       = document.getElementById('lookupInput');
const lookupBtn         = document.getElementById('lookupBtn');
const lookupResult      = document.getElementById('lookupResult');
const lookupBody        = document.getElementById('lookupBody');
const lookupEmpty       = document.getElementById('lookupEmpty');
const lookupTotal       = document.getElementById('lookupTotal');
const lookupCargoLbl    = document.getElementById('lookupCargoLabel');
const lookupClearBtn    = document.getElementById('lookupClearBtn');
const lookupMissing     = document.getElementById('lookupMissing');
const lookupMissingBody = document.getElementById('lookupMissingBody');
const lookupMissingCount= document.getElementById('lookupMissingCount');
const quickLinkBtn      = document.getElementById('quickLinkBtn');

// Правильные CSS-классы из style.css
const BADGE_STATUS = {
  'на складе':  { label: 'На складе',  cls: 'badge-warehouse' },
  'отправлено': { label: 'Отправлено', cls: 'badge-shipped'   },
  'доставлено': { label: 'Доставлено', cls: 'badge-delivered'  },
  'упаковано':  { label: 'Упаковано',  cls: 'badge-warehouse' },
};

function statusBadge(s) {
  const sl   = (s || '').toLowerCase().trim();
  const info = BADGE_STATUS[sl];
  if (info) return `<span class="badge ${info.cls}">${esc(info.label)}</span>`;
  return s ? `<span class="badge badge-other">${esc(s)}</span>` : '<span style="color:var(--text-3)">—</span>';
}

async function runLookup() {
  const cargo = lookupInput.value.trim();
  if (!cargo) { lookupInput.focus(); return; }

  lookupBtn.disabled    = true;
  lookupBtn.textContent = 'Ищем…';

  try {
    const res  = await fetchWithTimeout(`/api/admin/cargo-tracks?cargo_number=${encodeURIComponent(cargo)}`);
    if (res.status === 401) { window.location.href = '/'; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка');

    lookupCargoLbl.textContent = cargo.toUpperCase();
    lookupTotal.textContent    = data.total;
    lookupResult.style.display = 'block';

    if (data.total === 0) {
      lookupBody.innerHTML      = '';
      lookupEmpty.style.display = 'block';
    } else {
      lookupEmpty.style.display = 'none';
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

    // Показываем непривязанные треки того же клиента
    const missing = data.unlinked_same_client || [];
    if (missing.length > 0) {
      lookupMissingCount.textContent = missing.length;
      lookupMissingBody.innerHTML = missing.map(r => `
        <tr>
          <td><span class="track-mono">${esc(r.track_number || '—')}</span></td>
          <td><span class="client-chip">${esc(r.client_id || '—')}</span></td>
          <td style="color:var(--text-2)">${esc(r.category || '—')}</td>
          <td style="color:var(--text-2);font-size:12px">${esc(r.date || '—')}</td>
        </tr>`).join('');
      lookupMissing.style.display = 'block';
      quickLinkBtn.onclick = () => quickLink(cargo, missing.map(r => r.track_number));
    } else {
      lookupMissing.style.display = 'none';
    }

  } catch (err) {
    toast(err.name === 'AbortError' ? 'Превышено время ожидания' : err.message, 'error');
  } finally {
    lookupBtn.disabled    = false;
    lookupBtn.textContent = 'Найти →';
  }
}

// Быстрая привязка найденных треков к грузу
async function quickLink(cargo, tracks) {
  if (!cargo || !tracks.length) return;
  quickLinkBtn.disabled    = true;
  quickLinkBtn.textContent = 'Привязываем…';
  try {
    const res = await fetchWithTimeout('/api/admin/shipments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tracks, cargo_number: cargo, link_only: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    const linked = data.updated || 0;
    toast(
      linked > 0
        ? `${linked} трек${linked === 1 ? '' : linked < 5 ? 'а' : 'ов'} привязано к грузу ${cargo}`
        : 'Ни один трек не привязан',
      linked > 0 ? 'default' : 'error'
    );

    if (linked > 0) {
      // Обновляем поиск и список непривязанных
      await Promise.all([runLookup(), loadData()]);
    }
  } catch (err) {
    toast(err.name === 'AbortError' ? 'Превышено время ожидания' : err.message, 'error');
  } finally {
    quickLinkBtn.disabled    = false;
    quickLinkBtn.textContent = 'Привязать все к этому грузу →';
  }
}

lookupBtn.addEventListener('click', runLookup);
lookupInput.addEventListener('keydown', e => { if (e.key === 'Enter') runLookup(); });
lookupClearBtn.addEventListener('click', () => {
  lookupInput.value           = '';
  lookupResult.style.display  = 'none';
  lookupMissing.style.display = 'none';
  lookupInput.focus();
});

// ─── Client audit ─────────────────────────────────────────────────────────────

const clientSearchInput   = document.getElementById('clientSearchInput');
const clientSearchBtn     = document.getElementById('clientSearchBtn');
const clientResult        = document.getElementById('clientResult');
const clientResultLabel   = document.getElementById('clientResultLabel');
const clientResultTotal   = document.getElementById('clientResultTotal');
const clientClearBtn      = document.getElementById('clientClearBtn');
const clientCargoBadges   = document.getElementById('clientCargoBadges');
const clientTrackBody     = document.getElementById('clientTrackBody');
const clientEmpty         = document.getElementById('clientEmpty');
const clientActionRow     = document.getElementById('clientActionRow');
const clientSelectedCount = document.getElementById('clientSelectedCount');
const clientCargoInput    = document.getElementById('clientCargoInput');
const clientLinkBtn       = document.getElementById('clientLinkBtn');
const clientDeselectBtn   = document.getElementById('clientDeselectBtn');
const clientHeaderCheck   = document.getElementById('clientHeaderCheck');

let clientSelected = new Set();   // треки, отмеченные в таблице клиента
let clientRows     = [];           // текущий список треков для таблицы

function updateClientActionRow() {
  const n = clientSelected.size;
  clientSelectedCount.textContent = n;
  clientActionRow.style.display   = n > 0 ? 'flex' : 'none';
}

function renderClientTable() {
  clientTrackBody.innerHTML = clientRows.map(r => {
    const unlinked = !r.cargo_number;
    const chk      = clientSelected.has(r.track_number);
    return `<tr style="${unlinked ? 'background:var(--surface-2)' : ''}" data-track="${esc(r.track_number)}">
      <td><input type="checkbox" class="client-row-check"
        data-track="${esc(r.track_number)}" ${chk ? 'checked' : ''}
        style="width:15px;height:15px;accent-color:var(--primary);cursor:pointer" /></td>
      <td><span class="track-mono">${esc(r.track_number || '—')}</span></td>
      <td>${statusBadge(r.status)}</td>
      <td style="color:var(--text-2)">${esc(r.category || '—')}</td>
      <td style="color:var(--text-2);font-size:12px">${esc(r.date || '—')}</td>
      <td style="font-family:'Courier New',monospace;font-size:12px;${unlinked ? 'color:var(--text-3)' : 'color:var(--primary);font-weight:700'}">
        ${unlinked ? '— не привязан' : esc(r.cargo_number)}
      </td>
      <td style="color:var(--text-3);font-size:12px">${esc(r.date_linked || '—')}</td>
    </tr>`;
  }).join('');

  clientTrackBody.querySelectorAll('.client-row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) clientSelected.add(cb.dataset.track);
      else            clientSelected.delete(cb.dataset.track);
      const row = clientTrackBody.querySelector(`tr[data-track="${esc(cb.dataset.track)}"]`);
      if (row) row.style.outline = cb.checked ? '2px solid var(--primary)' : '';
      syncClientHeader();
      updateClientActionRow();
    });
  });

  syncClientHeader();
}

function syncClientHeader() {
  if (!clientRows.length) return;
  const all = clientRows.every(r => clientSelected.has(r.track_number));
  const any = clientRows.some(r => clientSelected.has(r.track_number));
  clientHeaderCheck.checked       = all;
  clientHeaderCheck.indeterminate = any && !all;
}

clientHeaderCheck.addEventListener('change', () => {
  clientRows.forEach(r => {
    if (clientHeaderCheck.checked) clientSelected.add(r.track_number);
    else                           clientSelected.delete(r.track_number);
  });
  renderClientTable();
  updateClientActionRow();
});

clientDeselectBtn.addEventListener('click', () => {
  clientSelected.clear();
  renderClientTable();
  updateClientActionRow();
});

clientLinkBtn.addEventListener('click', async () => {
  const cargo  = clientCargoInput.value.trim();
  if (!cargo)                { clientCargoInput.focus(); toast('Введите код груза', 'error'); return; }
  if (!clientSelected.size)  return;

  const tracks = [...clientSelected];
  clientLinkBtn.disabled    = true;
  clientLinkBtn.textContent = 'Привязываем…';

  try {
    const res = await fetchWithTimeout('/api/admin/shipments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tracks, cargo_number: cargo, link_only: true }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    const linked = data.updated || 0;
    toast(
      linked > 0
        ? `${linked} трек${linked === 1 ? '' : linked < 5 ? 'а' : 'ов'} привязано к ${cargo}`
        : 'Ни один трек не привязан',
      linked > 0 ? 'default' : 'error'
    );

    if (linked > 0) {
      clientCargoInput.value = '';
      clientSelected.clear();
      updateClientActionRow();
      // Обновляем таблицу клиента и список непривязанных
      await Promise.all([runClientSearch(), loadData()]);
    }
  } catch (err) {
    toast(err.name === 'AbortError' ? 'Превышено время ожидания' : err.message, 'error');
  } finally {
    clientLinkBtn.disabled    = false;
    clientLinkBtn.textContent = 'Привязать к грузу →';
  }
});

async function runClientSearch() {
  const clientId = clientSearchInput.value.trim();
  if (!clientId) { clientSearchInput.focus(); return; }

  clientSearchBtn.disabled    = true;
  clientSearchBtn.textContent = 'Ищем…';

  try {
    const res  = await fetchWithTimeout(`/api/admin/client-tracks?client_id=${encodeURIComponent(clientId)}`);
    if (res.status === 401) { window.location.href = '/'; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка');

    clientResultLabel.textContent = clientId.toUpperCase();
    clientResultTotal.textContent = data.total;
    clientResult.style.display    = 'block';

    if (data.total === 0) {
      clientRows = [];
      clientTrackBody.innerHTML   = '';
      clientEmpty.style.display   = 'block';
      clientCargoBadges.innerHTML = '';
      clientSelected.clear();
      updateClientActionRow();
    } else {
      clientEmpty.style.display = 'none';

      // Сводка-бейджи по грузам
      const byCargo = data.by_cargo || {};
      const sorted  = Object.entries(byCargo).sort((a, b) => b[1] - a[1]);
      clientCargoBadges.innerHTML = sorted.map(([cargo, cnt]) => {
        const isUnlinked = cargo === '—';
        const bg  = isUnlinked ? '#fff7ed' : 'var(--primary-bg)';
        const col = isUnlinked ? '#b45309'  : 'var(--primary)';
        const bdr = isUnlinked ? '#fed7aa'  : 'var(--primary-bdr)';
        return `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;
          border-radius:20px;font-size:12px;font-weight:700;background:${bg};color:${col};
          border:1px solid ${bdr};cursor:pointer" title="Отметить все треки этого груза"
          data-cargo="${esc(cargo)}">
          ${isUnlinked ? '⚠ Не привязан' : esc(cargo)}
          <span style="background:${col};color:#fff;border-radius:10px;padding:1px 6px;font-size:11px">${cnt}</span>
        </span>`;
      }).join('');

      // Клик по бейджу — выделяет все треки этого груза
      clientCargoBadges.querySelectorAll('span[data-cargo]').forEach(badge => {
        badge.addEventListener('click', () => {
          const cargo = badge.dataset.cargo;
          clientRows
            .filter(r => (r.cargo_number || '—') === cargo)
            .forEach(r => clientSelected.add(r.track_number));
          renderClientTable();
          updateClientActionRow();
        });
      });

      // Сортируем: сначала непривязанные, потом по коду груза
      clientRows = [...data.data].sort((a, b) => {
        if (!a.cargo_number && b.cargo_number) return -1;
        if (a.cargo_number && !b.cargo_number) return 1;
        return (a.cargo_number || '').localeCompare(b.cargo_number || '');
      });

      clientSelected.clear();
      updateClientActionRow();
      renderClientTable();
    }
  } catch (err) {
    toast(err.name === 'AbortError' ? 'Превышено время ожидания' : err.message, 'error');
  } finally {
    clientSearchBtn.disabled    = false;
    clientSearchBtn.textContent = 'Найти →';
  }
}

clientSearchBtn.addEventListener('click', runClientSearch);
clientSearchInput.addEventListener('keydown', e => { if (e.key === 'Enter') runClientSearch(); });
clientClearBtn.addEventListener('click', () => {
  clientSearchInput.value    = '';
  clientResult.style.display = 'none';
  clientSelected.clear();
  clientRows = [];
  updateClientActionRow();
  clientSearchInput.focus();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

loadData();
