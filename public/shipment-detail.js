// shipment-detail.js — полное редактирование груза

const shipmentId = new URLSearchParams(location.search).get('id');
let shipmentData = null;
let originalValues = {};
let hasChanges = false;

// ─── Поля формы ───────────────────────────────────────────────────────────────

const FIELDS = [
  'client_id', 'status', 'shipped_at', 'arrival',
  'category', 'route', 'carrier',
  'total_places', 'total_weight', 'total_volume', 'density',
  'cargo_cost', 'price_per_kg', 'insurance_pct', 'insurance_usd',
  'packaging', 'loading', 'total', 'comment',
];

const REQUIRED_LABELS = {
  total:        'Сумма $',
  total_weight: 'Вес',
  total_volume: 'Объём',
  total_places: 'Мест',
  status:       'Статус',
  arrival:      'Дата прибытия',
  client_id:    'Клиент',
};

// ─── Загрузка ─────────────────────────────────────────────────────────────────

async function loadDetail() {
  if (!shipmentId) { showState('error'); return; }
  showState('loading');
  try {
    const res  = await fetch(`/api/admin/shipments/${encodeURIComponent(shipmentId)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Не найдено');
    shipmentData = body;
    render(body);
    showState('content');
  } catch (err) {
    toast(err.message, 'error');
    showState('error');
  }
}

// Числа из Google Sheets могут хранить запятую вместо точки: "150,5" → "150.5"
function normalizeNum(v) {
  if (!v && v !== 0) return '';
  return String(v).replace(/[,%]/g, m => m === ',' ? '.' : '').trim();
}

// ─── Render ───────────────────────────────────────────────────────────────────

const NUM_FIELDS = new Set([
  'total_places','total_weight','total_volume','density',
  'cargo_cost','price_per_kg','insurance_pct','insurance_usd',
  'packaging','loading','total',
]);

function render({ shipment, tracks }) {
  document.title = `Груз ${shipment.shipment_id}`;

  // Top bar
  document.getElementById('barTitle').textContent  = shipment.shipment_id || '—';
  document.getElementById('barClient').textContent = shipment.client_id
    ? `Клиент: ${shipment.client_id}` : '';

  updateStatusPill(shipment.status);
  updateTransitChip(shipment.shipped_at, shipment.arrival);

  // Fill fields
  document.getElementById('f-shipment_id').value = shipment.shipment_id || '';

  FIELDS.forEach(field => {
    const el = document.getElementById(`f-${field}`);
    if (!el) return;
    // Числовые поля: нормализуем запятую → точка
    el.value = NUM_FIELDS.has(field)
      ? normalizeNum(shipment[field])
      : (shipment[field] || '');
    el.classList.remove('changed');
  });

  // Save originals for change-tracking
  originalValues = {};
  FIELDS.forEach(field => {
    originalValues[field] = (document.getElementById(`f-${field}`)?.value || '');
  });

  markUnsaved(false);
  renderMissingNotice(shipment);
  renderComments(shipment.comment || '');
  renderTracks(tracks);
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function parseDetailDate(s) {
  if (!s) return null;
  const m = s.toString().trim().match(/^(\d{1,2})[.,/](\d{1,2})[.,/](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function updateTransitChip(shipped, arrival) {
  const chip = document.getElementById('transitChip');
  const s = parseDetailDate(shipped);
  if (!s) { chip.style.display = 'none'; return; }
  const arrived = parseDetailDate(arrival);
  const end = arrived || new Date();
  const days = Math.round((end - s) / 86400000);
  if (days < 0) { chip.style.display = 'none'; return; }
  chip.style.display = 'inline-block';
  if (arrived) {
    chip.textContent = `Доставлено за ${days} дн.`;
    chip.className = 'transit-chip chip-delivered';
  } else {
    chip.textContent = `${days} дн. в пути`;
    chip.className = 'transit-chip chip-transit';
  }
}

function statusPillClass(s) {
  const v = (s || '').toLowerCase();
  if (v.includes('доставл') || v.includes('delivered')) return 's-delivered';
  if (v.includes('пути')    || v.includes('transit'))   return 's-transit';
  if (v.includes('отправл') || v.includes('shipped'))   return 's-shipped';
  return 's-other';
}

function updateStatusPill(s) {
  const pill = document.getElementById('statusPill');
  pill.textContent = s || 'Без статуса';
  pill.className   = `status-pill ${statusPillClass(s)}`;
}


// ─── Напоминание о незаполненных полях ────────────────────────────────────────

function renderMissingNotice(s) {
  const missing = Object.entries(REQUIRED_LABELS).filter(([field]) => {
    const val = s[field];
    return !val || (typeof val === 'string' && !val.trim()) || parseFloat(val) === 0;
  });

  const notice = document.getElementById('missingNotice');
  if (!missing.length) { notice.classList.add('hidden'); return; }

  document.getElementById('missingTags').innerHTML =
    missing.map(([, label]) => `<span class="missing-tag">${label}</span>`).join('');
  notice.classList.remove('hidden');
}

// ─── Комментарии ──────────────────────────────────────────────────────────────

function parseComments(raw) {
  if (!raw || !raw.trim()) return [];
  const s = raw.trim();
  if (s.startsWith('[')) {
    try { return JSON.parse(s); } catch {}
  }
  // Старый формат — просто текст, оборачиваем
  return [{ ts: null, text: s }];
}

function formatCommentDate(ts) {
  if (!ts) return 'ранее';
  const d = new Date(ts);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function renderComments(raw) {
  const comments = parseComments(raw);
  document.getElementById('commentsCountBadge').textContent = comments.length;

  if (!comments.length) {
    document.getElementById('commentsFeed').innerHTML =
      `<div style="padding:20px;text-align:center;font-size:12px;color:var(--text-3)">Комментариев пока нет</div>`;
    return;
  }

  document.getElementById('commentsFeed').innerHTML = [...comments].reverse().map(c => `
    <div style="padding:10px 14px;border-bottom:1px solid var(--border-light)">
      <div style="font-size:10px;color:var(--text-3);margin-bottom:4px;font-weight:600">
        ${formatCommentDate(c.ts)}
      </div>
      <div style="font-size:13px;color:var(--text);line-height:1.5;white-space:pre-wrap">${esc(c.text)}</div>
    </div>`).join('');
}

async function addComment() {
  const textarea = document.getElementById('newCommentText');
  const text     = textarea.value.trim();
  if (!text) return;

  const btn = document.getElementById('addCommentBtn');
  btn.disabled    = true;
  btn.textContent = '…';

  try {
    const existing = shipmentData?.shipment?.comment || '';
    const comments  = parseComments(existing);
    comments.push({ ts: new Date().toISOString(), text });
    const newJson = JSON.stringify(comments);

    const res = await fetch(`/api/admin/shipments/${encodeURIComponent(shipmentId)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ comment: newJson }),
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Ошибка');

    if (shipmentData) shipmentData.shipment.comment = newJson;
    originalValues.comment = newJson;

    // Обновляем поле комментария в форме
    const el = document.getElementById('f-comment');
    if (el) { el.value = newJson; el.classList.remove('changed'); }

    renderComments(newJson);
    textarea.value = '';
    toast('Комментарий добавлен');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Добавить';
  }
}

