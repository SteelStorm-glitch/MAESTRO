# MAESTRO — AI Orchestra

Локальный «дирижёр» для команды LLM-агентов. Подключайте любых провайдеров через API-ключ и
кастомный Base URL, собирайте роли в оркестры и запускайте их на папке проекта: агенты читают и
правят файлы, выполняют команды и отчитываются в реальном времени в минималистичном чёрном UI.

```
React (Vite)  ──REST/SSE/WS──  Fastify  ──  Orchestra Engine  ──  Provider Adapters
                                   │              │
                               SQLite         Tools sandbox (fs / shell / git)
```

## Быстрый старт

Требования: **Node.js 20+**, **pnpm 9+**. Windows / macOS / Linux.

```bash
pnpm install
pnpm dev
```

- API: http://127.0.0.1:5117 (health: `/api/health`)
- UI (Vite): http://localhost:5173

Прод-режим (один сервер, статика из `apps/web/dist`):

```bash
pnpm build
pnpm --filter @maestro/server start
# открыть http://127.0.0.1:5117
```

## Портативная Windows-сборка (.exe)

```bash
pnpm dist:win
```

Результат: `release/MAESTRO-0.1.0-portable.exe` (~140 МБ) — один файл, установка не нужна.
Внутри: Electron-окно, Node.js 24, собранный сервер и веб-интерфейс.

- Данные (БД, ключи, лог) лежат в папке `MAESTRO-data` **рядом с .exe**, поэтому приложение
  можно целиком переносить на флешке.
- Первый запуск занимает 30–60 секунд: лаунчер распаковывает рантайм в
  `%LOCALAPPDATA%\MAESTRO\runtime-<версия>`. Последующие запуски — около 10 секунд.
- Порт выбирается автоматически; приложение работает в одном экземпляре.
- Сборка не подписана: при первом запуске Windows SmartScreen может показать предупреждение.
- Пересборка после изменений — та же команда `pnpm dist:win` (нужны Node.js 20+ и pnpm).
  Полная сборка занимает ~5 минут, из них около 3 минут — сжатие финального `.exe`.

Данные дев-режима хранятся в `~/.maestro/`:

- `maestro.db` — SQLite (WAL);
- `secret` — мастер-ключ AES-256-GCM (права 600);
- `maestro.log` — лог сервера (ключи маскируются).

Переопределение: `MAESTRO_HOME`, `MAESTRO_DB`, `PORT`, `HOST`, `MAESTRO_TOKEN`
(локальный токен для изменяющих запросов, заголовок `x-maestro-token`).

## Возможности

- **Провайдеры**: `openai-compatible` (OpenAI, DeepSeek, OpenRouter, Groq, Mistral, xAI, Ollama,
  LM Studio, прокси), `anthropic`, `gemini`. Кастомный Base URL, доп. заголовки, таймаут.
- **Модели**: авто-загрузка списка у провайдера или ручное добавление; флаги tools/vision,
  context window, max output.
- **Роли**: системный промпт с плейсхолдерами `{{project_root}}`, `{{role_name}}`,
  `{{team_roster}}`, выбор модели, температура, набор инструментов, `read/write/admin`,
  режим shell `off/confirm/auto`, цвет бейджа. Шесть пресетов создаются при первом запуске.
- **Оркестры**: стратегии `conductor`, `pipeline`, `council`; дирижёр, аудитор, багхантер;
  лимиты раундов/токенов; режим подтверждений; валидация перед запуском.
- **Движок**: планирование JSON → DAG задач (до 4 параллельно) → ревью аудитором →
  исправления багхантером (до 3 циклов) → финал или новый раунд. Автосуммаризация контекста,
  бюджет токенов, защита от циклов повторных tool-вызовов, pause/resume/cancel, сообщения
  конкретному агенту через `@Имя`.
- **Инструменты**: `fs_list`, `fs_read`, `fs_search` (ripgrep + fallback), `fs_write`,
  `fs_append`, `fs_move`, `fs_delete` (в `.maestro_trash`), `shell_exec`, `git_status/diff/log`.
  Path-jail (realpath внутри проекта), denylist команд, подтверждения shell.
