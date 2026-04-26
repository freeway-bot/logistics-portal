// cargo-dashboard.js — аналитический дашборд по грузам

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

function pf(v) { return parseFloat(String(v || '').replace(',', '.').replace('%', '')) || 0; }

let allData      = [];
let activePeriod = 'all'; // 'month' | 'quarter' | 'year' | 'all'

// ─── Утилиты дат ──────────────────────────────────────────────────────────────

function parseDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})[.,/](\d{1,2})[.,/](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function daysDiff(d) {
  return Math.floor((TODAY - d) / 86400000);
}

function formatDate(d) {
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isDelivered(s) {
  const v = (s || '').toLowerCase();
  return v.includes('доставл') || v.includes('delivered');
}

function statusGroup(s) {
  const v = (s || '').toLowerCase().trim();
  if (!v) return 'Без статуса';
  if (v.includes('доставл') || v.includes('delivered')) return 'Доставлено';
  if (v.includes('пути')    || v.includes('transit'))   return 'В пути';
  if (v.includes('отправл') || v.includes('shipped'))   return 'Отправлено';
  return 'Другой';
}

// Если дата прибытия не заполнена → считаем shipped_at + 30 дней
function effectiveArrival(s) {
  const explicit = parseDate(s.arrival);
  if (explicit) return { date: explicit, estimated: false };
  const shipped = parseDate(s.shipped_at);
  if (shipped) {
    const d = new Date(shipped);
    d.setDate(d.getDate() + 30);
    return { date: d, estimated: true };
  }
  return null;
}

// ─── Фильтр по периоду ────────────────────────────────────────────────────────

function getPeriodBounds(period) {
  const now = new Date(TODAY);
  if (period === 'month') {
    const start    = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevEnd  = new Date(start - 1);
    const prevStart= new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
    return { start, end: now, prevStart, prevEnd };
  }
  if (period === 'quarter') {
    const q        = Math.floor(now.getMonth() / 3);
    const start    = new Date(now.getFullYear(), q * 3, 1);
    const prevEnd  = new Date(start - 1);
    const prevStart= new Date(prevEnd.getFullYear(), prevEnd.getMonth() - 2, 1);
    return { start, end: now, prevStart, prevEnd };
  }
  if (period === 'year') {
    const start    = new Date(now.getFullYear(), 0, 1);
    const prevStart= new Date(now.getFullYear() - 1, 0, 1);
    const prevEnd  = new Date(now.getFullYear() - 1, 11, 31);
    return { start, end: now, prevStart, prevEnd };
  }
  return { start: null, end: null, prevStart: null, prevEnd: null };
}

function filterByPeriod(data, period) {
  const { start } = getPeriodBounds(period);
  if (!start) return data;
  return data.filter(s => {
    const d = parseDate(s.shipped_at);
    return d && d >= start;
  });
}

function filterPrevPeriod(data, period) {
  const { prevStart, prevEnd } = getPeriodBounds(period);
  if (!prevStart) return null;
  return data.filter(s => {
    const d = parseDate(s.shipped_at);
    return d && d >= prevStart && d <= prevEnd;
  });
}

function pctDelta(curr, prev) {
  if (!prev || prev === 0) return null;
  return Math.round((curr - prev) / prev * 100);
}

// ─── Загрузка ─────────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const res  = await fetch('/api/admin/shipments?limit=2000');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка загрузки');
    return body.data || [];
  } catch (err) {
    toast(err.message, 'error');
    return [];
  }
}

// ─── Фильтр-тоглы ─────────────────────────────────────────────────────────────

