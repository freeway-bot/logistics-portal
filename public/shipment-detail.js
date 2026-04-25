// shipment-detail.js — shipment detail page

const shipmentId = new URLSearchParams(location.search).get('id');
let shipmentData = null;

// ─── Load ─────────────────────────────────────────────────────────────────────

async function loadDetail() {
  if (!shipmentId) { showState('error'); return; }
  showState('loading');
  try {
    const res  = await fetch(`/api/admin/shipments/${encodeURIComponent(shipmentId)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка');
    shipmentData = body;
    render(body);
    showState('content');
  } catch (err) {
    toast(err.message, 'error');
    showState('error');
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

function render({ shipment, tracks }) {
  document.title = `Отправка ${shipment.shipment_code || shipment.shipment_id}`;

  document.getElementById('detailCode').textContent = shipment.shipment_code || shipment.shipment_id;
  document.getElementById('detailId').textContent   = shipment.shipment_id;

  const badge = document.getElementById('statusBadge');
  badge.textContent = shipment.status || '—';
  badge.className   = `ship-status ${shipStatusClass(shipment.status)}`;

  const sel = document.getElementById('statusSelect');
  sel.value = shipment.status || 'отправлено';

  // Meta cards
  const dt      = new Date(shipment.shipped_at || shipment.created_at);
  const dateStr = isNaN(dt) ? (shipment.shipped_at || '—') : dt.toLocaleDateString('ru-RU');
  const metas = [
    { label: 'Дата',       value: dateStr },
    { label: 'Треков',     value: shipment.total_places || tracks.length || '—' },
    { label: 'Вес, кг',    value: shipment.total_weight || '—' },
    { label: 'Объём, м³',  value: shipment.total_volume || '—' },
    { label: 'Оператор',   value: shipment.operator || '—' },
    { label: 'Комментарий',value: shipment.comment  || '—' },
  ];
  document.getElementById('metaGrid').innerHTML = metas.map(m =>
    `<div class="meta-card">
       <div class="meta-label">${esc(m.label)}</div>
       <div class="meta-value">${esc(String(m.value))}</div>
     </div>`
  ).join('');

  // Tracks table
  document.getElementById('trackCountLabel').textContent = `${tracks.length} треков`;
  document.getElementById('tracksBody').innerHTML = tracks.length === 0
    ? `<tr><td colspan="6" style="text-align:center;color:var(--text-3);padding:20px">Треки не найдены</td></tr>`
    : tracks.map(t => `<tr>
        <td style="font-family:'Courier New',monospace;font-weight:700;font-size:12px">${esc(t.track_number || '—')}</td>
        <td style="font-weight:600;color:var(--primary-h)">${esc(t.client_id || '—')}</td>
        <td><span class="status-badge ${statusClass(t.status)}">${esc(statusLabel(t.status))}</span></td>
        <td>${esc(t.category || '—')}</td>
        <td style="white-space:nowrap;color:var(--text-3);font-size:12px">${esc(fmtDate(t.date))}</td>
        <td style="color:var(--text-3);font-size:12px">${esc(t.comment || '')}</td>
      </tr>`).join('');
}

// ─── Status change ────────────────────────────────────────────────────────────

document.getElementById('statusSelect').addEventListener('change', async function() {
  const newStatus = this.value;
  try {
    const res = await fetch(`/api/admin/shipments/${encodeURIComponent(shipmentId)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status: newStatus }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка');

    const badge = document.getElementById('statusBadge');
    badge.textContent = newStatus;
    badge.className   = `ship-status ${shipStatusClass(newStatus)}`;
    if (shipmentData) shipmentData.shipment.status = newStatus;
    toast(`Статус обновлён: ${newStatus}`);
  } catch (err) {
    toast(err.message, 'error');
    if (shipmentData) this.value = shipmentData.shipment.status || 'отправлено';
  }
});

// ─── Edit modal ───────────────────────────────────────────────────────────────

document.getElementById('editBtn').addEventListener('click', () => {
  if (!shipmentData) return;
  const s = shipmentData.shipment;
  document.getElementById('editWeight').value  = s.total_weight || '';
  document.getElementById('editVolume').value  = s.total_volume || '';
  document.getElementById('editComment').value = s.comment      || '';
  document.getElementById('editModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
});

document.getElementById('editClose').addEventListener('click', closeEdit);
document.getElementById('editModal').addEventListener('click', e => {
  if (e.target === document.getElementById('editModal')) closeEdit();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeEdit(); });

function closeEdit() {
  document.getElementById('editModal').classList.add('hidden');
  document.body.style.overflow = '';
}

document.getElementById('editSaveBtn').addEventListener('click', async () => {
  const weight  = document.getElementById('editWeight').value.trim();
  const volume  = document.getElementById('editVolume').value.trim();
  const comment = document.getElementById('editComment').value.trim();

  const btn = document.getElementById('editSaveBtn');
  btn.disabled    = true;
  btn.textContent = 'Сохраняем…';

  try {
    const res = await fetch(`/api/admin/shipments/${encodeURIComponent(shipmentId)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ total_weight: weight, total_volume: volume, comment }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка');

    if (shipmentData) {
      shipmentData.shipment.total_weight = weight;
      shipmentData.shipment.total_volume = volume;
      shipmentData.shipment.comment      = comment;
      render(shipmentData);
    }
    closeEdit();
    toast('Данные отправки обновлены');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Сохранить';
  }
});

// ─── State ────────────────────────────────────────────────────────────────────

function showState(s) {
  document.getElementById('loadingState').classList.toggle('hidden', s !== 'loading');
  document.getElementById('errorState').classList.toggle('hidden',   s !== 'error');
  document.getElementById('content').classList.toggle('hidden',      s !== 'content');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
checkAuth(['admin', 'employee']).then(user => { if (user) loadDetail(); });