// ─── Треки ────────────────────────────────────────────────────────────────────

function renderTracks(tracks) {
  document.getElementById('trackCountBadge').textContent = tracks.length;

  if (!tracks.length) {
    document.getElementById('tracksList').innerHTML =
      `<div style="padding:24px;text-align:center;font-size:13px;color:var(--text-3)">Треки не найдены</div>`;
    return;
  }

  document.getElementById('tracksList').innerHTML = tracks.map(t => {
    const sc   = statusClass(t.status);
    const sl   = statusLabel(t.status);
    return `<div class="track-row">
      <div class="track-num">${esc(t.track_number || '—')}</div>
      <span class="track-client">${esc(t.client_id || '')}</span>
      <span class="track-status-badge ${sc}" style="font-size:10px;padding:2px 7px">${esc(sl)}</span>
    </div>`;
  }).join('');
}

// ─── Change tracking ──────────────────────────────────────────────────────────

function markUnsaved(val) {
  hasChanges = val;
  document.getElementById('unsavedDot').classList.toggle('visible', val);
  const btn = document.getElementById('saveBtn');
  btn.classList.toggle('saved', !val);
  if (val) btn.classList.remove('saved');
}

function onFieldChange(el) {
  const field = el.dataset.field;
  if (!field) return;
  const changed = el.value !== (originalValues[field] || '');
  el.classList.toggle('changed', changed);

  // Обновляем статус-пилюлю и чип дней при смене полей
  if (field === 'status') updateStatusPill(el.value);
  if (field === 'shipped_at' || field === 'arrival') {
    const shipped = document.getElementById('f-shipped_at')?.value;
    const arrival = document.getElementById('f-arrival')?.value;
    updateTransitChip(shipped, arrival);
  }

  // Проверяем, есть ли хоть одно изменённое поле
  const anyChanged = FIELDS.some(f => {
    const inp = document.getElementById(`f-${f}`);
    return inp && inp.value !== (originalValues[f] || '');
  });
  markUnsaved(anyChanged);
}

// ─── Прогресс-попап ───────────────────────────────────────────────────────────

