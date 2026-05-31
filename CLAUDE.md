# Logistics Portal — инструкции для Claude Code

## Стек

- **Backend**: Node.js + Express (`server.js` — один файл, всё в нём)
- **Frontend**: чистый HTML/CSS/JS, без фреймворков (`public/`)
- **БД**: Google Sheets API (два листа — Scans и Логистика)
- **Деплой**: Railway (backend) + Netlify (frontend static)
- **Auth**: JWT в httpOnly cookie, роли: `admin` / `employee` / `client`

## Переменные окружения (`.env`, не коммитить)

```
PORT=3000
SCANS_SPREADSHEET_ID=...          # таблица Scans (посылки)
LOGISTICS_SPREADSHEET_ID=...      # таблица Логистика (грузы + пользователи)
LOGISTICS_CARGO_SHEET=送货 Логистика
GOOGLE_KEY_FILE=./credentials/service-account.json
CACHE_TTL_SECONDS=60
JWT_SECRET=...                    # обязательно задать в проде
ALLOWED_ORIGINS=https://...
```

## Запуск локально

```bash
npm install
node server.js       # или: npm run dev (nodemon)
# → http://localhost:3000
```

Credentials: `./credentials/service-account.json` (не в git).

## Структура БД — Google Sheets

### Scans (`SCANS_SPREADSHEET_ID`)
Лист `Scans` — посылки клиентов. Колонки читаются через `COLUMN_MAP` (keyword-based).
Лист `Отправления` — привязка трек → груз.

### Логистика (`LOGISTICS_SPREADSHEET_ID`)
Лист `送货 Логистика` — грузы. **Колонки читаются по фиксированным индексам** через `CARGO_COLS`:

| idx | поле |
|-----|------|
| 0  | Дата отправки |
| 1  | Клиент (client_id) |
| 3  | Категория |
| 4  | Номер груза |
| 5  | Мест |
| 6  | Вес (кг) |
| 7  | Объём (м³) |
| 8  | Цена/кг |
| 9  | Плотность |
| 10 | Стоимость груза |
| 11 | Страховка % |
| 12 | Страховка $ |
| 13 | Упаковка |
| 14 | Погрузка |
| 15 | Итого |
| 16 | Статус |
| 18 | Дата прибытия (到货日期) |
| 20 | Маршрут |
| 21 | Перевозчик |
| 23 | Комментарии (JSON) |

> **Важно**: Google Sheets хранит числа с запятой (`0,51`, `3,00%`).
> На сервере данные отдаются как есть. На фронтенде используй `pf(v)` / `normalizeNum(v)` для парсинга.

Лист `Users` — пользователи (username, client_id, role, active, last_login).
Лист `Пароли` — аудит паролей.

## Ключевые функции сервера (`server.js`)

```js
CARGO_COLS          // маппинг поле → индекс колонки
getCol(r, idx)      // получить значение из строки по индексу
normalizeCargoRow() // превратить сырую строку в объект для API
cargoToShipment()   // переименовать поля для фронтенда
parseItemDate(str)  // парсить DD.MM.YYYY → Date
toLetterCol(n)      // число → буква колонки (0→A, 25→Z, 26→AA)
invalidateCargoCache() // сбросить кеш грузов
```

### Запись в Sheets (PATCH груза)
Используется `batchUpdate` с `valueInputOption: 'RAW'`.
Маппинг поле API → индекс колонки задан в `fieldColMap` внутри PATCH-хендлера.

### Комментарии к грузу
Хранятся в колонке 23 как JSON-массив: `[{"ts":"ISO-string","text":"..."}]`.
Обратная совместимость: если в ячейке обычный текст (не JSON) — фронтенд оборачивает как одну запись с `ts: null`.

## Страницы фронтенда

| файл | роль | доступ |
|------|------|--------|
| `index.html` | логин | все |
| `admin.html` / `admin.js` | E-commerce (посылки) | admin, employee |
| `shipments.html` / `shipments.js` | список грузов | admin, employee |
| `cargo-dashboard.html` / `cargo-dashboard.js` | аналитика грузов | admin, employee |
| `tasks.html` / `tasks.js` | задачи (неполные данные) | admin, employee |
| `shipment-detail.html` / `shipment-detail.js` | редактирование груза | admin, employee |
| `upload.html` / `upload.js` | создать отгрузку | admin, employee |
| `history.html` | история операций | admin, employee |
| `client.html` / `client.js` | кабинет клиента | client |
| `admin-header.js` | навбар (подключается на всех admin-страницах) | — |

## Навигация (admin-header.js)

```js
{ href: '/admin.html',           label: 'E-commerce' },
{ href: '/shipments.html',       label: 'Отгрузки' },
{ href: '/cargo-dashboard.html', label: 'Аналитика грузов' },
{ href: '/tasks.html',           label: 'Задачи' },
{ href: '/upload.html',          label: 'Создать отгрузку' },
{ href: '/history.html',         label: 'История' },
```

## Деплой

> **Важно**: автодеплоя нет ни у одного сервиса. Push в `main` сам по себе
> ничего не выкатывает — деплой всегда ручной, отдельно для бэка и фронта.

**Railway** (backend + server.js):
- Деплой вручную через Railway GraphQL API (`serviceInstanceDeployV2` с `commitSha`).
- serviceId / environmentId / токен — в memory `infrastructure.md`.
- Env vars задаются в Railway Dashboard → Variables

**Netlify** (frontend static из `public/`):
- Деплой вручную: `netlify deploy --prod --dir=public`
- `scripts/gen-redirects.js` генерирует `public/_redirects` при билде
- Все запросы к `/api/*` должны проксироваться на Railway URL через `_redirects`

## Правила разработки

- Числа из Google Sheets парси через `pf(v)` (фронт) — заменяет `,` → `.` и убирает `%`.
- Новые поля груза: добавляй в `CARGO_COLS` (индекс), `normalizeCargoRow()`, `cargoToShipment()`, `fieldColMap` в PATCH, `FIELDS` в `shipment-detail.js`.
- Кеш грузов живёт `CACHE_TTL_SECONDS` секунд. После записи вызывай `invalidateCargoCache()`.
- Лимит грузов в API: `Math.min(parseInt(limit) || 50, 2000)`.
- Не добавляй `service-account.json` в git (уже в `.gitignore` через `credentials/*.json`, но корневой файл тоже исключён).