function buildPeriodFilter() {
  const options = [
    { key: 'month',   label: 'Месяц' },
    { key: 'quarter', label: 'Квартал' },
    { key: 'year',    label: 'Год' },
    { key: 'all',     label: 'Всё время' },
  ];
  document.getElementById('periodFilter').innerHTML = options.map(o => `
    <button class="period-btn${o.key === activePeriod ? ' active' : ''}" data-period="${o.key}">${o.label}</button>
  `).join('');

  document.getElementById('periodFilter').addEventListener('click', e => {
    const btn = e.target.closest('.period-btn');
    if (!btn) return;
    activePeriod = btn.dataset.period;
    document.querySelectorAll('.period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === activePeriod));
    rebuild();
  });
}

// ─── KPI карточки ─────────────────────────────────────────────────────────────

function buildKPI(curr, prev) {
  const total     = curr.length;
  const transit   = curr.filter(s => !isDelivered(s.status) && s.status).length;
  const delivered = curr.filter(s => isDelivered(s.status)).length;
  const overdue   = curr.filter(s => {
    const a = effectiveArrival(s);
    return a && !isDelivered(s.status) && daysDiff(a.date) > 0;
  }).length;

  const prevTotals = prev ? {
    total:     prev.length,
    transit:   prev.filter(s => !isDelivered(s.status) && s.status).length,
    delivered: prev.filter(s => isDelivered(s.status)).length,
  } : null;

  function deltaHtml(curr, prevVal) {
    if (prevVal === null || prevVal === undefined) return '';
    const pct = pctDelta(curr, prevVal);
    if (pct === null) return '';
    const up  = pct >= 0;
    const col = up ? '#10b981' : '#ef4444';
    const arr = up ? '↑' : '↓';
    return `<span style="font-size:11px;font-weight:700;color:${col};margin-left:6px">${arr} ${Math.abs(pct)}%</span>`;
  }

  const cards = [
    {
      label: 'Всего грузов', value: total,
      sub: 'в выбранном периоде',
      delta: deltaHtml(total, prevTotals?.total),
      cls: 'blue', href: '/shipments.html',
      icon: `<svg width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/>
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
      </svg>`,
    },
    {
      label: 'В пути / Отправлено', value: transit,
      sub: 'активных грузов',
      delta: deltaHtml(transit, prevTotals?.transit),
      cls: 'amber', href: '/shipments.html',
      icon: `<svg width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/>
        <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
      </svg>`,
    },
    {
      label: 'Доставлено', value: delivered,
      sub: `${total ? Math.round(delivered / total * 100) : 0}% от периода`,
      delta: deltaHtml(delivered, prevTotals?.delivered),
      cls: 'green', href: '/shipments.html',
      icon: `<svg width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12"/>
      </svg>`,
    },
    {
      label: 'Просрочки', value: overdue,
      sub: 'дата прошла, не доставлено',
      delta: '',
      cls: 'red', href: '/shipments.html',
      icon: `<svg width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>`,
    },
  ];

  document.getElementById('kpiGrid').innerHTML = cards.map(c => `
    <a class="kpi-card ${c.cls}" href="${c.href}" style="text-decoration:none">
      <div class="kpi-icon">${c.icon}</div>
      <div class="kpi-label">${c.label}</div>
      <div style="display:flex;align-items:baseline;gap:4px">
        <div class="kpi-value">${c.value}</div>${c.delta}
      </div>
      <div class="kpi-sub">${c.sub}</div>
    </a>
  `).join('');
}

// ─── Бар-чарт: отгрузки по месяцам ───────────────────────────────────────────

function buildBarChart(data) {
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - i, 1);
    months.push({
      key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', ''),
      year:  d.getFullYear(),
      count: 0,
    });
  }

  // Всегда показываем все данные на графике (12 мес.) независимо от фильтра
  allData.forEach(s => {
    const d = parseDate(s.shipped_at);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const m   = months.find(m => m.key === key);
    if (m) m.count++;
  });

  const maxVal = Math.max(...months.map(m => m.count), 1);
  const W = 560, H = 180, pad = { top: 16, right: 10, bottom: 32, left: 28 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top  - pad.bottom;
  const barW   = Math.floor(chartW / months.length * 0.58);
  const gap    = chartW / months.length;

  const steps = 4;
  let gridLines = '', yLabels = '';
  for (let i = 0; i <= steps; i++) {
    const y   = pad.top + chartH - (chartH * i / steps);
    const val = Math.round(maxVal * i / steps);
    gridLines += `<line x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,3"/>`;
    yLabels   += `<text x="${pad.left - 4}" y="${y + 4}" text-anchor="end" font-size="9" fill="var(--text-3)">${val}</text>`;
  }

  let bars = '', xLabels = '';
  months.forEach((m, i) => {
    const x    = pad.left + gap * i + gap / 2 - barW / 2;
    const bH   = m.count ? Math.max(3, Math.round(chartH * m.count / maxVal)) : 0;
    const y    = pad.top + chartH - bH;
    const isNow = m.key === months[months.length - 1].key;
    const fill  = isNow ? 'var(--primary)' : 'var(--primary-bdr)';

    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${bH}" rx="3" fill="${fill}" opacity="${isNow ? 1 : 0.65}">
      <title>${m.label} ${m.year}: ${m.count}</title></rect>`;
    if (m.count > 0) {
      bars += `<text x="${x + barW / 2}" y="${y - 3}" text-anchor="middle" font-size="9" fill="var(--text-2)" font-weight="600">${m.count}</text>`;
    }
    const showYear = i === 0 || m.key.endsWith('-01');
    xLabels += `<text x="${pad.left + gap * i + gap / 2}" y="${H - 2}" text-anchor="middle" font-size="9" fill="var(--text-3)">${m.label}${showYear ? ' ' + m.year : ''}</text>`;
  });

  document.getElementById('barChartWrap').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" class="bar-chart-svg">${gridLines}${yLabels}${bars}${xLabels}</svg>`;
}

// ─── Пончик: статусы ──────────────────────────────────────────────────────────

function buildDonut(data) {
  const groups = {};
  data.forEach(s => {
    const g = statusGroup(s.status);
    groups[g] = (groups[g] || 0) + 1;
  });

  const palette = {
    'Доставлено':  '#10b981',
    'В пути':      '#f59e0b',
    'Отправлено':  '#3b82f6',
    'Без статуса': '#9ca3af',
    'Другой':      '#8b5cf6',
  };

  const total   = data.length || 1;
  const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const R = 54, CX = 70, CY = 70, stroke = 20;
  const circ = 2 * Math.PI * R;

  let offset = 0, arcs = '';
  entries.forEach(([label, cnt]) => {
    const dash  = (cnt / total) * circ;
    const color = palette[label] || '#6b7280';
    arcs += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-dasharray="${dash.toFixed(2)} ${(circ - dash).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${CX} ${CY})"><title>${label}: ${cnt}</title></circle>`;
    offset += dash;
  });

  const legend = entries.map(([label, cnt]) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${palette[label] || '#6b7280'}"></span>
      <span>${label}</span>
      <span class="legend-count">${cnt}</span>
    </div>`).join('');

  document.getElementById('donutWrap').innerHTML = `
    <svg viewBox="0 0 140 140" class="donut-svg">
      <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>
      ${arcs}
      <text x="${CX}" y="${CY - 6}" text-anchor="middle" font-size="11" fill="var(--text-3)">Итого</text>
      <text x="${CX}" y="${CY + 12}" text-anchor="middle" font-size="18" font-weight="800" fill="var(--text)">${data.length}</text>
    </svg>
    <div class="donut-legend">${legend}</div>`;
}

// ─── Просрочки (по всем данным, не фильтруем по периоду) ──────────────────────

function buildOverdue(data) {
  const list = data
    .filter(s => {
      const a = effectiveArrival(s);
      return a && !isDelivered(s.status) && daysDiff(a.date) > 0;
    })
    .map(s => {
      const a = effectiveArrival(s);
      return { ...s, _arrDate: a.date, _estimated: a.estimated };
    })
    .sort((a, b) => daysDiff(b._arrDate) - daysDiff(a._arrDate))
    .slice(0, 25);

  document.getElementById('overdueCount').textContent = list.length;

  if (!list.length) {
    document.getElementById('overdueList').innerHTML =
      '<div class="list-empty">Просроченных грузов нет</div>';
    return;
  }

  const rows = list.map(s => {
    const days = daysDiff(s._arrDate);
    const est  = s._estimated
      ? '<span style="font-size:10px;color:#9ca3af" title="Дата рассчитана: отправка + 30 дней">~</span>'
      : '';
    return `<tr onclick="location.href='/shipment-detail.html?id=${encodeURIComponent(s.shipment_id)}'">
      <td><div class="cargo-id">${esc(s.shipment_id || '—')}</div></td>
      <td style="color:var(--text-2)">${esc(s.client_id || '—')}</td>
      <td class="arrival-date arrival-late">${est}${formatDate(s._arrDate)}</td>
      <td style="color:#dc2626;font-size:11px;font-weight:700">+${days}д</td>
    </tr>`;
  }).join('');

  document.getElementById('overdueList').innerHTML =
    `<table class="mini-table"><tbody>${rows}</tbody></table>`;
}

// ─── Ближайшие прибытия ───────────────────────────────────────────────────────

function buildUpcoming(data) {
  const in30 = new Date(TODAY);
  in30.setDate(in30.getDate() + 30);

  const list = data
    .filter(s => {
      const a = effectiveArrival(s);
      return a && !isDelivered(s.status) && a.date >= TODAY && a.date <= in30;
    })
    .map(s => {
      const a = effectiveArrival(s);
      return { ...s, _arrDate: a.date, _estimated: a.estimated };
    })
    .sort((a, b) => a._arrDate - b._arrDate)
    .slice(0, 25);

  document.getElementById('upcomingCount').textContent = list.length;

  if (!list.length) {
    document.getElementById('upcomingList').innerHTML =
      '<div class="list-empty">Нет прибытий в ближайшие 30 дней</div>';
    return;
  }

  const rows = list.map(s => {
    const days  = -daysDiff(s._arrDate);
    const cls   = days <= 3 ? 'arrival-soon' : 'arrival-ok';
    const label = days === 0 ? 'сегодня' : days === 1 ? 'завтра' : `через ${days}д`;
    const est   = s._estimated
      ? '<span style="font-size:10px;color:#9ca3af" title="Дата рассчитана: отправка + 30 дней">~</span>'
      : '';
    return `<tr onclick="location.href='/shipment-detail.html?id=${encodeURIComponent(s.shipment_id)}'">
      <td><div class="cargo-id">${esc(s.shipment_id || '—')}</div></td>
      <td style="color:var(--text-2)">${esc(s.client_id || '—')}</td>
      <td class="arrival-date ${cls}">${est}${formatDate(s._arrDate)}</td>
      <td style="font-size:11px;font-weight:700" class="${cls}">${label}</td>
    </tr>`;
  }).join('');

  document.getElementById('upcomingList').innerHTML =
    `<table class="mini-table"><tbody>${rows}</tbody></table>`;
}

// ─── Финансы ─────────────────────────────────────────────────────────────────

function buildFinance(curr, prev) {
  const sumOf = arr => arr.filter(s => pf(s.total) > 0).reduce((a, s) => a + pf(s.total), 0);
  const countWith = arr => arr.filter(s => pf(s.total) > 0).length;

  const sumAll     = sumOf(curr);
  const avgVal     = countWith(curr) ? sumAll / countWith(curr) : 0;
  const inTransit  = curr.filter(s => !isDelivered(s.status));
  const sumTransit = sumOf(inTransit);
  const delivered  = curr.filter(s => isDelivered(s.status));
  const sumDeliv   = sumOf(delivered);

  const prevTransit = prev ? sumOf(prev.filter(s => !isDelivered(s.status))) : null;
  const prevDeliv   = prev ? sumOf(prev.filter(s => isDelivered(s.status)))  : null;

  const fmt = v => v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + Math.round(v);

  function deltaHtml(curr, prevVal) {
    if (prevVal === null || prevVal === undefined) return '';
    const pct = pctDelta(curr, prevVal);
    if (pct === null) return '';
    const col = pct >= 0 ? '#10b981' : '#ef4444';
    return `<span style="font-size:11px;font-weight:700;color:${col};margin-top:4px;display:block">${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct)}% к пред. периоду</span>`;
  }

  const cards = [
    { label: 'В пути (стоимость)',    value: fmt(sumTransit), sub: `${inTransit.length} грузов с суммой`, delta: deltaHtml(sumTransit, prevTransit) },
    { label: 'Доставлено (стоимость)',value: fmt(sumDeliv),   sub: `${delivered.length} грузов`,          delta: deltaHtml(sumDeliv, prevDeliv) },
    { label: 'Средняя стоимость',     value: fmt(avgVal),     sub: `по ${countWith(curr)} грузам`,        delta: '' },
  ];

  document.getElementById('financeRow').innerHTML = cards.map(c => `
    <div class="fin-card">
      <div class="fin-label">${c.label}</div>
      <div class="fin-value">${c.value}</div>
      <div class="fin-sub">${c.sub}</div>
      ${c.delta}
    </div>`).join('');
}

// ─── Топ клиентов ─────────────────────────────────────────────────────────────

function buildTopClients(data) {
  const map = {};
  data.forEach(s => {
    const id = s.client_id || '—';
    if (!map[id]) map[id] = { count: 0, sum: 0 };
    map[id].count++;
    if (pf(s.total) > 0) map[id].sum += pf(s.total);
  });

  const sorted = Object.entries(map)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  if (!sorted.length) {
    document.getElementById('topClientsList').innerHTML =
      '<div class="list-empty">Нет данных</div>';
    return;
  }

  const maxCount = sorted[0].count;
  const fmt = v => v >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : v ? '$' + Math.round(v) : '—';

  document.getElementById('topClientsList').innerHTML = sorted.map(c => `
    <div class="top-client-row">
      <div class="top-client-info">
        <span class="top-client-id">${esc(c.id)}</span>
        <span class="top-client-sum">${fmt(c.sum)}</span>
      </div>
      <div class="top-client-bar-wrap">
        <div class="top-client-bar" style="width:${Math.round(c.count / maxCount * 100)}%"></div>
      </div>
      <span class="top-client-count">${c.count} гр.</span>
    </div>`).join('');
}

// ─── Пересборка при смене периода ─────────────────────────────────────────────

function rebuild() {
  const curr = filterByPeriod(allData, activePeriod);
  const prev = filterPrevPeriod(allData, activePeriod);

  buildKPI(curr, prev);
  buildDonut(curr);
  buildFinance(curr, prev);
  buildTopClients(curr);

  // Просрочки и прибытия — всегда по всем данным
  buildOverdue(allData);
  buildUpcoming(allData);
}

// ─── Инициализация ────────────────────────────────────────────────────────────

async function init() {
  allData = await loadData();

  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('dashContent').classList.remove('hidden');

  buildPeriodFilter();
  buildBarChart(allData);
  rebuild();
}

document.addEventListener('refreshPage', () => {
  document.getElementById('loadingState').classList.remove('hidden');
  document.getElementById('dashContent').classList.add('hidden');
  init();
});

checkAuth(['admin', 'employee']).then(user => { if (user) init(); });