function showProgress(pct, label) {
  let pop = document.getElementById('saveProgress');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'saveProgress';
    pop.style.cssText = `
      position:fixed;bottom:24px;right:24px;z-index:9999;
      background:var(--surface);border:1px solid var(--border);
      border-radius:var(--radius-lg);box-shadow:0 8px 30px rgba(0,0,0,.15);
      padding:18px 22px;min-width:280px;
    `;
    pop.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div id="spIcon" style="width:32px;height:32px;border-radius:50%;background:var(--primary-bg);
          display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <div class="spinner" style="width:16px;height:16px;border-width:2px"></div>
        </div>
        <div>
          <div style="font-size:13px;font-weight:700;color:var(--text)" id="spTitle">Сохраняем…</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px" id="spLabel"></div>
        </div>
      </div>
      <div style="background:var(--border-light);border-radius:4px;height:6px;overflow:hidden">
        <div id="spBar" style="height:100%;border-radius:4px;background:var(--primary);width:0%;transition:width .3s ease"></div>
      </div>
      <div style="margin-top:6px;font-size:11px;font-weight:700;color:var(--primary);text-align:right" id="spPct">0%</div>
    `;
    document.body.appendChild(pop);
  }
  document.getElementById('spBar').style.width  = pct + '%';
  document.getElementById('spPct').textContent  = pct + '%';
  document.getElementById('spLabel').textContent = label;
}

function hideProgress(success) {
  const pop = document.getElementById('saveProgress');
  if (!pop) return;

  if (success) {
    document.getElementById('spTitle').textContent = '✓ Сохранено в Google Sheets';
    document.getElementById('spLabel').textContent = '';
    document.getElementById('spBar').style.background = '#10b981';
    document.getElementById('spIcon').innerHTML =
      `<svg width="16" height="16" fill="none" stroke="#10b981" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`;
    document.getElementById('spIcon').style.background = '#f0fdf4';
    setTimeout(() => pop.remove(), 2500);
  } else {
    pop.remove();
  }
}

// ─── Сохранение ───────────────────────────────────────────────────────────────

async function saveAll() {
  const btn = document.getElementById('saveBtn');

  // Собираем только изменённые поля
  const patch = {};
  FIELDS.forEach(field => {
    const el = document.getElementById(`f-${field}`);
    if (!el) return;
    const val = el.value;
    if (val !== (originalValues[field] || '')) patch[field] = val;
  });

  if (!Object.keys(patch).length) {
    toast('Нет изменений для сохранения');
    return;
  }

  btn.disabled = true;

  try {
    showProgress(10, 'Подключение к Google Sheets…');
    await new Promise(r => setTimeout(r, 300));

    showProgress(35, `Отправляем ${Object.keys(patch).length} поле(й)…`);
    await new Promise(r => setTimeout(r, 200));

    showProgress(60, 'Записываем данные в таблицу…');

    const res = await fetch(`/api/admin/shipments/${encodeURIComponent(shipmentId)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patch),
    });

    showProgress(85, 'Обновляем кэш…');
    await new Promise(r => setTimeout(r, 200));

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка сохранения');

    showProgress(100, 'Готово!');

    // Обновляем оригиналы
    FIELDS.forEach(field => {
      const el = document.getElementById(`f-${field}`);
      if (el) {
        originalValues[field] = el.value;
        el.classList.remove('changed');
      }
    });

    if (shipmentData) Object.assign(shipmentData.shipment, patch);
    if (shipmentData) renderMissingNotice(shipmentData.shipment);

    markUnsaved(false);
    hideProgress(true);

    btn.classList.add('saved');
    btn.innerHTML = `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Сохранено`;
    setTimeout(() => {
      btn.innerHTML = `<svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Сохранить`;
      btn.classList.remove('saved');
    }, 3000);

  } catch (err) {
    hideProgress(false);
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ─── State ────────────────────────────────────────────────────────────────────

function showState(s) {
  document.getElementById('loadingState').classList.toggle('hidden', s !== 'loading');
  document.getElementById('errorState').classList.toggle('hidden',   s !== 'error');
  document.getElementById('content').classList.toggle('hidden',      s !== 'content');
}

// ─── Events ───────────────────────────────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', saveAll);
document.getElementById('addCommentBtn').addEventListener('click', addComment);
document.getElementById('newCommentText').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addComment();
});

document.addEventListener('input', e => {
  const el = e.target.closest('[data-field]');
  if (el) onFieldChange(el);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-field]');
  if (el) onFieldChange(el);
});

// Предупреждение при уходе с несохранёнными изменениями
window.addEventListener('beforeunload', e => {
  if (hasChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Ctrl+S / Cmd+S
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (hasChanges) saveAll();
  }
});

document.addEventListener('refreshPage', loadDetail);

// ─── Init ─────────────────────────────────────────────────────────────────────
checkAuth(['admin', 'employee']).then(user => { if (user) loadDetail(); });
