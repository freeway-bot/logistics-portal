// login.js — handles both login modes

// ─── Mode toggle ──────────────────────────────────────────────────────────────

const modeBtns    = document.querySelectorAll('.mode-btn');
const clientPanel = document.getElementById('clientPanel');
const trackPanel  = document.getElementById('trackPanel');

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    modeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.mode;
    clientPanel.classList.toggle('hidden', mode !== 'client');
    trackPanel.classList.toggle('hidden',  mode !== 'track');
    clearErrors();
    if (mode === 'client') document.getElementById('clientInput').focus();
    else document.getElementById('trackInput').focus();
  });
});

// Focus first input on load
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('clientInput').focus();

  // If URL has ?mode=track, switch automatically
  if (new URLSearchParams(location.search).get('mode') === 'track') {
    document.querySelector('[data-mode="track"]').click();
  }
});

// ─── Client ID form ───────────────────────────────────────────────────────────

const clientForm  = document.getElementById('clientForm');
const clientInput = document.getElementById('clientInput');
const clientError = document.getElementById('clientError');
const clientBtn   = document.getElementById('clientBtn');

clientForm.addEventListener('submit', async e => {
  e.preventDefault();
  const id = clientInput.value.trim();
  if (!id) return showErr(clientError, 'Введите ваш ID клиента');

  setLoading(clientBtn, true, 'Проверяем…');
  clearErrors();

  try {
    const res = await fetch(`/api/client/${encodeURIComponent(id)}`);
    if (res.status === 404) return showErr(clientError, 'Клиент с таким ID не найден');
    if (!res.ok) { const d = await res.json().catch(()=>({})); return showErr(clientError, d.error || 'Ошибка сервера'); }
    window.location.href = `/dashboard.html?id=${encodeURIComponent(id)}`;
  } catch {
    showErr(clientError, 'Нет соединения с сервером');
  } finally {
    setLoading(clientBtn, false, 'Войти в кабинет');
  }
});

clientInput.addEventListener('input', () => clientError.classList.add('hidden'));

// ─── Track search form ────────────────────────────────────────────────────────

const trackForm  = document.getElementById('trackForm');
const trackInput = document.getElementById('trackInput');
const trackError = document.getElementById('trackError');
const trackBtn   = document.getElementById('trackBtn');

trackForm.addEventListener('submit', async e => {
  e.preventDefault();
  const track = trackInput.value.trim();
  if (!track)          return showErr(trackError, 'Введите трек-номер');
  if (track.length < 3) return showErr(trackError, 'Минимум 3 символа для поиска');

  setLoading(trackBtn, true, 'Ищем…');
  clearErrors();

  try {
    const res = await fetch(`/api/search?track=${encodeURIComponent(track)}`);
    const data = await res.json();

    if (!res.ok) return showErr(trackError, data.error || 'Ошибка поиска');
    if (data.total === 0) return showErr(trackError, 'Ничего не найдено по этому треку');

    window.location.href = `/search.html?track=${encodeURIComponent(track)}`;
  } catch {
    showErr(trackError, 'Нет соединения с сервером');
  } finally {
    setLoading(trackBtn, false, 'Найти груз');
  }
});

trackInput.addEventListener('input', () => trackError.classList.add('hidden'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showErr(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function clearErrors() { [clientError, trackError].forEach(e => e.classList.add('hidden')); }

function setLoading(btn, on, label) {
  btn.disabled = on;
  btn.textContent = label;
}
