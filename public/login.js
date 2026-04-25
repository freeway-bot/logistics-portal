// login.js — unified login for all roles + track search

// ─── Mode toggle ──────────────────────────────────────────────────────────────

const modeBtns   = document.querySelectorAll('.mode-btn');
const loginPanel = document.getElementById('loginPanel');
const trackPanel = document.getElementById('trackPanel');

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    modeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.mode;
    loginPanel.classList.toggle('hidden', mode !== 'login');
    trackPanel.classList.toggle('hidden',  mode !== 'track');
    clearErrors();
    if (mode === 'login') document.getElementById('loginInput').focus();
    else document.getElementById('trackInput').focus();
  });
});

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginInput').focus();
  if (new URLSearchParams(location.search).get('mode') === 'track') {
    document.querySelector('[data-mode="track"]').click();
  }
});

// ─── Password toggle ──────────────────────────────────────────────────────────

document.getElementById('togglePwd').addEventListener('click', () => {
  const input = document.getElementById('passwordInput');
  const icon  = document.getElementById('eyeIcon');
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  icon.innerHTML = isHidden
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
});

// ─── Login form ───────────────────────────────────────────────────────────────

const loginForm  = document.getElementById('loginForm');
const loginInput = document.getElementById('loginInput');
const loginError = document.getElementById('loginError');
const loginBtn   = document.getElementById('loginBtn');

loginForm.addEventListener('submit', async e => {
  e.preventDefault();
  const login    = loginInput.value.trim();
  const password = document.getElementById('passwordInput').value;

  if (!login)    return showErr(loginError, 'Введите ID клиента или логин');
  if (!password) return showErr(loginError, 'Введите пароль');

  setLoading(loginBtn, true, 'Проверяем…');
  clearErrors();

  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    });
    const data = await res.json();

    if (!res.ok) return showErr(loginError, data.error || 'Ошибка входа');

    const { role, clientId } = data.user;
    if (role === 'client') {
      window.location.href = `/dashboard.html`;
    } else if (role === 'employee') {
      window.location.href = '/shipments.html';
    } else if (role === 'admin') {
      window.location.href = '/admin.html';
    } else {
      window.location.href = '/dashboard.html';
    }
  } catch {
    showErr(loginError, 'Нет соединения с сервером');
  } finally {
    setLoading(loginBtn, false, 'Войти');
  }
});

loginInput.addEventListener('input', () => loginError.classList.add('hidden'));

// ─── Track search form ────────────────────────────────────────────────────────

const trackForm  = document.getElementById('trackForm');
const trackInput = document.getElementById('trackInput');
const trackError = document.getElementById('trackError');
const trackBtn   = document.getElementById('trackBtn');

trackForm.addEventListener('submit', async e => {
  e.preventDefault();
  const track = trackInput.value.trim();
  if (!track)           return showErr(trackError, 'Введите трек-номер');
  if (track.length < 3) return showErr(trackError, 'Минимум 3 символа для поиска');

  setLoading(trackBtn, true, 'Ищем…');
  clearErrors();

  try {
    const res  = await fetch(`/api/search?track=${encodeURIComponent(track)}`);
    const data = await res.json();
    if (!res.ok)       return showErr(trackError, data.error || 'Ошибка поиска');
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
function clearErrors() { [loginError, trackError].forEach(e => e.classList.add('hidden')); }
function setLoading(btn, on, label) { btn.disabled = on; btn.textContent = label; }
