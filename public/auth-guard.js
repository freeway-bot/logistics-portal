// auth-guard.js — include BEFORE page-specific script on all protected pages

window.__authUser = null;

async function checkAuth(requiredRoles) {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/'; return null; }
    const { user } = await res.json();
    if (requiredRoles && !requiredRoles.includes(user.role)) {
      window.location.href = '/';
      return null;
    }
    window.__authUser = user;
    return user;
  } catch {
    window.location.href = '/';
    return null;
  }
}

async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  window.location.href = '/';
}

// Auto-inject logout button + username into any admin header
document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('.dash-header-inner');
  if (!header) return;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:auto';

  const userName = document.createElement('span');
  userName.id = 'headerUserName';
  userName.style.cssText = 'font-size:12px;color:var(--text-3);display:none';

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'btn-ghost';
  logoutBtn.id = 'globalLogoutBtn';
  logoutBtn.title = 'Выйти';
  logoutBtn.innerHTML = `
    <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
    Выйти`;
  logoutBtn.addEventListener('click', logout);

  // Move any existing refresh/action button(s) before the new wrap, then append wrap
  const existingBtns = header.querySelectorAll('.btn-ghost');
  existingBtns.forEach(b => b.style.marginLeft = '0');

  wrap.appendChild(userName);
  wrap.appendChild(logoutBtn);
  header.appendChild(wrap);

  // Populate username once auth resolves
  fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(data => {
    if (!data) return;
    userName.textContent = data.user.fullName || data.user.username;
    userName.style.display = 'block';
  }).catch(() => {});
});