- **UI**: тёмная тема по токенам, файловое дерево с live-обновлением и метками `+ ~ -`,
  timeline с живым стримом и планом-чеклистом, инспектор агентов, консоли «События /
  Терминал (node-pty + xterm) / Запросы», предпросмотр файлов (CodeMirror), история сессий.
- **Экспорт/импорт**: оркестры (с ролями) и провайдеры (без ключей) в JSON.

## Скрипты

| Команда | Что делает |
|---|---|
| `pnpm dev` | сервер (tsx watch) + web (vite) |
| `pnpm build` | сборка сервера (tsup) и web (vite) |
| `pnpm test` | Vitest: crypto, path-guard, парсинг плана, токены |
| `pnpm typecheck` | tsc во всех пакетах |
| `pnpm lint` | ESLint |
| `pnpm dist:win` | портативный Windows `.exe` в `release/` |

## Структура

```
apps/server/src
  db/          schema.ts · client.ts · migrations/ · repo/* · seed.ts
  providers/   base.ts · openai.ts · anthropic.ts · gemini.ts · registry.ts
  orchestra/   engine.ts · conductor.ts · executor.ts · context.ts · prompts.ts · validate.ts
  tools/       fs.ts · search.ts · shell.ts · git.ts · guard.ts · index.ts
  routes/      providers · models · roles · orchestras · projects · fs · sessions
  events/      bus.ts
  fs/          watcher.ts (chokidar)
  terminal/    manager.ts (node-pty)
apps/web/src
  components/  TopBar · Sidebar · files/ · session/ · inspector/ · console/ · providers/ ·
               roles/ · orchestras/ · common/
  store/       app.ts · session.ts · files.ts (zustand)
  api/         client.ts · sse.ts · terminal.ts
packages/shared  types.ts · events.ts · protocols.ts
```

## Настройка провайдеров

| Провайдер | Protocol | Base URL | Ключ |
|---|---|---|---|
| DeepSeek | openai-compatible | `https://api.deepseek.com` | `sk-…` |
| OpenAI | openai-compatible | `https://api.openai.com/v1` | `sk-…` |
| OpenRouter | openai-compatible | `https://openrouter.ai/api/v1` | `sk-or-…` |
| Ollama | openai-compatible | `http://localhost:11434/v1` | любой/пусто |
| LM Studio | openai-compatible | `http://localhost:1234/v1` | любой/пусто |
| Anthropic | anthropic | `https://api.anthropic.com` | `sk-ant-…` |
| Google Gemini | gemini | `https://generativelanguage.googleapis.com` | AI Studio key |

После сохранения: **Test connection** → **Загрузить модели** → включите нужные.
Затем в ролях выберите модели и соберите оркестр.

## Безопасность

- Сервер слушает только `127.0.0.1`.
- Ключи шифруются AES-256-GCM; в API отдаётся только маска `••••1234`.
- Все файловые операции проходят path-jail: `realpath` обязан остаться внутри корня проекта,
  симлинки наружу отклоняются.
- `shell_exec` блокируется denylist-ом (`rm -rf /`, `sudo`, `mkfs`, fork-бомбы и т.п.),
  переменные окружения с ключами не передаются дочерним процессам.
- Режим `confirm` вешает вызов до решения пользователя; `deny` запрещает shell на уровне оркестра.
- Удаление файлов — перемещение в `.maestro_trash`, а не безвозвратное удаление.

## Ограничения текущей версии

- Интерфейс на русском; переключатель ru/en из M8 пока не реализован.
- Виртуализация дерева не включена: сервер отдаёт до 5000 узлов, глубокие большие репозитории
  лучше открывать с включённым `.gitignore`-фильтром.
- Drag&drop из ОС принимает текстовые файлы до 2 МБ (бинарные пропускаются).
- `council` — базовая реализация (параллельные ответы + синтез дирижёром).
- MCP, облачная синхронизация, git-автокоммиты — вне скоупа v1.
