// tasks.js — анализ незаполненных данных по грузам

let allTasks  = [];   // все грузы с проблемами
let filtered  = [];
let activeFilter = 'all';
let currentPage  = 1;
const PAGE_SIZE  = 50;

function pf(v) { return parseFloat(String(v || '').replace(',', '.').replace('%', '')); }

// ─── Определение проблем по грузу ─────────────────────────────────────────────

const CHECKS = [
  {
    key:   'no_total',
    label: 'Нет суммы ($)',
    tag:   'tag-missing',
    group: 'critical',
    test:  s => !pf(s.total),
  },
  {
    key:   'no_weight',
    label: 'Нет веса',
    tag:   'tag-missing',
    group: 'critical',
    test:  s => !pf(s.total_weight),
  },
  {
    key:   'no_volume',
    label: 'Нет объёма',
    tag:   'tag-missing',
    group: 'critical',
    test:  s => !pf(s.total_volume),
  },
  {
    key:   'no_places',
    label: 'Нет мест',
    tag:   'tag-warn',
    group: 'warn',
    test:  s => !pf(s.total_places),
  },
  {
    key:   'no_status',
    label: 'Нет статуса',
    tag:   'tag-warn',
    group: 'warn',
    test:  s => !(s.status || '').trim(),
  },
  {
    key:   'no_arrival',
    label: 'Нет даты прибытия',
    tag:   'tag-warn',
    group: 'warn',
    test:  s => !(s.arrival || '').trim(),
  },
  {
    key:   'no_client',
    label: 'Нет клиента',
    tag:   'tag-missing',
    group: 'critical',
    test:  s => !(s.client_id || '').trim(),
  },
];

function analyzeShipment(s) {
  const issues = CHECKS.filter(c => c.test(s));
  const criticalCount = issues.filter(i => i.group === 'critical').length;
  const warnCount     = issues.filter(i => i.group === 'warn').length;

  let priority = 'low';
  if (criticalCount >= 2)           priority = 'high';
  else if (criticalCount === 1)     priority = 'high';
  else if (warnCount >= 2)          priority = 'medium';
  else if (warnCount === 1)         priority = 'low';

  return { ...s, issues, priority, issueCount: issues.length };
}

// ─── Загрузка ─────────────────────────────────────────────────────────────────

