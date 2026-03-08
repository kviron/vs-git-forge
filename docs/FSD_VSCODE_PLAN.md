# FSD + VS Code Extension: план структуры

Объединение методологии Feature-Sliced Design с разработкой расширения VS Code: единая структура в `src/`, webview по слоям FSD, код хоста расширения — в отдельном слое.

---

## 1. Идея

- **Один корень** — вся разработка в `src/`.
- **Webview** строится по FSD: `app` → `views` → `widgets` → `features` → `entities` → `shared`.
- **Extension host** (Node.js) — слой **host/**: всё, что выполняется только в процессе VS Code (команды, провайдеры, Git API, сообщения webview).
- **shared** используется и webview, и (частично) host: типы, константы, утилиты без UI.

---

## 2. Целевая структура `src/`

```
src/
├── app/                          # Слой приложения (оба рантайма)
│   ├── extension.ts              # Точка входа расширения (Node, esbuild)
│   ├── webview-main.tsx          # Точка входа webview (браузер, Vite)
│   ├── providers/                # Регистрация провайдеров (опционально)
│   └── config/
│       └── constants.ts          # Общие константы (из constants.ts)
│
├── views/                        # Webview: страницы
│   └── git-view/
│       ├── ui/
│       │   └── GitViewPage.tsx
│       └── index.ts
│
├── widgets/                      # Webview: сложные блоки
│   ├── branches-pane/
│   ├── commit-graph/
│   ├── commit-history/
│   └── commit-details-panel/
│
├── features/                     # Webview: действия пользователя
│   ├── branch-list/
│   ├── tag-list/
│   ├── changed-files/
│   ├── commit-details-card/
│   ├── branches-pane-toolbar/
│   └── commit-search-filters/
│
├── entities/                     # Webview: доменные сущности
│   ├── branch/
│   ├── commit/
│   └── tag/
│
├── shared/                       # Общее: UI-примитивы, API, утилиты, типы
│   ├── ui/                       # Кнопки, иконки (IconButton и т.д.)
│   │   └── IconButton/
│   ├── api/                      # Webview: postMessage-клиент (vscodeApi), types
│   ├── lib/                      # branch, types, contextMenuIcons, mock-data
│   ├── config/                   # Константы, используемые только в webview
│   ├── context/                  # SelectedBranchContext
│   ├── i18n/
│   ├── logger.ts
│   └── styles.css
│
├── host/                         # Только extension host (Node)
│   ├── api/                      # webviewApi, handlers, branchMapping, dateFormat, ideContext
│   ├── commands/                 # changedFileCommands, (branchDiff — по желанию)
│   ├── core/                     # repoManager, logger
│   ├── git/                      # shell, remote, avatars
│   ├── tree/                     # changedFilesTree, branchDiffTree
│   ├── statusBar/                 # branchStatusBar
│   ├── lifecycle/                 # startup, uninstall, utils
│   ├── providers/                 # gitForgeTreeProvider (если есть)
│   ├── diff/                     # getCommitFile
│   ├── diffDocProvider.ts
│   ├── messageHandler.ts
│   ├── panelProvider.ts
│   └── panelHtml.ts
│
└── types/                        # Общие типы (vscode-git, webview, git)
    ├── webview.ts
    ├── vscodeGit.ts
    ├── git.ts
    └── ...
```

**Правила импорта:**

- **app/extension.ts** импортирует только из `host/`, `shared/config` (или `app/config`), `types`.
- **app/webview-main.tsx** импортирует из `views`, `widgets`, `features`, `entities`, `shared` (по FSD: сверху вниз).
- **host/** не импортирует из views/widgets/features/entities (только из shared, если нужны типы/константы, и из types).
- **shared** не импортирует из host, views, widgets, features, entities.

---

## 3. Работа с VS Code API по методологии

| Где | Что |
|-----|-----|
| **shared/api** (webview) | Клиент к хосту: `postMessage`/`onMessage`, типы запросов/ответов. Не вызывает `acquireVsCodeApi()` из host — только в webview. |
| **host/api** | Реализация API для webview: `webviewApi.ts`, `handlers.ts`. Вызовы Git (shell, repo), диалоги VS Code. |
| **host/commands** | Регистрация и реализация команд (`registerCommand`). |
| **host/tree** | TreeDataProvider для Changed Files и Branch Diff. |
| **host/messageHandler** | Обработка сообщений от webview, вызов host/api и host/commands. |
| **host/panelProvider** | WebviewViewProvider, HTML, localResourceRoots, postMessage для `gitStateChanged`. |
| **shared/config** / **app/config** | Константы; при необходимости чтение `vscode.workspace.getConfiguration` только в host, значения передаются в webview через HTML data-атрибуты или postMessage. |

Упрощение webview:

- Один entry — `app/webview-main.tsx`: рендер App (ErrorBoundary, SelectedBranchProvider, GitViewPage).
- Все UI-компоненты, которые не привязаны к фиче/виджету, — в **shared/ui** (например, IconButton).
- Общение с VS Code только через **shared/api** (vscodeApi): запросы данных и команды через единый слой.

---

## 4. Сборка

- **esbuild**: entry `src/app/extension.ts` → `dist/extension.js`. Разрешать импорты из `host/`, `shared` (только не-.tsx), `types`, `app/config`.
- **Vite**: entry `src/app/webview-main.tsx` → `media/webview.js` + `media/webview.css`. Разрешать импорты из `app`, `views`, `widgets`, `features`, `entities`, `shared`. Исключать `host/` и `app/extension.ts`.

Алиасы (в tsconfig и vite):

- `@/app` → `src/app`
- `@/views` → `src/views`
- `@/widgets` → `src/widgets`
- `@/features` → `src/features`
- `@/entities` → `src/entities`
- `@/shared` → `src/shared`
- `@/host` → `src/host`
- `@/types` → `src/types`

---

## 5. Порядок миграции

### Сделано

- **host/** — весь код extension host перенесён в `src/host/`: api, commands, core, git, tree, statusBar, lifecycle, providers, diff, diffDocProvider, messageHandler, panelProvider, panelHtml. Точка входа расширения `src/extension.ts` импортирует только из `./host/` и `./constants`.
- Удалены старые дубликаты: `src/api`, `src/commands`, `src/core`, `src/git`, `src/tree`, `src/statusBar`, `src/lifecycle`, `src/providers`, `src/diff`, `src/diffDocProvider.ts`, `src/webview/panelProvider.ts`, `src/webview/panelHtml.ts`, `src/webview/messageHandler.ts`.

### Сделано (webview по FSD)

- **shared** — перенесён в `src/shared` (ui, api, lib, context, i18n, logger, styles.css).
- **entities** — branch, commit, tag в `src/entities` с сегментом `ui/`.
- **features** — в `src/features` (branch-list, tag-list, changed-files, commit-details-card, branches-pane-toolbar, commit-search-filters).
- **widgets** — в `src/widgets` (branches-pane, commit-graph, commit-history, commit-details-panel).
- **views** — `src/views/git-view` с `ui/GitViewPage.tsx` и публичным `index.ts`.
- **app** — `src/app/webview-main.tsx` (entry для Vite), `App.tsx`, `ErrorFallback.tsx`; импорты через алиас `@/`.
- **Vite**: entry = `src/app/webview-main.tsx`, `resolve.alias`: `@` → `src/`.
- **tsconfig**: для проверки типов расширения используется ограниченный `include` (extension, constants, types, host); для webview-слоёв типы не проверяются через tsc (сборка и проверка через Vite). Включён `skipLibCheck: true`.
- Папка **`src/webview`** удалена.

После изменений — сборка (`npm run compile`) и запуск расширения (F5).

---

## 6. Несколько webview (подключение в разных местах VS Code)

Компоненты (shared, entities, features, widgets) общие. Каждое **место** подключения webview (панель, сайдбар, custom editor и т.д.) задаётся своим **viewId** и одним реестром представлений.

**Как устроено:**
- **`app/views-registry.tsx`** — реестр `viewId → компонент`. Константы `VIEW_IDS`, по умолчанию `DEFAULT_VIEW_ID = "git-forge"`.
- **`app/webview-main.tsx`** — единая точка входа: читает `data-view` у `#root` и рендерит `<App viewId={…} />`.
- **`app/App.tsx`** — по `viewId` достаёт компонент из реестра и рендерит его через `<Dynamic>` (или fallback «Unknown view»).
- **Хост** при сборке HTML передаёт нужный viewId (в `panelHtml` — опция `viewId` в `getGitForgePanelHtml(..., { viewId: "…" })`). В разметке в `#root` проставляется `data-view="…"`.

**Добавить новый webview:**
1. В **`views/<name>/`** сделать слайс: `view.tsx` (обёртка с провайдерами при необходимости) и при необходимости `ui/`.
2. В **`app/views-registry.tsx`**: добавить `VIEW_IDS.NEW = "new-id"` и в `VIEW_REGISTRY` запись для этого id.
3. На **хосте**: при создании WebviewViewProvider/WebviewPanel для этого места вызывать общую функцию HTML с `{ viewId: "new-id" }` (тот же скрипт `webview.js`, другой `data-view`).

Один бандл `webview.js` обслуживает все viewId; при необходимости позже можно вынести отдельные представления в lazy-загрузку через `lazy()` в реестре.
