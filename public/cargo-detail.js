// cargo-detail.js — single cargo drilldown page

const $ = id => document.getElementById(id);

// ─── Number / money helpers (mirror of dashboard.js) ─────────────────────────
function ruNum(v) {
  if (!v && v !== 0) return NaN;
  return parseFloat(String(v).replace('%','').replace(/\s/g,'').replace(',','.'));
}
function fmtRuNum(v, decimals = 2) {
  const n = ruNum(v);
  if (isNaN(n) || n === 0) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}
function fmtMoney(v) {
  const n = ruNum(v);
  if (isNaN(n) || n === 0) return '—';
  return '$\u202f' + n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function cargoStatusClass(s) {
  const sl = (s || '').toLowerCase();
  if (/доставлен|delivered|получен/.test(sl))        return 'delivered';
  if (/отправ|в пути|transit|shipped|sent/.test(sl)) return 'transit';
  if (/склад|warehouse|хранени/.test(sl))            return 'warehouse';
  return '';
}

// ─── Date helpers ────────────────────────────────────────────────────────────
function parseRuDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (m) {
    const yr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = new Date(yr, +m[2] - 1, +m[1]);
    if (!isNaN(d)) return d;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}
function pluralRu(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5)   return few;
  if (b === 1)          return one;
  return many;
}

function smartArrivalLabel(r) {
  const cls     = cargoStatusClass(r.status);
  const arrival = parseRuDate(r.arrival);
  const start   = parseRuDate(r.date);
  if (!arrival) return null;

  const today = new Date(); today.setHours(0,0,0,0);

  if (cls === 'delivered') {
    if (start) {
      const days = daysBetween(start, arrival);
      if (days != null && days > 0) {
        return { kind: 'delivered',
          label: `Прибыл за ${days} ${pluralRu(days, 'день', 'дня', 'дней')}`,
          date:  fmtDate(r.arrival)
        };
      }
    }
    return { kind: 'delivered', label: 'Доставлен', date: fmtDate(r.arrival) };
  }

  const left = daysBetween(today, arrival);
  if (left == null) return null;
  if (left < 0)   return { kind: 'overdue',      label: `Просрочка ${-left} ${pluralRu(-left,'день','дня','дней')}`, date: fmtDate(r.arrival) };
  if (left === 0) return { kind: 'transit-soon', label: 'Прибудет сегодня', date: fmtDate(r.arrival) };
  if (left <= 3)  return { kind: 'transit-soon', label: `Прибудет через ${left} ${pluralRu(left,'день','дня','дней')}`, date: fmtDate(r.arrival) };
  return { kind: 'transit', label: `Прибудет через ${left} ${pluralRu(left,'день','дня','дней')}`, date: fmtDate(r.arrival) };
}

// ─── State ───────────────────────────────────────────────────────────────────
let clientId = '';
let cargoId  = '';

// ─── State machine ───────────────────────────────────────────────────────────
function showState(s) {
  $('loadingState').classList.toggle('hidden', s !== 'loading');
  $('errorState').classList.toggle('hidden',   s !== 'error');
  $('content').classList.toggle('hidden',      s !== 'content');
}

function showError(msg) {
  $('errorMsg').textContent = msg || '';
  showState('error');
}

// ─── Load + find ─────────────────────────────────────────────────────────────
async function load() {
  showState('loading');

  const params = new URLSearchParams(window.location.search);
  cargoId = (params.get('id') || '').trim();
  if (!cargoId) {
    showError('Не указан номер груза');
    return;
  }

  // auth check
  let user = null;
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) user = (await r.json()).user;
  } catch {}
  if (!user) { window.location.href = '/'; return; }

  // figure out which client to query
  if (user.role === 'client') {
    clientId = user.clientId;
  } else {
    clientId = (params.get('client') || '').trim();
    if (!clientId) {
      // Try to derive from cargo_number prefix (e.g. "89029-1-1004-1" → "89029")
      const m = cargoId.match(/^([^-_/\\]+)/);
      if (m) clientId = m[1];
    }
  }

  if ($('clientIdDisplay')) $('clientIdDisplay').textContent = clientId || '—';

  try {
    const url = `/api/client/shipments${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''}`;
    const res = await fetch(url);
    if (res.status === 401) { window.location.href = '/'; return; }
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Ошибка загрузки');

    const list = body.data || [];
    const row  = list.find(r => (r.cargo_number || '').trim() === cargoId);
    if (!row) {
      showError(`Груз «${cargoId}» не найден среди ваших отправок.`);
      return;
    }

    document.title = `${cargoId} — FreewayChina`;
    render(row);
    showState('content');
  } catch (err) {
    showError(err.message);
  }
}

