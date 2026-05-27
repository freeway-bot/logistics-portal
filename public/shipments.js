// shipments.js — список отгрузок из «送货 Логистика»

function parseDate(s) {
  if (!s) return null;
  const m = s.toString().trim().match(/^(\d{1,2})[.,/](\d{1,2})[.,/](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function transitDaysCell(shipped, arrival, status) {
  const s = parseDate(shipped);
  if (!s) return '<span style="color:var(--text-3)">—</span>';
  const sl = (status || '').toLowerCase();
  const isDelivered = /доставл|delivered|получен/.test(sl);
  const arrived = parseDate(arrival);
  const end = isDelivered ? (arrived || null) : new Date();
  if (!end) return isDelivered ? '<span style="font-size:12px;color:#5b21b6;font-weight:600">Доставлено</span>' : '<span style="color:var(--text-3)">—</span>';
  const days = Math.round((end - s) / 86400000);
  if (days < 0) return '<span style="color:var(--text-3)">—</span>';
  if (isDelivered) {
    return `<span style="font-size:12px;color:#5b21b6;font-weight:600">${days} дн.</span>`;
  }
  return `<span style="font-size:12px;color:#065f46;font-weight:600">${days} дн.</span>`;
}

let allData      = [];   // полный список с сервера
let filtered     = [];   // после фильтра + поиска
let sortCol      = 'shipped_at';
let sortDir      = 'desc';
let currentPage  = 1;
const PAGE_SIZE  = 50;

// ─── Загрузка ─────────────────────────────────────────────────────────────────

async function loadShipments() {
  showState('loading');
  try {
    const res  = await fetch('/api/admin/shipments?limit=2000');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка загрузки');

    allData = body.data || [];
    buildStatusPills();
    applyFilters();
    showState(filtered.length ? 'content' : 'empty');
  } catch (err) {
    toast(err.message, 'error');
    showState('empty');
  }
}

// ─── Статусы → пилюли ─────────────────────────────────────────────────────────

function buildStatusPills() {
  const counts = {};
  allData.forEach(s => {
    const key = (s.status || '').trim() || '—';
    counts[key] = (counts[key] || 0) + 1;
  });

  const row = document.getElementById('pillRow');
  // Сохраняем кнопку «Все» и убираем остальные
  const allBtn = row.querySelector('[data-status=""]');
  row.innerHTML = '';
  allBtn.textContent = `Все (${allData.length})`;
  allBtn.classList.add('active');
  row.appendChild(allBtn);

  // Уникальные статусы по убыванию count
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, cnt]) => {
      const btn = document.createElement('button');
      btn.className = 's-pill';
      btn.dataset.status = status === '—' ? '__empty__' : status;
      btn.textContent = `${status} (${cnt})`;
      row.appendChild(btn);
    });
}

// ─── Фильтрация + поиск ───────────────────────────────────────────────────────

function getActiveStatus() {
  const el = document.querySelector('.s-pill.active');
  return el ? el.dataset.status : '';
}

