// admin.js — internal dashboard

let statsData = null;
let dailyData = null;

// ─── Load ─────────────────────────────────────────────────────────────────────

async function loadAll() {
  showState('loading');
  try {
    const [stats, recent, daily] = await Promise.all([
      fetch('/api/admin/stats').then(r => r.json()),
      fetch('/api/admin/recent?limit=8').then(r => r.json()),
      fetch('/api/admin/daily?days=14').then(r => r.json()),
    ]);

    if (stats.error) throw new Error(stats.error);

    statsData = stats;
    dailyData = daily;

    renderMetrics(stats);
    renderChart(daily.days);
    renderProblems(stats.problems);
    renderRecentTables(recent);
    renderTopClients(stats.topClients);

    showState('content');
  } catch (err) {
    document.getElementById('errorMsg').textContent = err.message;
    showState('error');
  }
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function renderMetrics(s) {
  const metrics = [
    { label: 'Всего в системе',     value: s.total,          color: 'c-gray',   sub: 'записей' },
    { label: 'На складе',           value: s.warehouse,      color: 'c-blue',   sub: 'посылок' },
    { label: 'Упаковано',           value: s.packed,         color: 'c-amber',  sub: 'посылок' },
    { label: 'Отправлено (всего)',  value: s.shipped,        color: 'c-green',  sub: 'посылок' },
    { label: 'Добавлено сегодня',   value: s.addedToday,     color: 'c-purple', sub: 'новых' },
    { label: 'Добавлено вчера',     value: s.addedYesterday, color: 'c-gray',   sub: 'вчера' },
    { label: 'Отправлено сегодня',  value: s.shippedToday,   color: 'c-green',  sub: 'сегодня' },
    { label: 'Отправлено за 7 дней',value: s.shippedWeek,    color: 'c-green',  sub: 'за неделю' },
    { label: 'Клиентов на складе',  value: s.uniqueClients,  color: 'c-blue',   sub: 'уникальных' },
  ];

  document.getElementById('metricsGrid').innerHTML = metrics.map(m => `
    <div class="metric-card ${m.color}">
      <div class="metric-label">${m.label}</div>
      <div class="metric-value">${m.value}</div>
      <div class="metric-sub">${m.sub}</div>
    </div>`).join('');
}

// ─── Chart (pure canvas, no library) ─────────────────────────────────────────

function renderChart(days) {
  const canvas = document.getElementById('dailyChart');
  if (!canvas) return;
  const wrap = canvas.parentElement;
  canvas.width  = wrap.clientWidth  || 500;
  canvas.height = wrap.clientHeight || 180;

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const PAD = { top: 16, right: 12, bottom: 28, left: 36 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top  - PAD.bottom;

  const maxVal = Math.max(...days.map(d => Math.max(d.added, d.shipped)), 1);

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD.top + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + chartW, y); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.font = '10px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal * (1 - i/4)), PAD.left - 4, y + 3);
  }

  const barW = Math.floor(chartW / days.length);
  const bW   = Math.max(Math.floor(barW * 0.3), 3);
  const gap  = 2;

  days.forEach((d, i) => {
    const x = PAD.left + i * barW;

    // Added bar (blue)
    const hAdded = d.added   ? (d.added   / maxVal) * chartH : 0;
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.roundRect(x + barW/2 - bW - gap, PAD.top + chartH - hAdded, bW, hAdded, [2,2,0,0]);
    ctx.fill();

    // Shipped bar (green)
    const hShip = d.shipped ? (d.shipped / maxVal) * chartH : 0;
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.roundRect(x + barW/2 + gap, PAD.top + chartH - hShip, bW, hShip, [2,2,0,0]);
    ctx.fill();

    // Date label (every 3rd day)
    if (i % 3 === 0) {
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px system-ui'; ctx.textAlign = 'center';
      const parts = d.date.split('-');
      ctx.fillText(`${parts[2]}.${parts[1]}`, x + barW/2, H - 6);
    }
  });
}

// ─── Problems ─────────────────────────────────────────────────────────────────

function renderProblems(p) {
  const items = [
    { label: 'Без статуса',       count: p.noStatus,   warn: p.noStatus > 0 },
    { label: 'Без client ID',     count: p.noClientId, warn: p.noClientId > 0 },
    { label: 'Без трек-номера',   count: p.noTrack,    warn: p.noTrack > 0 },
    { label: 'Дублей трек-номеров', count: p.duplicates, warn: p.duplicates > 0 },
  ];

  document.getElementById('problemsList').innerHTML = items.map(item => `
    <div class="problem-item ${item.warn ? 'warn' : 'ok'}">
      <span>${item.label}</span>
      <span class="problem-badge">${item.count}</span>
    </div>`).join('');
}

// ─── Recent tables ────────────────────────────────────────────────────────────

function renderRecentTables({ recent, recentShipped }) {
  document.getElementById('recentTable').innerHTML   = buildMiniTable(recent,         false);
  document.getElementById('shippedTable').innerHTML  = buildMiniTable(recentShipped,  false);
}

function buildMiniTable(items, showClient) {
  if (!items || items.length === 0) return '<tr><td colspan="4" style="color:var(--text-3);text-align:center;padding:20px">Нет данных</td></tr>';
  return items.map(item => `
    <tr>
      <td title="${esc(item.track_number||'')}">${esc((item.track_number||'—').slice(0,18))}</td>
      <td class="td-client">${esc(item.client_id||'—')}</td>
      <td><span class="badge ${statusClass(item.status)}" style="font-size:11px;padding:2px 7px">${esc(statusLabel(item.status))}</span></td>
      <td class="td-date">${esc(fmtDate(item.date))}</td>
    </tr>`).join('');
}

// ─── Top clients ──────────────────────────────────────────────────────────────

function renderTopClients(clients) {
  if (!clients || clients.length === 0) {
    document.getElementById('topClientsList').innerHTML = '<p style="color:var(--text-3);font-size:13px">Нет данных</p>';
    return;
  }
  const max = clients[0].count;
  document.getElementById('topClientsList').innerHTML = clients.map(c => `
    <div class="client-bar-wrap">
      <div class="client-bar-label">
        <span class="client-bar-name">${esc(c.id)}</span>
        <span class="client-bar-count">${c.count}</span>
      </div>
      <div class="client-bar">
        <div class="client-bar-fill" style="width:${Math.round((c.count/max)*100)}%"></div>
      </div>
    </div>`).join('');
}

// ─── State ────────────────────────────────────────────────────────────────────

function showState(s) {
  document.getElementById('loadingState').classList.toggle('hidden', s !== 'loading');
  document.getElementById('errorState').classList.toggle('hidden',   s !== 'error');
  document.getElementById('content').classList.toggle('hidden',      s !== 'content');
}

// ─── Events ───────────────────────────────────────────────────────────────────

document.getElementById('refreshBtn').addEventListener('click', loadAll);

window.addEventListener('resize', () => {
  if (dailyData) renderChart(dailyData.days);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
loadAll();
