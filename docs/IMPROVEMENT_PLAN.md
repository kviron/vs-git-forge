# План улучшений vs-git-forge (актуальный)

Краткий план с учётом **текущего** состояния кода: что уже хорошо, что доработать по лучшим практикам VS Code/Cursor и безопасности. Детальный исторический план — в [REFACTORING_PLAN.md](./REFACTORING_PLAN.md).

---

## 1. Что уже в порядке

- **extension.ts** — только `activate`/`deactivate` и регистрация (~320 строк).
- Разделение по модулям: `api/`, `commands/`, `core/`, `webview/`, `tree/`, `git/`, `lifecycle/`, `statusBar/`.
- Единый **GitForgeApi** для запросов webview, **RepoManager** для репозиториев.
- **messageHandler.ts** — весь протокол webview в одном месте.
- Константы в **constants.ts**, типы в **types/**.
- **onDidDispose** в panelProvider очищает таймер и `currentWebviewView`.
- Сборка через esbuild, `main: "./dist/extension.js"`.

---

## 2. Рекомендуемые улучшения (по приоритету)

### 2.1 Активация и extensionKind

| Что | Зачем |
|-----|--------|
| **activationEvents** | Сейчас `[]` — расширение может активироваться позже. Добавить `onView:vs-git-forge.gitForgeView`, чтобы активация была только при открытии панели Git Forge (меньше влияние на старт VS Code). |
| **extensionKind** | Добавить `"extensionKind": ["workspace"]`, чтобы в Remote/Cursor расширение работало в workspace (доступ к git и файлам репо). |

### 2.2 Webview: CSP и nonce

В **panelHtml.ts** сейчас: `script-src ${cspSource}`. По [WebView best practices](https://code.visualstudio.com/api/extension-guides/webview#content-security-policy) предпочтительно использовать **nonce** для скриптов:

- Генерировать nonce (например, `crypto.randomBytes(16).toString('base64')`).
- В CSP: `script-src 'nonce-${nonce}'`.
- В теге script: `nonce="${nonce}"`.

Так снижается риск XSS при динамическом контенте. Сейчас скрипт подключается по URI из `localResourceRoots` — уже неплохо, но nonce усиливает политику.

### 2.3 Инкапсуляция в GitForgePanelViewProvider

- **lastContextMenuBranchRef** объявлен как `public`. Лучше сделать **private** и оставить только сеттер `setLastContextMenuBranchRef` для внешнего доступа — так не нарушается инкапсуляция.

### 2.4 Константы вместо магических чисел

Вынести в **constants.ts** (или в модуль, где используются):

- Дебаунс уведомления Git: **150** → `GIT_STATE_CHANGE_DEBOUNCE_MS`.
- Двойной клик: **400** → уже есть `BRANCH_DIFF_DOUBLE_CLICK_MS` и `DOUBLE_CLICK_MS` в разных файлах — завести одну константу, например `DOUBLE_CLICK_THRESHOLD_MS`, и использовать в `changedFileCommands` и в командах branch diff.
- Задержки для размера панели: **50**, **100** → `PANEL_VIEW_SIZE_STEP_DELAY_MS`, `PANEL_VIEW_SIZE_INITIAL_DELAY_MS`.

### 2.5 Команды Branch Diff: вынос и устранение дублирования

В **extension.ts** логика «закрыть вкладки с префиксом Branch Diff» повторяется в **branchDiffSwap** и **branchDiffOpenFile**. Рекомендации:

- Вынести в общую функцию, например `closeBranchDiffTabs(): Promise<void>` (в **commands/branchDiffCommands.ts** или в **extension.ts** в виде локальной функции).
- Перенести регистрацию команд `branchDiff*` в отдельный модуль **commands/branchDiffCommands.ts** по аналогии с **changedFileCommands.ts**: одна функция `registerBranchDiffCommands(context, deps)`. В **extension.ts** остаётся один вызов.

Так extension.ts станет короче, а логику branch diff будет проще тестировать и менять.

### 2.6 Message handler: регистр команд

**messageHandler.ts** содержит один большой `switch (msg.command)` на сотни строк. Для удобства поддержки и добавления новых команд:

- Ввести **регистр обработчиков**: `Map<string, (params, repo, deps) => Promise<void>>`.
- Каждая команда — отдельная функция (или файл в `webview/commandHandlers/`).
- В обработчике сообщений — один вызов по `msg.command` из регистра. Добавление команды = новая функция + одна строка регистрации.

Это не срочно, но сильно упростит рост числа команд.

### 2.7 Безопасность и валидация

- **git/shell** и вызовы, принимающие `commitHash`/`filePath` из webview: проверять формат (commit — hex, путь — без `..` и в пределах репо). Сейчас часть проверок есть не везде.
- **decodeDiffDocUri** (если есть): обернуть парсинг в try/catch и проверять структуру объекта после парса.
- Внешние запросы (аватарки GitHub/GitLab): по возможности задать таймаут (AbortController + setTimeout), чтобы не зависать при проблемах с сетью.

### 2.8 Логирование в catch

В коде есть тихие `catch` без логов. В плане из REFACTORING_PLAN уже было: добавлять хотя бы `log.debug('...', err)` в таких местах, чтобы при диагностике было проще искать причину.

---

## 3. Быстрые правки (можно сделать сразу)

1. **package.json**: добавить `activationEvents: ["onView:vs-git-forge.gitForgeView"]` и `"extensionKind": ["workspace"]`.
2. **panelProvider.ts**: сделать `lastContextMenuBranchRef` private.
3. **constants.ts**: добавить `GIT_STATE_CHANGE_DEBOUNCE_MS = 150`, `DOUBLE_CLICK_THRESHOLD_MS = 400`, при желании — задержки для panel view size; использовать их в extension.ts и messageHandler/panelProvider.
4. **extension.ts**: вынести закрытие вкладок Branch Diff в функцию `closeBranchDiffTabs()` и вызывать её в обоих местах.

---

## 4. Порядок работ (кратко)

1. Константы и инкапсуляция (2.3, 2.4, быстрые правки 1–3).
2. Вынос команд Branch Diff и общая функция закрытия вкладок (2.5, быстрая правка 4).
3. activationEvents и extensionKind (2.1).
4. CSP с nonce в panelHtml (2.2).
5. Регистр команд в messageHandler (2.6) — по желанию.
6. Валидация и таймауты (2.7, 2.8) — по мере касания кода.

После каждого шага полезно запускать расширение (F5) и проверять сценарии: панель, ветки, diff, branch diff, статус-бар.