function applyFilters() {
  const statusKey = getActiveStatus();
  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();

  filtered = allData.filter(s => {
    // Фильтр по статусу
    if (statusKey === '__empty__') {
      if ((s.status || '').trim()) return false;
    } else if (statusKey) {
      if ((s.status || '').toLowerCase() !== statusKey.toLowerCase()) return false;
    }
    // Поиск
    if (q) {
      const hay = [s.shipment_id, s.client_id, s.category, s.route, s.carrier]
        .join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  sortFiltered();
  currentPage = 1;
  renderPage();
}

// ─── Сортировка ───────────────────────────────────────────────────────────────

function sortFiltered() {
  filtered.sort((a, b) => {
    let va = (a[sortCol] || '');
    let vb = (b[sortCol] || '');

    // Числовые поля
    if (sortCol === 'total') {
      const na = parseFloat(va) || 0;
      const nb = parseFloat(vb) || 0;
      return sortDir === 'asc' ? na - nb : nb - na;
    }

    // Даты
    if (sortCol === 'shipped_at') {
      const da = parseRuDate(va), db = parseRuDate(vb);
      if (da && db) return sortDir === 'asc' ? da - db : db - da;
      if (da) return sortDir === 'asc' ? -1 : 1;
      if (db) return sortDir === 'asc' ? 1 : -1;
    }

    va = va.toString().toLowerCase();
    vb = vb.toString().toLowerCase();
    return sortDir === 'asc' ? va.localeCompare(vb, 'ru') : vb.localeCompare(va, 'ru');
  });

  // Обновляем иконки сортировки
  document.querySelectorAll('.sort-icon').forEach(el => {
    el.textContent = '↕';
    el.classList.remove('active');
  });
  const icon = document.getElementById(`si-${sortCol}`);
  if (icon) {
    icon.textContent = sortDir === 'asc' ? '↑' : '↓';
    icon.classList.add('active');
  }
}

function parseRuDate(s) {
  if (!s) return null;
  // DD.MM.YYYY
  const m = s.toString().trim().match(/^(\d{1,2})[.,/](\d{1,2})[.,/](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

// ─── Рендер ───────────────────────────────────────────────────────────────────

function statusBadge(status) {
  if (!status || !status.trim()) return '<span class="badge badge-empty">—</span>';
  const v = status.toLowerCase();
  let cls = 'badge-empty';
  if (v.includes('пути') || v.includes('transit'))      cls = 'badge-transit';
  else if (v.includes('доставл') || v.includes('delivered')) cls = 'badge-delivered';
  else if (v.includes('отправл') || v.includes('shipped'))   cls = 'badge-shipped';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

function metricChip(label, value, unit = '') {
  if (!value || value === '—') return '';
  return `<span class="metric-chip">${label}&nbsp;<b>${esc(value)}${unit ? ' ' + unit : ''}</b></span>`;
}

function renderPage() {
  const total  = filtered.length;
  const pages  = Math.ceil(total / PAGE_SIZE) || 1;
  currentPage  = Math.min(currentPage, pages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const slice  = filtered.slice(offset, offset + PAGE_SIZE);

  const tbody = document.getElementById('shipBody');

  if (slice.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-3);font-size:13px">
      Ничего не найдено. Попробуйте изменить фильтр или поиск.
    </td></tr>`;
  } else {
    tbody.innerHTML = slice.map(s => {
      const id   = s.shipment_id || '—';
      const date = s.shipped_at  || '—';

      const metrics = [
        metricChip('📦', s.total_places, 'мест'),
        metricChip('⚖️', s.total_weight, 'кг'),
        metricChip('📐', s.total_volume, 'м³'),
      ].filter(Boolean).join('') || '<span style="color:var(--text-3);font-size:12px">—</span>';

      return `<tr class="ship-row" onclick="location.href='/shipment-detail.html?id=${encodeURIComponent(id)}'">
        <td>
          <div class="cargo-num">${esc(id)}</div>
        </td>
        <td style="color:var(--text-2);font-size:12px;font-weight:600">${s.client_id ? esc(s.client_id) : '<span style="color:var(--text-3)">—</span>'}</td>
        <td style="white-space:nowrap;color:var(--text-2);font-size:12px">${esc(date)}</td>
        <td><div class="metrics">${metrics}</div></td>
        <td style="font-weight:700;color:var(--text)">${s.total ? '$' + esc(s.total) : '<span style="color:var(--text-3)">—</span>'}</td>
        <td>${statusBadge(s.status)}</td>
        <td style="text-align:center">${transitDaysCell(s.shipped_at, s.arrival, s.status)}</td>
      </tr>`;
    }).join('');
  }

  // Footer / пагинация
  const footer = document.getElementById('shipFooter');
  if (pages > 1) {
    footer.style.display = 'flex';
    document.getElementById('pageLabel').textContent = `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} из ${total}`;
    document.getElementById('prevBtn').disabled = currentPage <= 1;
    document.getElementById('nextBtn').disabled = currentPage >= pages;
  } else {
    footer.style.display = 'none';
  }
}

// ─── Состояния ────────────────────────────────────────────────────────────────

function showState(s) {
  document.getElementById('loadingState').classList.toggle('hidden', s !== 'loading');
  document.getElementById('emptyState').classList.toggle('hidden',   s !== 'empty');
  document.getElementById('content').classList.toggle('hidden',      s !== 'content');

  if (s === 'empty' && allData.length > 0) {
    // Данные есть, но фильтр/поиск ничего не нашёл — показываем content с пустой таблицей
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
  }
}

// ─── События ──────────────────────────────────────────────────────────────────

// Поиск с дебаунсом
let searchTimer;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFilters, 200);
});

// Фильтр по статусу
document.getElementById('pillRow').addEventListener('click', e => {
  const pill = e.target.closest('.s-pill');
  if (!pill) return;
  document.querySelectorAll('.s-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  applyFilters();
});

// Сортировка по колонкам
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = col === 'shipped_at' ? 'desc' : 'asc';
    }
    sortFiltered();
    renderPage();
  });
});

// Пагинация
document.getElementById('prevBtn').addEventListener('click', () => { currentPage--; renderPage(); });
document.getElementById('nextBtn').addEventListener('click', () => { currentPage++; renderPage(); });

// Refresh (кнопка в хедере)
document.addEventListener('refreshPage', () => { allData = []; loadShipments(); });

// ─── Старт ────────────────────────────────────────────────────────────────────
checkAuth(['admin', 'employee']).then(user => { if (user) loadShipments(); });