async function loadTasks() {
  try {
    const res  = await fetch('/api/admin/shipments?limit=2000');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка загрузки');

    const data = body.data || [];
    // Берём только грузы с хотя бы одной проблемой
    allTasks = data
      .map(analyzeShipment)
      .filter(s => s.issueCount > 0)
      .sort((a, b) => {
        const pOrder = { high: 0, medium: 1, low: 2 };
        return pOrder[a.priority] - pOrder[b.priority];
      });

    buildSummary(data, allTasks);
    buildFilterPills();
    applyFilter();

    document.getElementById('loadingState').classList.add('hidden');
    document.getElementById('content').classList.remove('hidden');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function buildSummary(allData, tasks) {
  const noTotal   = tasks.filter(s => s.issues.some(i => i.key === 'no_total')).length;
  const noWeight  = tasks.filter(s => s.issues.some(i => i.key === 'no_weight')).length;
  const noVolume  = tasks.filter(s => s.issues.some(i => i.key === 'no_volume')).length;
  const noArrival = tasks.filter(s => s.issues.some(i => i.key === 'no_arrival')).length;
  const noClient  = tasks.filter(s => s.issues.some(i => i.key === 'no_client')).length;
  const noStatus  = tasks.filter(s => s.issues.some(i => i.key === 'no_status')).length;
  const complete  = allData.length - tasks.length;

  const cards = [
    { value: tasks.length,  label: 'Грузов с ошибками', cls: 'c-red',    filter: 'all' },
    { value: noTotal,       label: 'Без суммы $',        cls: 'c-red',    filter: 'no_total' },
    { value: noWeight,      label: 'Без веса',           cls: 'c-amber',  filter: 'no_weight' },
    { value: noVolume,      label: 'Без объёма',         cls: 'c-amber',  filter: 'no_volume' },
    { value: noArrival,     label: 'Без даты прибытия',  cls: 'c-blue',   filter: 'no_arrival' },
    { value: noClient,      label: 'Без клиента',        cls: 'c-purple', filter: 'no_client' },
    { value: noStatus,      label: 'Без статуса',        cls: 'c-amber',  filter: 'no_status' },
    { value: complete,      label: 'Полностью заполнено',cls: 'c-gray',   filter: null },
  ];

  document.getElementById('summaryGrid').innerHTML = cards.map(c => `
    <div class="summary-card ${c.cls}${c.filter === activeFilter ? ' active' : ''}"
      ${c.filter ? `data-filter="${c.filter}"` : ''} style="${!c.filter ? 'cursor:default' : ''}">
      <div class="summary-card-value">${c.value}</div>
      <div class="summary-card-label">${c.label}</div>
    </div>`).join('');

  document.getElementById('summaryGrid').addEventListener('click', e => {
    const card = e.target.closest('.summary-card[data-filter]');
    if (!card) return;
    activeFilter = card.dataset.filter;
    document.querySelectorAll('.summary-card').forEach(c =>
      c.classList.toggle('active', c.dataset.filter === activeFilter));
    document.querySelectorAll('.filter-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.filter === activeFilter));
    currentPage = 1;
    applyFilter();
  });
}

// ─── Filter pills ─────────────────────────────────────────────────────────────

function buildFilterPills() {
  const pills = [
    { key: 'all',      label: 'Все' },
    { key: 'high',     label: 'Критичные' },
    { key: 'medium',   label: 'Важные' },
    { key: 'no_total', label: 'Без суммы' },
    { key: 'no_arrival', label: 'Без даты' },
  ];

  document.getElementById('filterPills').innerHTML = pills.map(p => `
    <button class="filter-pill${p.key === activeFilter ? ' active' : ''}" data-filter="${p.key}">
      ${p.label}
    </button>`).join('');

  document.getElementById('filterPills').addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    activeFilter = pill.dataset.filter;
    document.querySelectorAll('.filter-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.filter === activeFilter));
    document.querySelectorAll('.summary-card').forEach(c =>
      c.classList.toggle('active', c.dataset.filter === activeFilter));
    currentPage = 1;
    applyFilter();
  });
}

// ─── Filter + search ──────────────────────────────────────────────────────────

function applyFilter() {
  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();

  filtered = allTasks.filter(s => {
    // По типу проблемы или приоритету
    if (activeFilter === 'high' || activeFilter === 'medium') {
      if (s.priority !== activeFilter) return false;
    } else if (activeFilter && activeFilter !== 'all') {
      if (!s.issues.some(i => i.key === activeFilter)) return false;
    }

    // Поиск
    if (q) {
      const hay = [s.shipment_id, s.client_id, s.shipped_at].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });

  document.getElementById('countLabel').textContent =
    filtered.length === allTasks.length
      ? `${filtered.length} грузов с задачами`
      : `${filtered.length} из ${allTasks.length}`;

  currentPage = 1;
  renderPage();
}

// ─── Render ───────────────────────────────────────────────────────────────────

function priorityDot(p) {
  const cls = { high: 'priority-high', medium: 'priority-medium', low: 'priority-low' }[p];
  const title = { high: 'Критично', medium: 'Важно', low: 'Некритично' }[p];
  return `<span class="priority-dot ${cls}" title="${title}"></span>`;
}

function renderPage() {
  const total  = filtered.length;
  const pages  = Math.ceil(total / PAGE_SIZE) || 1;
  currentPage  = Math.min(currentPage, pages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const slice  = filtered.slice(offset, offset + PAGE_SIZE);

  const tbody = document.getElementById('tasksBody');

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-3);font-size:13px">
      Задач по выбранному фильтру нет
    </td></tr>`;
  } else {
    tbody.innerHTML = slice.map(s => {
      const tags = s.issues.map(i =>
        `<span class="tag ${i.tag}">${i.label}</span>`
      ).join('');

      const countCls = s.issueCount >= 3 ? '' : s.issueCount >= 2 ? 'warn' : 'ok';

      // Детали: что заполнено
      const filled = [];
      if (pf(s.total))        filled.push(`$${s.total}`);
      if (pf(s.total_weight)) filled.push(`${s.total_weight} кг`);
      if (pf(s.total_volume)) filled.push(`${s.total_volume} м³`);
      if (pf(s.total_places)) filled.push(`${s.total_places} мест`);
      const filledHtml = filled.length
        ? filled.map(f => `<span class="tag tag-ok">${esc(f)}</span>`).join('')
        : `<span style="color:var(--text-3);font-size:11px">нет данных</span>`;

      return `<tr class="task-row" onclick="location.href='/shipment-detail.html?id=${encodeURIComponent(s.shipment_id)}'">
        <td style="text-align:center">${priorityDot(s.priority)}</td>
        <td>
          <div class="cargo-id">${esc(s.shipment_id || '—')}</div>
        </td>
        <td style="color:var(--text-2)">${esc(s.client_id || '—')}</td>
        <td style="color:var(--text-3);font-size:11px;white-space:nowrap">${esc(s.shipped_at || '—')}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="issue-count ${countCls}">${s.issueCount}</span>
            <div class="tag-row">${tags}</div>
          </div>
        </td>
        <td>
          <div class="tag-row">${filledHtml}</div>
        </td>
      </tr>`;
    }).join('');
  }

  // Pagination
  const footer = document.getElementById('tasksFooter');
  if (pages > 1) {
    footer.style.display = 'flex';
    document.getElementById('pageLabel').textContent =
      `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} из ${total}`;
    document.getElementById('prevBtn').disabled = currentPage <= 1;
    document.getElementById('nextBtn').disabled = currentPage >= pages;
  } else {
    footer.style.display = 'none';
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

let searchTimer;
document.getElementById('searchInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFilter, 200);
});

document.getElementById('prevBtn').addEventListener('click', () => { currentPage--; renderPage(); });
document.getElementById('nextBtn').addEventListener('click', () => { currentPage++; renderPage(); });

document.addEventListener('refreshPage', () => {
  allTasks = []; filtered = [];
  document.getElementById('loadingState').classList.remove('hidden');
  document.getElementById('content').classList.add('hidden');
  loadTasks();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
checkAuth(['admin', 'employee']).then(user => { if (user) loadTasks(); });
