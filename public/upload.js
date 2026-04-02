// upload.js — create shipment from track list

const trackInput    = document.getElementById('trackInput');
const fileInput     = document.getElementById('fileInput');
const trackCount    = document.getElementById('trackCount');
const shipDate      = document.getElementById('shipDate');
const shipmentCode  = document.getElementById('shipmentCode');
const totalWeight   = document.getElementById('totalWeight');
const totalVolume   = document.getElementById('totalVolume');
const commentField  = document.getElementById('commentField');
const operatorField = document.getElementById('operatorField');
const submitBtn     = document.getElementById('submitBtn');

// Set today as default date
shipDate.value = new Date().toISOString().slice(0, 10);

// ─── Track count display ──────────────────────────────────────────────────────

function updateCount() {
  const tracks = parseTracks(trackInput.value);
  trackCount.textContent = `${tracks.length} треков`;
}

trackInput.addEventListener('input', updateCount);

// ─── File upload ──────────────────────────────────────────────────────────────

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text  = e.target.result;
    const lines = text.split(/\r?\n/).map(line => line.split(',')[0].split('\t')[0].trim()).filter(Boolean);
    trackInput.value = lines.join('\n');
    updateCount();
    toast(`Загружено ${lines.length} строк из файла`);
  };
  reader.readAsText(file);
  fileInput.value = '';
});

// ─── Parse tracks ─────────────────────────────────────────────────────────────

function parseTracks(text) {
  return text.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
}

// ─── Submit ───────────────────────────────────────────────────────────────────

submitBtn.addEventListener('click', async () => {
  const tracks = parseTracks(trackInput.value);
  if (tracks.length === 0) { toast('Введите трек-номера', 'error'); return; }

  const code = shipmentCode.value.trim();
  if (!code) { toast('Укажите код отправки', 'error'); shipmentCode.focus(); return; }

  submitBtn.disabled  = true;
  submitBtn.textContent = 'Создаём отправку…';
  document.getElementById('resultPlaceholder').classList.add('hidden');
  document.getElementById('resultLoading').classList.remove('hidden');
  document.getElementById('resultBox').classList.add('hidden');

  try {
    const body = {
      tracks,
      shipment_code: code,
      shipped_at:    shipDate.value || '',
      total_weight:  totalWeight.value.trim(),
      total_volume:  totalVolume.value.trim(),
      comment:       commentField.value.trim(),
      operator:      operatorField.value.trim(),
    };

    const res  = await fetch('/api/admin/shipments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    renderResult(data, tracks.length);
  } catch (err) {
    toast(err.message, 'error');
    document.getElementById('resultLoading').classList.add('hidden');
    document.getElementById('resultPlaceholder').classList.remove('hidden');
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Создать отправку';
  }
});

// ─── Render result ────────────────────────────────────────────────────────────

function renderResult(data, inputCount) {
  document.getElementById('resultLoading').classList.add('hidden');

  const box     = document.getElementById('resultBox');
  const title   = document.getElementById('resultTitle');
  const stats   = document.getElementById('resultStats');
  const details = document.getElementById('resultDetails');

  title.textContent = `Отправка создана — ${data.updated} треков`;

  stats.innerHTML = [
    { label: 'ID отправки',           value: data.shipment_id,          cls: 'neu' },
    { label: 'Обновлено',             value: data.updated,              cls: data.updated > 0 ? 'ok' : 'warn' },
    { label: 'Не найдено',            value: data.notFound.length,      cls: data.notFound.length > 0 ? 'err' : 'ok' },
    { label: 'Дублей во вводе',       value: data.duplicates.length,    cls: data.duplicates.length > 0 ? 'warn' : 'ok' },
    { label: 'Уже отправлено ранее',  value: data.alreadyShipped.length,cls: 'neu' },
  ].map(s => `
    <div class="result-stat ${s.cls}">
      <div class="result-stat-label">${s.label}</div>
      <div class="result-stat-value" style="font-size:${s.label === 'ID отправки' ? '13px' : '22px'};word-break:break-all">${esc(String(s.value))}</div>
    </div>`).join('');

  let html = '';

  if (data.updated > 0) {
    html += `<div style="margin-bottom:10px">
      <a href="/shipment-detail.html?id=${encodeURIComponent(data.shipment_id)}"
         style="display:inline-flex;align-items:center;gap:6px;color:var(--primary);font-size:13px;font-weight:600;text-decoration:none">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Открыть детали отправки →
      </a>
    </div>`;
  }

  if (data.notFound.length > 0) {
    html += `<div class="result-list-title">Не найдено в таблице (${data.notFound.length})</div>
             <div class="result-list">${data.notFound.map(t => esc(t)).join('<br>')}</div>`;
  }
  if (data.duplicates.length > 0) {
    html += `<div class="result-list-title">Дубли в вашем списке (${data.duplicates.length})</div>
             <div class="result-list">${data.duplicates.map(t => esc(t)).join('<br>')}</div>`;
  }
  if (data.alreadyShipped.length > 0) {
    html += `<div class="result-list-title">Уже были отправлены (${data.alreadyShipped.length})</div>
             <div class="result-list">${data.alreadyShipped.map(t => esc(t)).join('<br>')}</div>`;
  }

  if (!html) {
    html = `<div style="color:var(--green);font-size:13px;font-weight:600;margin-top:8px">✓ Все треки успешно привязаны к отправке</div>`;
  }

  details.innerHTML = html;
  box.classList.remove('hidden');

  if (data.updated > 0) toast(`Отправка ${data.shipment_id} создана — ${data.updated} треков`);
}
