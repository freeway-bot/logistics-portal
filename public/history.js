// history.js — operation history page

let historyData = [];

// ─── Load ─────────────────────────────────────────────────────────────────────

async function loadHistory() {
  showState('loading');
  try {
    const res  = await fetch('/api/admin/history?limit=500');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка загрузки');
    historyData = body.data || [];
    if (historyData.length === 0) { showState('empty'); return; }
    document.getElementById('totalLabel').textContent = `${body.total} операций`;
    render();
    showState('content');
  } catch (err) {
    toast(err.message, 'error');
    showState('empty');
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  document.getElementById('historyBody').innerHTML = historyData.map((op, i) => {
    const dt     = new Date(op.ts);
    const dateStr = isNaN(dt) ? op.ts : dt.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const nfCount = Array.isArray(op.notFound)      ? op.notFound.length      : (op.notFound      || 0);
    const dupCnt  = Array.isArray(op.duplicates)    ? op.duplicates.length    : (op.duplicates    || 0);
    const asCnt   = Array.isArray(op.alreadyShipped)? op.alreadyShipped.length: (op.alreadyShipped|| 0);
    const hasDetail = nfCount > 0 || dupCnt > 0 || asCnt > 0 || op.comment;

    return `<tr>
      <td style="white-space:nowrap;color:var(--text-3);font-size:12px">${esc(dateStr)}</td>
      <td style="font-weight:600">${esc(op.operator || '—')}</td>
      <td style="font-family:'Courier New',monospace;font-size:12px;color:var(--primary-h)">${esc(op.send_session || '—')}</td>
      <td style="text-align:center">${op.submitted ?? '—'}</td>
      <td style="text-align:center;font-weight:700;color:${op.updated > 0 ? 'var(--green)' : 'var(--text-3)'}">${op.updated ?? 0}</td>
      <td style="text-align:center;font-weight:700;color:${nfCount > 0 ? 'var(--red)' : 'var(--text-3)'}">${nfCount}</td>
      <td style="text-align:center;font-weight:700;color:${dupCnt > 0 ? 'var(--amber)' : 'var(--text-3)'}">${dupCnt}</td>
      <td style="text-align:center;color:var(--text-3)">${asCnt}</td>
      <td style="text-align:right">
        ${hasDetail
          ? `<button class="btn-ghost" style="font-size:12px;padding:4px 10px" onclick="openDetail(${i})">Детали</button>`
          : ''}
      </td>
    </tr>`;
  }).join('');
}

// ─── Detail modal ─────────────────────────────────────────────────────────────

window.openDetail = function(i) {
  const op = historyData[i];
  if (!op) return;

  const dt     = new Date(op.ts);
  const dateStr = isNaN(dt) ? op.ts : dt.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });

  const nf  = Array.isArray(op.notFound)       ? op.notFound       : [];
  const dup = Array.isArray(op.duplicates)      ? op.duplicates     : [];
  const as  = Array.isArray(op.alreadyShipped)  ? op.alreadyShipped : [];

  document.getElementById('detailTitle').textContent = `Операция — ${dateStr}`;

  let html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">`;
  const stat = (label, value, color) =>
    `<div style="background:var(--surface-2);border:1px solid var(--border-light);border-radius:var(--radius);padding:10px 14px">
       <div style="font-size:11px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">${label}</div>
       <div style="font-size:20px;font-weight:800;color:${color || 'var(--text)'}">${value}</div>
     </div>`;
  html += stat('Подано',     op.submitted ?? '—');
  html += stat('Обновлено',  op.updated   ?? 0, op.updated > 0 ? 'var(--green)' : 'var(--text-3)');
  html += stat('Не найдено', nf.length,  nf.length  > 0 ? 'var(--red)'   : 'var(--text-3)');
  html += stat('Дублей',     dup.length, dup.length > 0 ? 'var(--amber)' : 'var(--text-3)');
  html += `</div>`;

  if (op.operator)     html += detail_row('Оператор',       op.operator);
  if (op.send_session) html += detail_row('Сессия',         op.send_session);
  if (op.status)       html += detail_row('Статус',         op.status);
  if (op.comment)      html += detail_row('Комментарий',    op.comment);

  if (nf.length > 0) {
    html += list_block(`Не найдено в таблице (${nf.length})`, nf, 'var(--red)');
  }
  if (dup.length > 0) {
    html += list_block(`Дубли во вводе (${dup.length})`, dup, 'var(--amber)');
  }
  if (as.length > 0) {
    html += list_block(`Уже были отправлены (${as.length})`, as, 'var(--text-3)');
  }

  document.getElementById('detailBody').innerHTML = html;
  document.getElementById('detailModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

function detail_row(label, value) {
  return `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border-light);font-size:13px">
    <span style="color:var(--text-3)">${esc(label)}</span>
    <span style="font-weight:600;color:var(--text)">${esc(value)}</span>
  </div>`;
}

function list_block(title, items, color) {
  return `<div style="margin-top:14px">
    <div style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">${esc(title)}</div>
    <div style="font-family:'Courier New',monospace;font-size:12px;background:var(--surface-2);border-radius:var(--radius-sm);padding:10px 12px;max-height:160px;overflow-y:auto;line-height:1.8;word-break:break-all;border:1px solid var(--border-light)">
      ${items.map(t => esc(t)).join('<br>')}
    </div>
  </div>`;
}

function closeDetail() {
  document.getElementById('detailModal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ─── State ────────────────────────────────────────────────────────────────────

function showState(s) {
  document.getElementById('loadingState').classList.toggle('hidden', s !== 'loading');
  document.getElementById('emptyState').classList.toggle('hidden',   s !== 'empty');
  document.getElementById('content').classList.toggle('hidden',      s !== 'content');
}

// ─── Events ───────────────────────────────────────────────────────────────────

document.getElementById('refreshBtn').addEventListener('click', loadHistory);
document.getElementById('detailClose').addEventListener('click', closeDetail);
document.getElementById('detailModal').addEventListener('click', e => {
  if (e.target === document.getElementById('detailModal')) closeDetail();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

// ─── Init ─────────────────────────────────────────────────────────────────────
checkAuth(['admin', 'employee']).then(user => { if (user) loadHistory(); });
