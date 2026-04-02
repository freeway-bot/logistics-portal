// shipments.js — shipments list page

let currentFilter = '';
let currentPage   = 1;
const PAGE_LIMIT  = 50;

// ─── Load ─────────────────────────────────────────────────────────────────────

async function loadShipments() {
  showState('loading');
  try {
    const params = new URLSearchParams({ limit: PAGE_LIMIT, page: currentPage });
    if (currentFilter) params.set('status', currentFilter);

    const res  = await fetch(`/api/admin/shipments?${params}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка загрузки');

    if (body.total === 0) { showState('empty'); return; }

    document.getElementById('totalLabel').textContent = `${body.total} отправок`;
    renderRows(body.data);
    renderPager(body.page, body.pages);
    showState('content');
  } catch (err) {
    toast(err.message, 'error');
    showState('empty');
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function shipStatusClass(s) {
  if (!s) return 's-other';
  const v = s.toLowerCase();
  if (v === 'отправлено' || v === 'shipped')  return 's-shipped';
  if (v === 'в пути'     || v === 'transit')  return 's-transit';
  if (v === 'доставлено' || v === 'delivered')return 's-delivered';
  return 's-other';
}

function renderRows(data) {
  document.getElementById('shipmentsBody').innerHTML = data.map(s => {
    const dt      = new Date(s.shipped_at || s.created_at);
    const dateStr = isNaN(dt) ? (s.shipped_at || '—') : dt.toLocaleDateString('ru-RU');
    return `<tr class="ship-row" onclick="location.href='/shipment-detail.html?id=${encodeURIComponent(s.shipment_id)}'">
      <td style="font-family:'Courier New',monospace;font-weight:700;font-size:12px;color:var(--primary-h)">${esc(s.shipment_id)}</td>
      <td style="font-weight:600">${esc(s.shipment_code || '—')}</td>
      <td style="white-space:nowrap;color:var(--text-3);font-size:12px">${esc(dateStr)}</td>
      <td style="text-align:center;font-weight:700;color:var(--text)">${esc(s.total_places || '—')}</td>
      <td style="color:var(--text-2)">${esc(s.total_weight || '—')}</td>
      <td style="color:var(--text-2)">${esc(s.total_volume || '—')}</td>
      <td style="color:var(--text-2)">${esc(s.operator || '—')}</td>
      <td><span class="ship-status ${shipStatusClass(s.status)}">${esc(s.status || '—')}</span></td>
    </tr>`;
  }).join('');
}

function renderPager(page, pages) {
  const wrap = document.getElementById('pagerWrap');
  if (pages <= 1) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  document.getElementById('pageLabel').textContent = `Страница ${page} / ${pages}`;
  document.getElementById('prevBtn').disabled = page <= 1;
  document.getElementById('nextBtn').disabled = page >= pages;
}

// ─── State ────────────────────────────────────────────────────────────────────

function showState(s) {
  document.getElementById('loadingState').classList.toggle('hidden', s !== 'loading');
  document.getElementById('emptyState').classList.toggle('hidden',   s !== 'empty');
  document.getElementById('content').classList.toggle('hidden',      s !== 'content');
}

// ─── Events ───────────────────────────────────────────────────────────────────

document.getElementById('refreshBtn').addEventListener('click', () => { currentPage = 1; loadShipments(); });

document.getElementById('filterPills').addEventListener('click', e => {
  const pill = e.target.closest('.status-pill');
  if (!pill) return;
  document.querySelectorAll('.status-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  currentFilter = pill.dataset.status;
  currentPage   = 1;
  loadShipments();
});

document.getElementById('prevBtn').addEventListener('click', () => { currentPage--; loadShipments(); });
document.getElementById('nextBtn').addEventListener('click', () => { currentPage++; loadShipments(); });

// ─── Init ─────────────────────────────────────────────────────────────────────
loadShipments();
