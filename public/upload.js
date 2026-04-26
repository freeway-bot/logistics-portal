// upload.js — создание отгрузки: список треков + номер груза.
// Бэкенд привязывает каждый трек в Scans и добавляет новую строку в лист «Логистика».

const trackInput   = document.getElementById('trackInput');
const fileInput    = document.getElementById('fileInput');
const trackCount   = document.getElementById('trackCount');
const cargoNumber  = document.getElementById('cargoNumber');
const clientId     = document.getElementById('clientId');
const submitBtn    = document.getElementById('submitBtn');

checkAuth(['admin', 'employee']);

// ─── Счётчик треков ───────────────────────────────────────────────────────────

function parseTracks(text) {
  return text.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
}

function updateCount() {
  trackCount.textContent = `${parseTracks(trackInput.value).length} треков`;
}

trackInput.addEventListener('input', updateCount);

// ─── Импорт TXT / CSV ─────────────────────────────────────────────────────────

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

// ─── Submit ───────────────────────────────────────────────────────────────────

submitBtn.addEventListener('click', async () => {
  const tracks = parseTracks(trackInput.value);
  if (tracks.length === 0) { toast('Введите трек-номера', 'error'); return; }

  const cargo  = cargoNumber.value.trim();
  const client = clientId.value.trim();

  submitBtn.disabled    = true;
  submitBtn.textContent = 'Создаём отгрузку…';
  document.getElementById('resultPlaceholder').classList.add('hidden');
  document.getElementById('resultLoading').classList.remove('hidden');
  document.getElementById('resultBox').classList.add('hidden');

  try {
    const res = await fetch('/api/admin/shipments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tracks, cargo_number: cargo, client_id: client }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');

    renderResult(data);
  } catch (err) {
    toast(err.message, 'error');
    document.getElementById('resultLoading').classList.add('hidden');
    document.getElementById('resultPlaceholder').classList.remove('hidden');
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Создать отгрузку';
  }
});

// ─── Результат ────────────────────────────────────────────────────────────────

function renderResult(data) {
  document.getElementById('resultLoading').classList.add('hidden');

  const box     = document.getElementById('resultBox');
  const title   = document.getElementById('resultTitle');
  const stats   = document.getElementById('resultStats');
  const details = document.getElementById('resultDetails');

  title.textContent = `Отгрузка ${data.cargo_number} — ${data.updated} треков`;

  stats.innerHTML = [
    { label: 'Номер груза',          value: data.cargo_number,         cls: 'neu', big: false },
    { label: 'Привязано треков',     value: data.updated,              cls: data.updated > 0 ? 'ok' : 'warn' },
    { label: 'Не найдено',           value: data.notFound.length,      cls: data.notFound.length > 0 ? 'err' : 'ok' },
    { label: 'Дублей в списке',      value: data.duplicates.length,    cls: data.duplicates.length > 0 ? 'warn' : 'ok' },
    { label: 'Уже отправлены',       value: data.alreadyShipped.length,cls: 'neu' },
  ].map(s => `
    <div class="result-stat ${s.cls}">
      <div class="result-stat-label">${esc(s.label)}</div>
      <div class="result-stat-value" style="font-size:${s.label === 'Номер груза' ? '14px' : '22px'};word-break:break-all">${esc(String(s.value))}</div>
    </div>`).join('');

  let html = '';

  if (data.updated > 0) {
    html += `<div style="margin-bottom:10px">
      <a href="/shipment-detail.html?id=${encodeURIComponent(data.cargo_number)}"
         style="display:inline-flex;align-items:center;gap:6px;color:var(--primary);font-size:13px;font-weight:600;text-decoration:none">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Открыть отгрузку →
      </a>
    </div>`;
  }

  if (data.notFound.length > 0) {
    html += `<div class="result-list-title">Не найдено в таблице (${data.notFound.length})</div>
             <div class="result-list">${data.notFound.map(t => esc(t)).join('<br>')}</div>`;
  }
  if (data.duplicates.length > 0) {
    html += `<div class="result-list-title">Дубли в списке (${data.duplicates.length})</div>
             <div class="result-list">${data.duplicates.map(t => esc(t)).join('<br>')}</div>`;
  }
  if (data.alreadyShipped.length > 0) {
    html += `<div class="result-list-title">Уже были отправлены ранее (${data.alreadyShipped.length})</div>
             <div class="result-list">${data.alreadyShipped.map(t => esc(t)).join('<br>')}</div>`;
  }

  if (!html) {
    html = `<div style="color:var(--green);font-size:13px;font-weight:600;margin-top:8px">✓ Все треки привязаны к грузу</div>`;
  }

  details.innerHTML = html;
  box.classList.remove('hidden');

  if (data.updated > 0) toast(`Груз ${data.cargo_number} создан — привязано ${data.updated} треков`);
}
