// admin-header.js — единая шапка для всех страниц админ-панели.
// Подключается ПОСЛЕ <div id="adminHeader"></div> и ДО page-specific скриптов,
// чтобы #refreshBtn существовал к моменту, когда страничный JS навешивает обработчики.
// Кнопку "Выйти" автоматически добавляет auth-guard.js в .dash-header-inner.

(function () {
  const path = (location.pathname || '').toLowerCase().replace(/\/+/g, '/');

  const links = [
    { href: '/admin.html',           label: 'E-commerce' },
    { href: '/shipments.html',       label: 'Отгрузки' },
    { href: '/cargo-dashboard.html', label: 'Аналитика грузов' },
    { href: '/tasks.html',           label: 'Задачи' },
    { href: '/upload.html',          label: 'Создать отгрузку' },
    { href: '/history.html',         label: 'История' },
  ];

  const isActive = href => path === href.toLowerCase()
    || (href === '/admin.html' && (path === '/' || path === '/admin'));

  const navHtml = links.map(l =>
    `<a href="${l.href}" class="admin-nav-link${isActive(l.href) ? ' active' : ''}">${l.label}</a>`
  ).join('');

  const html = `<header class="dash-header">
    <div class="dash-header-inner">
      <a href="/admin.html" class="header-logo">
        <img src="/logo-white.png" alt="FreewayChina" style="height:24px;width:auto;display:block;">
      </a>
      <nav class="admin-nav">${navHtml}</nav>
      <button class="btn-ghost" id="refreshBtn" title="Обновить данные">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
        Обновить
      </button>
    </div>
  </header>`;

  const placeholder = document.getElementById('adminHeader');
  if (placeholder) {
    placeholder.outerHTML = html;
  } else {
    document.body.insertAdjacentHTML('afterbegin', html);
  }
})();