// ─── Render ──────────────────────────────────────────────────────────────────
function render(r) {
  const cls = cargoStatusClass(r.status);
  const badgeMap = { delivered: 'Доставлен', transit: 'В пути', warehouse: 'На складе' };
  const badgeLabel = r.status || badgeMap[cls] || '—';

  const arr = smartArrivalLabel(r);

  // Timeline state: 3 steps загружен → в пути → прибыл
  const tl = (() => {
    if (cls === 'delivered') return [
      { state: 'done', label: 'Загружен',      date: fmtDate(r.date) },
      { state: 'done', label: 'В пути',        date: '' },
      { state: 'done', label: 'Прибыл',        date: fmtDate(r.arrival) },
    ];
    if (cls === 'transit') return [
      { state: 'done',   label: 'Загружен', date: fmtDate(r.date) },
      { state: 'active', label: 'В пути',   date: '' },
      { state: '',       label: 'Ожидается', date: r.arrival ? fmtDate(r.arrival) : '' },
    ];
    if (cls === 'warehouse') return [
      { state: 'warehouse-active', label: 'На складе', date: fmtDate(r.date) },
      { state: '', label: 'В пути',  date: '' },
      { state: '', label: 'Прибыл',  date: '' },
    ];
    return [
      { state: '', label: 'Загружен', date: fmtDate(r.date) },
      { state: '', label: 'В пути',   date: '' },
      { state: '', label: 'Прибыл',   date: r.arrival ? fmtDate(r.arrival) : '' },
    ];
  })();

  const tlLineState = (() => {
    if (cls === 'delivered') return ['done', 'done'];
    if (cls === 'transit')   return ['done', 'partial'];
    return ['', ''];
  })();

  // Cost rows
  const insLabel = (() => {
    const pct = ruNum(r.insurance_pct);
    return !isNaN(pct) && pct > 0 ? `Страховка (${pct}%)` : 'Страховка';
  })();

  const costRows = [
    ['Стоимость груза', r.cargo_cost],
    [insLabel,          r.insurance_usd],
    ['Упаковка',        r.packaging],
    ['Погрузка',        r.loading],
  ].filter(([, v]) => ruNum(v) > 0);

  // Hero meta
  const heroMeta = [];
  heroMeta.push(`<span><strong>${esc(fmtDate(r.date))}</strong> · отправка</span>`);
  if (r.category) heroMeta.push(`<span>Категория: <strong>${esc(r.category)}</strong></span>`);
  if (arr) heroMeta.push(`<span class="hero-arrival ${arr.kind}">${esc(arr.label)} · ${esc(arr.date)}</span>`);

  $('content').innerHTML = `
    <div class="detail-hero ${cls}">
      <div class="hero-top">
        <div class="hero-num-row">
          <span class="hero-num">${esc(r.cargo_number || '—')}</span>
          ${r.cargo_number ? `
            <button class="hero-copy" id="heroCopyBtn" title="Скопировать">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>` : ''}
        </div>
        <div class="hero-badge ${cls}">${esc(badgeLabel)}</div>
      </div>
      <div class="hero-meta">${heroMeta.join('')}</div>
    </div>

    <div class="timeline-card">
      <div class="timeline-title">Этапы доставки</div>
      <div class="timeline-track">
        <div class="tl-node ${tl[0].state}">${tlIcon(tl[0].state)}</div>
        <div class="tl-line ${tlLineState[0]}"></div>
        <div class="tl-node ${tl[1].state}">${tlIcon(tl[1].state)}</div>
        <div class="tl-line ${tlLineState[1]}"></div>
        <div class="tl-node ${tl[2].state}">${tlIcon(tl[2].state)}</div>
      </div>
      <div class="tl-labels">
        ${tl.map(s => `
          <div class="tl-lbl ${s.state === 'done' ? 'done' : s.state === 'active' || s.state === 'warehouse-active' ? 'active' : ''}">
            ${esc(s.label)}
            ${s.date && s.date !== '—' ? `<span class="tl-lbl-date">${esc(s.date)}</span>` : ''}
          </div>`).join('')}
      </div>
    </div>

    <div class="metrics-row">
      <div class="big-metric">
        <div class="big-metric-lbl">Мест</div>
        <div class="big-metric-val">${esc(r.places || '—')}</div>
      </div>
      <div class="big-metric">
        <div class="big-metric-lbl">Вес</div>
        <div class="big-metric-val">${esc(fmtRuNum(r.weight, 1))}<span class="big-metric-unit">кг</span></div>
      </div>
      <div class="big-metric">
        <div class="big-metric-lbl">Объём</div>
        <div class="big-metric-val">${esc(fmtRuNum(r.volume, 3))}<span class="big-metric-unit">м³</span></div>
      </div>
    </div>

    <div class="detail-grid">
      <div class="info-card">
        <div class="info-card-title">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          </svg>
          Параметры груза
        </div>
        ${infoRow('Категория',  r.category || '—')}
        ${infoRow('Плотность',  ruNum(r.density) > 0 ? `${fmtRuNum(r.density, 0)} кг/м³` : '—')}
        ${infoRow('Цена за кг', fmtMoney(r.price_per_kg))}
        ${infoRow('Мест',       r.places || '—')}
      </div>

      <div class="info-card">
        <div class="info-card-title">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8"  y1="2" x2="8"  y2="6"/>
            <line x1="3"  y1="10" x2="21" y2="10"/>
          </svg>
          Сроки
        </div>
        ${infoRow('Дата отправки', fmtDate(r.date))}
        ${infoRow('Дата прибытия', r.arrival ? fmtDate(r.arrival) : '—')}
        ${(() => {
          const ds = parseRuDate(r.date);
          const da = parseRuDate(r.arrival);
          if (ds && da) {
            const days = daysBetween(ds, da);
            if (days != null && days >= 0) {
              return infoRow('В пути', `${days} ${pluralRu(days,'день','дня','дней')}`);
            }
          }
          return '';
        })()}
        ${infoRow('Статус', badgeLabel)}
      </div>

      <div class="info-card total-card">
        <div class="info-card-title">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <line x1="12" y1="1" x2="12" y2="23"/>
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          Расчёт стоимости
        </div>
        ${costRows.map(([lbl, val]) => `
          <div class="info-row">
            <span class="lbl">${esc(lbl)}</span>
            <span class="val">${esc(fmtMoney(val))}</span>
          </div>`).join('')}
        ${costRows.length === 0 ? `
          <div class="info-row">
            <span class="lbl">Нет детализации</span>
            <span class="val">—</span>
          </div>` : ''}
        <div class="info-row total-row grand">
          <span class="lbl">Итого</span>
          <span class="val">${esc(fmtMoney(r.total))}</span>
        </div>
      </div>
    </div>`;

  // Wire copy
  const copyBtn = $('heroCopyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(r.cargo_number).then(() => {
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        }, 1500);
      }).catch(() => {});
    });
  }
}

function infoRow(lbl, val) {
  return `
    <div class="info-row">
      <span class="lbl">${esc(lbl)}</span>
      <span class="val">${esc(val)}</span>
    </div>`;
}

function tlIcon(state) {
  if (state === 'done') {
    return '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
  }
  if (state === 'active') {
    return '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M3 17l2-7h14l2 7H3Z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg>';
  }
  if (state === 'warehouse-active') {
    return '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M3 9l9-6 9 6v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/></svg>';
  }
  return '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';
}

// ─── Logout ──────────────────────────────────────────────────────────────────
const logoutBtn = $('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/';
  });
}

// ─── Init ────────────────────────────────────────────────────────────────────
load();
