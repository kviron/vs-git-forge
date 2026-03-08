# План рефакторинга vs-git-forge (src)

План составлен с позиции сеньор фронтенд/расширения разработки: декомпозиция, читаемость, устранение дублирования, безопасность и обработка ошибок. Учтены [официальные практики VS Code](https://code.visualstudio.com/api) и [UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview).

---

## 1. Текущие проблемы

### 1.1 Монолитность
- **`extension.ts`** (~1800 строк) содержит:
  - Tree-провайдеры (GitForgeTreeProvider, ChangedFilesTreeProvider, ChangedFilesDecorationProvider)
  - Логику статус-бара (ветка)
  - Утилиты Git (remote, config, парсинг URL, аватарки GitHub/GitLab)
  - Обработчики API для webview (handleInitRepo, handleShowCreateBranchDialog, handleApiRequest и т.д.)
  - Огромный обработчик сообщений webview (десятки `msg.command` и `msg.type`)
  - Генерацию HTML панели
  - Регистрацию всех команд и контекстных меню
  - Типы для webview (WebviewBranch, WebviewCommit, WebviewChangedFile и т.д.)
  - Хелперы для diff (findFilePathInRevision, getCommitFile)
- Один файл трудно читать, тестировать и менять без риска поломать несвязанные части.

### 1.2 Дублирование кода

| Что дублируется | Где | Решение |
|-----------------|-----|---------|
| Маппинг локальных веток в WebviewBranch (cwd, headName, behind, ahead, upstream, сортировка) | `getLocalBranches` и `getBranches` (case в handleApiRequest) | Вынести в одну функцию `mapLocalBranchesToWebview(repo, branches)` |
| Построение списка remote-веток (byRemote, seenPerRemote, configuredRemotes) | `getRemoteBranches` и `getBranches` | Вынести в `mapRemoteBranchesToWebview(repo, branches)` |
| Извлечение короткого имени ветки из ref: `branchRef.includes("/") ? branchRef.replace(/^[^/]+\//, "") : branchRef` | Множество мест в обработчиках команд (checkoutBranch, deleteBranch, pushBranch, renameBranch и т.д.) | Утилита `getShortBranchName(ref: string): string` в одном месте |
| Хеш пустого дерева Git `4b825dc642cb6eb9a060e54bf8d69288fbee4904` | 4+ мест (getCommitChangedFiles, findFilePathInRevision, openChangedFileDiff, getContextFromNode) | Константа в общем модуле, например `gitConstants.ts` |
| Получение parent-коммита: `execSync(\`git rev-parse ${commit}^\`)` + fallback на emptyTree | getCommitChangedFiles, createPatchForFile, findFilePathInRevision, getContextFromNode, openChangedFileDiff | Функция `getParentCommit(cwd, commit): string` |
| Построение diff URI + заголовка для vscode.diff (leftUri, rightUri, title) | registerChangedFileContextCommand для ShowDiff, ShowDiffNewTab, CompareWithLocal, CompareBeforeWithLocal, ShowChangesToParents | Хелпер `openDiffEditor(repoRoot, file, fromHash, toHash, options?)` |
| Преобразование file.status в GitFileStatus (added/modified/deleted) | Во всех командах diff по ChangedFileContext | Функция `webviewStatusToGitFileStatus(status)` или использование одного места |

### 1.3 Отсутствие слоёв API / сервисов
- Git-операции размазаны по extension.ts: вызовы `execSync`/`execFileSync` и работа с Git API (repo.getBranches, repo.log) не выделены в отдельный слой.
- Нет единой точки для:
  - выполнения безопасных git-команд (только через аргументы, без конкатенации строк от пользователя),
  - получения данных для webview (ветки, коммиты, теги, изменённые файлы).

**Рекомендация:** ввести модули:
- **`git/shell.ts`** (или `git/gitRunner.ts`) — выполнение git-команд с валидацией аргументов, общие константы (emptyTree), `getParentCommit`, `getCommitFileContent`, парсинг `git diff --name-status`.
- **`git/remote.ts`** — getConfiguredRemotes, getRemoteOriginUrl, getGitConfigValue, parseRemoteUrl.
- **`api/avatars.ts`** или **`git/avatars.ts`** — fetchGitHubCommitAvatars, fetchGitLabAvatarsByEmail.
- **`api/webviewApi.ts`** (или разбить по доменам) — все методы handleApiRequest (getCurrentBranch, getLocalBranches, getCommits и т.д.) с вызовом git-слоя и маппингом в Webview*-типы.

### 1.4 Обработчик сообщений webview
- В `resolveWebviewView` один большой `onDidReceiveMessage` с вложенными `if (msg.type === ...)` и `if (msg.command === ...)` на сотни строк.
- Добавление новой команды требует правок в середине файла и риска сломать соседние ветки.

**Рекомендация:**
- Вынести обработку в отдельный модуль **`webview/messageHandler.ts`** (или **`webview/commands.ts`**).
- Реализовать **регистр команд**: `Map<string, (params, repo) => Promise<void>>` и вызов по `msg.command`. Так добавление команды = новая функция + одна строка регистрации.
- Обработку `request` (getCurrentBranch, getBranches и т.д.) оставить в handleApiRequest, но сам handleApiRequest перенести в api-слой и вызывать из messageHandler одной строкой.
- При регистрации `onDidReceiveMessage` сохранять возвращённый Disposable и при dispose провайдера (или в `webviewView.onDidDispose`) отменять таймер дебаунса и при необходимости отписываться от сообщений, чтобы не обращаться к уничтоженному webview.

### 1.5 Типы и константы
- Интерфейсы WebviewBranch, WebviewTag, WebviewCommit, WebviewChangedFile, ChangedFileTreeNode объявлены в extension.ts.
- Константы GitStatus (INDEX_ADDED, MODIFIED и т.д.), GIT_STATUS_THEME_IDS, SIDEBAR_WIDTH_KEY разбросаны по файлу.

**Рекомендация:**
- **`types/webview.ts`** — все Webview*-типы и ChangedFileTreeNode.
- **`types/git.ts`** или рядом с git-слоем — GitStatus, пустые деревья, лимиты (maxBuffer и т.д.).
- Константы UI (SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH, MIN/MAX) — в **`constants.ts`** или в модуле панели.

### 1.6 Декомпозиция по файлам
Предлагаемая структура (без смены поведения, только перенос). Один entry point — `extension.ts` — удобен для [bundling](https://code.visualstudio.com/api/working-with-extensions/bundling-extension): сборщик подхватывает все импорты из него и собирает один `dist/extension.js`.

```
src/
  extension.ts              # только activate/deactivate, регистрация провайдеров и команд
  constants.ts              # emptyTreeHash, SIDEBAR_*, MIN/MAX width
  types/
    webview.ts               # WebviewBranch, WebviewTag, WebviewCommit, WebviewChangedFile, ChangedFileTreeNode
    git.ts                   # GitStatus, константы статусов
  git/
    shell.ts                 # runGit, getParentCommit, parseDiffNameStatus, getCommitFileContent, findFilePathInRevision
    remote.ts                # getConfiguredRemotes, getRemoteOriginUrl, getGitConfigValue, parseRemoteUrl
    avatars.ts               # fetchGitHubCommitAvatars, fetchGitLabAvatarsByEmail
  api/
    handlers.ts              # handleInitRepo, handleShowCreateBranchDialog, handlePullBranch, handleShowCreateTagDialog
    webviewApi.ts            # handleApiRequest + все case (getBranches, getCommits, getChangedFiles и т.д.)
  webview/
    messageHandler.ts        # регистр команд + onDidReceiveMessage логика, вызов handleApiRequest
    panelHtml.ts             # getGitForgePanelHtml
  tree/
    changedFilesTree.ts      # ChangedFilesTreeProvider, ChangedFilesDecorationProvider
  statusBar/
    branchStatusBar.ts       # updateBranchStatusBar, getBranchFromGitHead, initBranchStatusBar, initBranchStatusBarFromApi
  providers/
    gitForgeTreeProvider.ts   # GitForgeTreeProvider (если остаётся)
  commands/
    changedFileCommands.ts   # registerChangedFileContextCommand и все команды для дерева Changed Files
    paletteCommands.ts       # openGitForge, createBranch и т.д.
  diff/
    getCommitFile.ts         # getCommitFile (использует shell.getCommitFileContent, findFilePathInRevision)
```

Границы можно менять (например, avatars оставить в api, если они нужны только для getCommits).

---

## 2. Git API как полноценный клиент: контракт для webview и события

Расширение выступает как полноценный Git-клиент: все операции с репозиторием должны проходить через единый слой API, а webview (и при необходимости другие части расширения) — только вызывать методы этого API и подписываться на события изменений. Ниже — детальное описание того, что ввести при рефакторинге.

### 2.1 Назначение слоя Git API

- **Один контракт:** вся работа с Git (чтение данных, выполнение команд, доступ к remote/config) инкапсулирована в одном модуле/наборе модулей. Extension и webview не вызывают `execSync`/`repo.getBranches` напрямую, а только методы этого API.
- **Использование из webview:** webview не имеет доступа к Node.js и к VS Code API; все вызовы идут через `postMessage`. Слой API должен быть вызываемым по имени метода и параметрам (как сейчас `handleApiRequest(method, params, repo)`), с единым форматом ответа `{ data?, error? }`.
- **Безопасность и валидация:** валидация аргументов (commit hash, пути файлов, имена веток/тегов) выполняется внутри API; выполнение git — только через безопасный runner (список аргументов, без подстановки произвольных строк).

### 2.2 Методы API (чтение данных) — для вызова из webview

Эти методы возвращают данные для отображения в UI. Репозиторий задаётся контекстом (текущий репо из RepoManager); при отсутствии репо методы возвращают пустые данные или ошибку.

| Метод | Параметры | Возвращаемые данные | Источник данных (сейчас) |
|-------|-----------|----------------------|--------------------------|
| `getRepositoryRoot` | — | `{ root: string \| null }` | `repo.rootUri.fsPath` или workspace folders |
| `getCurrentBranch` | — | `string \| null` (короткое имя ветки) | `repo.state.HEAD?.name` или `.git/HEAD` |
| `getLocalBranches` | — | `WebviewBranch[]` | `repo.getBranches({ remote: false })` + маппинг (upstream, behind, ahead) |
| `getRemoteBranches` | — | `WebviewBranch[]` (дерево по remote) | `repo.getBranches({ remote: true })` + группировка по remote |
| `getBranches` | — | `{ currentBranch, local, remote, tags }` | объединение getLocalBranches, getRemoteBranches, getTags, getCurrentBranch |
| `getTags` | — | `WebviewTag[]` | `repo.getRefs({ pattern: 'refs/tags/*' })` + маппинг |
| `getCommits` | `ref?: string`, `maxEntries?: number` | `WebviewCommit[]` | `repo.log({ refNames: [ref], maxEntries })` + аватарки (GitHub/GitLab) + refs по коммиту |
| `getChangedFiles` | — | `{ files: WebviewChangedFile[] }` (working tree + index) | `repo.state.indexChanges` + `repo.state.workingTreeChanges` |
| `getCommitChangedFiles` | `commitHash: string` | `{ files: WebviewChangedFile[] }` | `git diff --name-status --find-renames` между parent и commit |
| (опционально) `getRemoteOriginUrl` | — | `string \| undefined` | git config remote.origin.url |
| (опционально) `getConfiguredRemotes` | — | `string[]` | `git remote` |

Типы `WebviewBranch`, `WebviewTag`, `WebviewCommit`, `WebviewChangedFile` остаются контрактом между API и webview; они объявляются в `types/webview.ts`.

### 2.3 Методы API (действия / команды) — для вызова из webview

Это операции, меняющие состояние репозитория или открывающие диалоги. Webview вызывает их через сообщения типа `command`; результат пользователю — через уведомления (showInformationMessage/ErrorMessage) и последующее событие `gitStateChanged`, по которому webview перезапрашивает данные.

| Команда / метод | Параметры | Действие |
|------------------|-----------|----------|
| `initRepo` | `rootUri?: string` | Инициализация репо (git init); может не требовать текущего репо |
| `showCreateBranchDialog` | `sourceCommitHash?`, `sourceBranchName?` | Диалог имени ветки + выбор «создать и переключиться» → git branch [+ checkout] |
| `showCreateTagDialog` | `commitHash` | Диалог имени тега → git tag |
| `pullBranch` | `branchName` | checkout при необходимости → git pull → checkout обратно |
| `checkoutBranch` | `branchRef` (short или remote/name) | git checkout branch |
| `checkoutTag` | `tagName` | git checkout tag |
| `deleteBranch` | `branchRef` | git branch -d (при необходимости -D после подтверждения) |
| `deleteRemoteBranch` | `branchRef`, `remote?` | git push remote --delete branch |
| `renameBranch` | `branchRef` | Диалог нового имени → git branch -m |
| `pushBranch` | `branchRef` | git push origin branch (без терминала, см. п. 2.7) |
| `mergeTagIntoCurrent` | `tagName` | git merge tag |
| `mergeInto` | `sourceBranchRef`, `targetBranchRef` | checkout target → git merge source |
| `pushTag` | `tagName` | git push origin tag (без терминала, см. п. 2.7) |
| `deleteTag` | `tagName` | git tag -d |
| `checkoutAndRebase` | `branchRef`, `ontoBranchRef` | checkout branch → git rebase onto |
| `rebaseOnto` | `branchToRebaseRef`, `ontoBranchRef` | аналогично |
| `compareBranches` | `branchRef`, `otherBranchRef` | git diff (без терминала, вывод в diff/редактор, см. п. 2.7) |
| `showDiffWithWorkingTree` | `branchRef` | git diff branch (без терминала, см. п. 2.7) |
| `editCommitMessage` | `commitHash`, `message` | Только HEAD; диалог → git commit --amend -m |
| `viewDiff` / `viewFileAtRevision` / `openWorkingFile` / `revertWorkingFile` / `getFileFromRevision` / `createPatchForFile` / `cherryPickFile` / `fileHistoryUpToCommit` | (разные params) | Открытие diff, редактора, отмена файла, патч, cherry-pick, история — как сейчас |

Часть из них (createBranch, createTag, renameBranch, editCommitMessage) открывают нативные диалоги VS Code (InputBox, QuickPick); остальные выполняют git через слой API **без открытия терминала** (pull, fetch, sync, push, merge, diff и т.д. — см. п. 2.7). После успешного изменения состояния вызывается общее уведомление для webview (см. события).

### 2.4 Протокол обмена webview ↔ extension

- **Запрос данных (request/response):**  
  Webview отправляет: `{ type: "request", requestId: string, method: string, params?: object }`.  
  Extension вызывает метод API по `method` с `params` и текущим репо, затем отвечает: `{ type: "response", requestId, data?: unknown, error?: string }`.  
  Список `method` совпадает с именами методов чтения из п. 2.2 (getCurrentBranch, getBranches, getCommits и т.д.).

- **Выполнение команд (command):**  
  Webview отправляет: `{ type: "command", command: string, params?: object }`.  
  Extension вызывает зарегистрированный обработчик команды по имени; ответ с данными не обязателен (достаточно показать уведомление и отправить событие `gitStateChanged`).

- **События от extension к webview:**  
  - `{ type: "gitStateChanged" }` — произошло любое изменение, связанное с Git (HEAD, ветки, коммиты, индекс, working tree, появление репо). Webview при получении может перезапросить нужные методы (getBranches, getCommits, getCurrentBranch, getChangedFiles и т.д.) и обновить UI.  
  - При желании в будущем можно добавить более узкие события, например `{ type: "branchChanged" }`, `{ type: "workingTreeChanged" }`, чтобы webview обновлял только часть экрана.

- **Контекстное меню (раздел 3 плана):**  
  Webview отправляет `setContextMenu` (section + контекст) перед показом меню; extension выставляет контекстные ключи (`setContext`) и сохраняет выбранный элемент для команд. Опционально — `clearContextMenu` для сброса. Подробно см. раздел 3.
- **Остальные сообщения:**  
  `webviewLog`, `sidebarWidth`, `selectedCommitChanged` — обработку вынести в общий message handler.

### 2.5 Источники событий «состояние Git изменилось»

Чтобы webview и статус-бар всегда были актуальны, extension должен подписываться на все источники изменений и по любому из них вызывать одно (или несколько) уведомлений для webview. При рефакторинге эти подписки стоит собрать в одном месте (например, модуль `git/events.ts` или внутри `GitForgePanelViewProvider` с явным перечислением).

| Источник | Что отслеживается | Как подписаться (сейчас) |
|----------|-------------------|---------------------------|
| VS Code Git API | Изменение состояния репо (HEAD, index, working tree, refs) | `repo.state.onDidChange(callback)` для каждого репо |
| VS Code Git API | Появление нового репо в workspace | `gitApi.onDidOpenRepository(repo => repo.state.onDidChange(callback))` |
| Файловая система | Изменение текущей ветки (checkout вне VS Code, git init) | `FileSystemWatcher("**/.git/HEAD")` → onDidCreate, onDidChange |
| Файловая система | Изменение refs (новые коммиты, ветки, теги через терминал) | `FileSystemWatcher("**/.git/refs/**")` → onDidChange, onDidCreate, onDidDelete |

Общий callback при любом из этих событий: дебаунс (например 150 ms), затем вызов `notifyGitStateChanged()` — т.е. отправка в webview `{ type: "gitStateChanged" }`. Таймер дебаунса нужно очищать в `onDidDispose` webview, чтобы не обращаться к уничтоженному webview.

### 2.6 Структура модулей для Git API и доступа из webview

- **`api/gitForgeApi.ts`** (или `api/webviewApi.ts`): фасад, доступный из message handler. Содержит:
  - вызов методов чтения (getCurrentBranch, getBranches, getCommits, getChangedFiles, getCommitChangedFiles, getRepositoryRoot, getTags и т.д.) — внутри делегируют в git-слой и маппинг в Webview*-типы;
  - вызов действий (initRepo, pullBranch, showCreateBranchDialog и т.д.) — либо сами выполняют git/диалоги, либо делегируют в `commands` (handlers).
- **`webview/messageHandler.ts`**: по `msg.type === "request"` вызывает `gitForgeApi.request(method, params, repo)` и отправляет в webview ответ с `requestId`; по `msg.type === "command"` вызывает зарегистрированный обработчик команды. Подписки на события Git (п. 2.5) при регистрации провайдера подписываются на RepoManager + Git API + FileSystemWatcher и вызывают `notifyGitStateChanged()`.
- **Git-слой** (`git/shell.ts`, `git/remote.ts`, `git/avatars.ts`): используется только внутри API (и DiffDocProvider); webview с ним не общается напрямую.

В итоге webview имеет один контракт: «запрос по method + params» и «событие gitStateChanged»; все детали реализации (VS Code Git API vs execSync, маппинг, валидация) скрыты внутри API и git-слоя.

### 2.7 Выполнение Git-команд без открытия терминала (как в Source Control)

Операции **pull**, **sync**, **fetch**, **push** и другие действия, меняющие состояние репозитория, должны выполняться **так же, как в базовом функционале VS Code/Cursor Source Control**: без открытия встроенной консоли (Integrated Terminal), «тихо» в фоне.

- **Текущая проблема:** в плане и в коде часть команд (например, `pushBranch`, `pushTag`, `compareBranches`, `showDiffWithWorkingTree`) помечена как «Терминал: git push / git diff» — то есть сейчас может использоваться запуск в терминале. Это создаёт шум в панели Terminal и отличается от поведения нативного Source Control.
- **Целевое поведение:**
  - Все такие операции выполняются через **единый слой Git API** (git/shell или VS Code Git API, где применимо): вызов программ/методов без создания терминального процесса, видимого пользователю.
  - Пользователь запускает действие (кнопка в webview, пункт контекстного меню, команда палитры) — расширение выполняет `git pull` / `git fetch` / `git push` / sync и т.д. в фоне.
  - О результате пользователь узнаёт через **уведомления** (showInformationMessage / showErrorMessage) и/или автоматическое обновление UI по событию `gitStateChanged`, без появления новой вкладки в Terminal.
- **Экшены в расширении:** кнопки и пункты меню в панели расширения (Pull, Sync, Fetch, Push и т.д.) должны быть реализованы как вызовы этого же API — то есть как обычные команды расширения, которые внутри вызывают git-слой и не открывают консоль. Поведение тогда будет согласовано с нативным Source Control и предсказуемо для пользователя.

При рефакторинге нужно: (1) убрать использование `createTerminal` / открытия терминала для pull, fetch, sync, push и аналогичных операций; (2) выполнять их через `git/shell.ts` (или `execSync`/spawn в рамках безопасного runner) либо через [Git API VS Code](https://code.visualstudio.com/api/extension-api/vscode#Git) там, где он предоставляет нужные операции; (3) все экшены в UI расширения вызывают только эти методы API, без прямого доступа к терминалу.

---

## 3. Context Menu API для webview

Чтобы контекстное меню в webview (правый клик по ветке, коммиту, тегу и т.д.) было единообразным, управляемым и поддерживало иконки, быстрые клавиши и включение/выключение пунктов, при рефакторинге стоит ввести формальный **Context Menu API**: описание пунктов меню в одном месте, использование контекстных ключей VS Code для видимости и доступности, протокол сообщений webview ↔ extension. Ниже — детали.

### 3.1 Как в VS Code устроены контекстные меню (кратко)

- **Меню задаются статически** в `package.json` в `contributes.menus`. Для webview используется пункт `"webview/context"`: пункты меню показываются при правом клике внутри webview с заданным `webviewId`.
- **Каждый пункт** привязан к команде (`command`), может иметь **иконку** (`"icon": "$(codicon-name)"` в `contributes.commands` или в записи меню), **группу и порядок** (`group`, `order`).
- **Видимость и доступность** управляются [when-условиями](https://code.visualstudio.com/api/references/when-clause-contexts): запись в меню содержит `"when": "…"`. Если условие ложно, пункт не показывается. Расширение может выставлять свои контекстные ключи через `vscode.commands.executeCommand('setContext', key, value)` и использовать их в `when`.
- **Быстрые клавиши** задаются в `contributes.keybindings`: `command`, `key`, `when`. Одна и та же команда может быть и в меню, и по клавишам; `when` для keybinding определяет, когда комбинация активна (в т.ч. в фокусе webview).

Итог: добавить/убрать пункты «на лету» из нативного меню нельзя, но можно **включать и отключать** уже объявленные пункты, выставляя контекстные ключи из extension в момент, когда webview сообщает контекст (например, «открыли меню на ветке» или «выбрана remote-ветка»).

### 3.2 Контракт Context Menu API: что описывать

Единый реестр пунктов контекстного меню (например, в коде в виде массива/объекта или в отдельном конфиге), где для каждого пункта задано:

| Поле | Описание | Где используется |
|------|----------|-------------------|
| **id** | Идентификатор команды (например `vs-git-forge.checkoutBranchFromContext`) | `contributes.commands`, `menus`, keybindings |
| **title** | Текст пункта (или ключ l10n `%command.xxx%`) | `commands[].title` |
| **icon** | Иконка [Codicon](https://code.visualstudio.com/api/references/icons-in-labels) в виде `$(icon-name)` (например `$(git-branch)`, `$(trash)`) | `commands[].icon` или запись в `menus` |
| **keybinding** | Опциональная комбинация клавиш (например `"ctrl+shift+g c"`) | `contributes.keybindings` |
| **when** | Условие видимости/доступности: контекстные ключи (например `webviewSection == 'branch-list-item' && gitForge.branchIsLocal == true`) | `menus[].when`, `keybindings[].when` |
| **group** | Группа меню (`navigation`, `1_modification` и т.д.) для группировки и разделителей | `menus[].group` |
| **order** | Порядок внутри группы (число или строка) | `menus[].order` |
| **section** | Контекст webview, в котором пункт имеет смысл (например `branch-list-item`, `tag-list-item`, `commit-list-item`) | Используется в `when` через контекстный ключ `webviewSection` |

На основе этого реестра можно вручную или скриптом держать в актуальном состоянии `package.json`: блоки `commands`, `menus.webview/context`, `menus.view/item/context` (для дерева Changed Files), `keybindings`.

### 3.3 Протокол webview → extension: контекст меню

Чтобы нативное меню показывало только подходящие пункты и команды получали данные (какая ветка/тег/коммит выбраны), webview при открытии контекстного меню (или при правом клике) отправляет сообщение с контекстом. Extension выставляет контекстные ключи и при необходимости сохраняет «текущий элемент» для команд.

**Сообщения от webview:**

1. **Установка контекста перед показом меню** (сейчас частично есть как `setContextMenuBranch`):
   - `{ type: "setContextMenu", section: string, ...context }`
   - `section` — тип элемента: `"branch-list-item"`, `"tag-list-item"`, `"commit-list-item"`, `"changed-file"` и т.д.
   - Дополнительные поля в зависимости от `section`, например:
     - для ветки: `branchRef`, `isLocal`, `isCurrent`, `isRemote`;
     - для тега: `tagName`, `commitHash`;
     - для коммита: `commitHash`, `isHead`;
     - для файла в списке изменений: `filePath`, `status`, `commitHash`.
   - Extension при получении вызывает `setContext('gitForge.webviewSection', section)` и, при необходимости, другие ключи (`gitForge.branchRef`, `gitForge.branchIsLocal` и т.д.), а также сохраняет контекст (например `lastContextMenuBranchRef`) для выполнения команды. Тогда в `package.json` в `when` используются эти ключи, и пункты меню/клавиши включаются или отключаются в зависимости от контекста.

2. **Сброс контекста** после закрытия меню или потери фокуса (опционально):
   - `{ type: "clearContextMenu" }` — extension сбрасывает контекстные ключи и сохранённый элемент, чтобы пункты не светились в неподходящем месте.

Имена контекстных ключей лучше завести в константах (например `CONTEXT_WEBVIEW_SECTION = 'gitForge.webviewSection'`), чтобы `when` в package.json и код extension совпадали.

### 3.4 Включение и отключение пунктов

- **Включить/выключить пункт** = изменить результат его `when` в меню и в keybindings. Так как `when` в package.json статичен, в нём нужно ссылаться на контекстные ключи, которые extension выставляет из webview:
  - Пример: пункт «Удалить ветку» показывать только для локальной не текущей ветки: `"when": "webviewId == 'vs-git-forge.gitForgeView' && gitForge.webviewSection == 'branch-list-item' && gitForge.branchIsLocal == true && gitForge.branchIsCurrent != true"`.
  - Пример: «Checkout» для ветки: `"when": "gitForge.webviewSection == 'branch-list-item'"` (всегда для ветки).
- Extension при `setContextMenu` выставляет `gitForge.branchIsLocal`, `gitForge.branchIsCurrent` и т.д. из переданного контекста; при `clearContextMenu` может обнулять их или выставлять пустую секцию.

Таким образом, webview не определяет состав меню, а только сообщает «где и на чём открыли меню»; состав и видимость пунктов задаются в package.json через `when` и контекстные ключи.

### 3.5 Иконки в пунктах меню

- В `contributes.commands` у каждой команды указать `"icon": "$(codicon-name)"`. Список [Codicon](https://code.visualstudio.com/api/references/icons-in-labels#icon-listing): `git-branch`, `trash`, `checkout`, `cloud-download`, `edit`, `git-compare` и т.д.
- Иконка автоматически отображается в нативном контекстном меню VS Code рядом с названием команды. В записи в `menus` иконку можно переопределить: `"icon": "$(icon-name)"`.
- Для единообразия в реестре Context Menu API (п. 3.2) у каждого пункта задавать поле `icon`; при синхронизации с package.json подставлять его в `commands` и при необходимости в `menus`.

### 3.6 Быстрые клавиши

- В `contributes.keybindings` добавить запись для команды: `"command": "vs-git-forge.checkoutBranchFromContext"`, `"key": "ctrl+enter"` (или другая комбинация), `"when": "webviewId == 'vs-git-forge.gitForgeView' && gitForge.webviewSection == 'branch-list-item'"`.
- Тогда при фокусе в webview и контексте «ветка» эта комбинация будет вызывать команду. Без подходящего `when` клавиша не срабатывает — тем самым реализуется «включение/выключение» горячей клавиши в зависимости от контекста.
- В реестре Context Menu API поле `keybinding` (и при необходимости отдельное `keybindingWhen`) можно использовать для генерации или ручного ведения записей в `keybindings`.

### 3.7 Структура модулей

- **`contextMenu/registry.ts`** (или `contextMenu/definitions.ts`): реестр пунктов меню — массив/объект с полями из п. 3.2. Отсюда при желании можно генерировать фрагменты package.json (скриптом или вручную).
- **`contextMenu/setContext.ts`** (или внутри message handler): при получении `setContextMenu` / `clearContextMenu` вызывать `vscode.commands.executeCommand('setContext', key, value)` для всех ключей, используемых в `when`, и обновлять сохранённый контекст (lastContextMenuBranchRef и т.д.) для вызова команд.
- **Message handler**: при `msg.type === "setContextMenu"` вызывать setContext из контекстного модуля; при `clearContextMenu` — сброс. Регистрация команд контекстного меню остаётся в extension (registerCommand), реализация команд использует сохранённый контекст и вызывает Git API.

В итоге webview получает предсказуемый контракт: отправил `setContextMenu` с секцией и данными — нативное меню и горячие клавиши показывают только разрешённые пункты; иконки и клавиши задаются в одном месте (реестр + package.json) и согласованы с поведением включения/выключения через контекстные ключи.

---

## 4. Безопасность и уязвимости

### 4.1 Выполнение Git-команд
- **Сейчас:** почти везде используется `JSON.stringify(...)` для подстановки в команду — это защищает от инъекций в аргументах.
- **Риски:**
  - В `getCommitFile`: `commit + ":" + pathInRev` — pathInRev приходит из вывода `git diff --name-status`. Теоретически вывод можно подделать только при подмене репозитория, но надёжнее передавать путь и ревизию отдельно в безопасный runner.
  - Нет явной валидации формата commit hash (например, только [a-f0-9]+) и пути файла (запрет `..`, абсолютных путей вне репо) перед вызовом git.
- **Рекомендации:**
  - Ввести **единый GitRunner** (или набор функций в `git/shell.ts`), который принимает только отдельные аргументы и сам собирает команду через список аргументов (например, `spawnSync('git', ['show', rev])` с rev, полученным из своей валидации).
  - Валидировать: commit — hex-строка фиксированной длины или 7–40 символов; filePath — относительный путь без `..` и без выхода за корень репо.
  - Для путей: нормализация через `path.relative(repoRoot, path.join(repoRoot, filePath))` и проверка, что результат не начинается с `..`.

### 4.2 Webview и CSP
- CSP в getGitForgePanelHtml уже ограничивает script-src, connect-src и т.д. — хорошо.
- Сообщения из webview (msg.params) приходят как произвольные объекты. Все использования `p.branchRef`, `p.filePath`, `p.commitHash` и т.д. должны трактовать значения как ненадёжные: проверка типов (typeof === 'string'), trim, и только потом подстановка в команды через единый слой с валидацией.
- **Lifecycle ([Webview API](https://code.visualstudio.com/api/extension-guides/webview)):** после закрытия панели webview уничтожается; любые таймеры/интервалы, которые обращаются к webview (например, `notifyGitStateChangedTimer` с `postMessage`), нужно отменять в `onDidDispose`, иначе будет исключение при следующем срабатывании.

### 4.3 decodeDiffDocUri
- `decodeDiffDocUri` делает `JSON.parse(Buffer.from(uri.query, "base64").toString("utf8"))`. Если в query подставлены некорректные данные, возможны исключения или неожиданная структура.
- **Рекомендация:** после парса проверять наличие и тип полей (repo, commit, filePath — строки, exists — boolean), и при несоответствии возвращать объект с `exists: false` вместо падения.

### 4.4 Внешние запросы (GitHub/GitLab API)
- fetch к api.github.com и GitLab без таймаута — при зависании сети запрос может висеть долго.
- **Рекомендация:** использовать AbortController + setTimeout для таймаута (например, 10–15 с) и обрабатывать отмену в catch.

---

## 5. Обработка ошибок

### 5.1 Тихое проглатывание
- В коде много мест с `catch { return []; }` или `catch { // ignore }` без логирования (getBranchFromGitHead, getConfiguredRemotes, getGitConfigValue, parseRemoteUrl, fetchGitHubCommitAvatars, fetchGitLabAvatarsByEmail, getTagRefs и т.д.).
- **Рекомендация:** как минимум логировать на уровне debug: `log.debug('getBranchFromGitHead failed', err)`, чтобы при диагностике можно было понять причину.

### 5.2 Единый формат ответа API
- handleApiRequest возвращает `{ data?: unknown; error?: string }` — хорошо.
- Все handler'ы (handleInitRepo, handleShowCreateBranchDialog и т.д.) при исключении делают log.errorException и возвращают error — единообразно, оставить так при рефакторинге.

### 5.3 DiffDocProvider
- provideTextDocumentContent при ошибке getCommitFile логирует и показывает сообщение пользователю — ок. Имеет смысл при рефакторинге убедиться, что все пути ошибок ведут в один и тот же способ логирования и уведомления.

---

## 6. Читаемость и поддерживаемость

### 6.1 Именование
- Глобальная переменная `branchStatusBarSubscribed` в extension.ts — при переносе логики статус-бара в statusBar/branchStatusBar.ts хранить это состояние внутри модуля или класса, не в глобальной переменной.
- `runActivate` — имя неочевидное; можно переименовать в `registerExtensionFeatures` или оставить только содержимое в activate, если файл станет короче.

### 6.2 Магические числа и строки
- maxBuffer: 2 * 1024 * 1024, 10 * 1024 * 1024 — вынести в константы (например, GIT_DIFF_MAX_BUFFER, GIT_SHOW_MAX_BUFFER).
- Строка "1 file" / "files" в описании папки дерева — вынести в l10n, если планируется локализация.

### 6.3 Длина функций
- handleApiRequest (switch по method) — очень длинная. После выноса маппингов веток/тегов/коммитов в отдельные функции каждый case станет короче. При желании можно разбить на отдельные функции по методам: handleGetBranches, handleGetCommits и т.д., а в switch только вызывать их.

---

## 7. Лучшие практики VS Code / Cursor (официальная документация)

Ниже — пункты из [Extension API](https://code.visualstudio.com/api), [Webview API](https://code.visualstudio.com/api/extension-guides/webview), [Bundling](https://code.visualstudio.com/api/working-with-extensions/bundling-extension), [UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview) и [Testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension), которые стоит отразить в рефакторинге.

### 7.1 Bundling (сборка в один файл)
- **Рекомендация VS Code:** расширения лучше собирать в один бандл (esbuild или webpack). Загрузка одного файла быстрее множества мелких; только бандл работает в VS Code for Web (github.dev, vscode.dev).
- **Действия:** после декомпозиции на много файлов добавить шаг сборки: например, esbuild с `entryPoints: ['src/extension.ts']`, `bundle: true`, `external: ['vscode']`, `outfile: 'dist/extension.js'`. Типы проверять отдельно: `tsc --noEmit`. В `package.json`: `main` указывать на `./dist/extension.js`, в `vscode:prepublish` вызывать сборку; в `.vscodeignore` исключить `src/`, `node_modules/`, оставив только `dist/`.

### 7.2 Activation Events
- С 1.74 команды и вкладки из `contributes` автоматически активируют расширение — явно перечислять `onCommand:*` в `activationEvents` не обязательно.
- Для Webview View можно использовать `onView:vs-git-forge.gitForgeView`, чтобы расширение активировалось только при открытии панели, а не при старте VS Code — меньше влияние на запуск.

### 7.3 Disposable и очистка ресурсов
- Все объекты, возвращаемые API (registerCommand, onDidChange, FileSystemWatcher, EventEmitter и т.д.), должны быть добавлены в `context.subscriptions`, иначе при деактивации/перезагрузке расширения возможны утечки и лишние вызовы.
- **Webview:** при закрытии панели вызывается `onDidDispose`. В текущем коде есть таймер `notifyGitStateChangedTimer` — его нужно отменять в `onDidDispose` webview (или при dispose провайдера), иначе после закрытия панели таймер может снова обратиться к уже уничтоженному webview и вызвать исключение (как в [документации](https://code.visualstudio.com/api/extension-guides/webview): setInterval после закрытия панели бросает).
- При рефакторинге: явно собирать все Disposable в одном месте (например, класс-регистратор команд возвращает `Disposable` и его пушат в `context.subscriptions`).

### 7.4 Webview: когда использовать и как
- **Использовать только при необходимости:** нативные API (TreeView, QuickPick, InputBox и т.д.) предпочтительнее; webview тяжёлый и изолированный.
- **Lifecycle:** расширение должно хранить ссылку на webview; при потере ссылки доступ к нему не восстановить. При закрытии — очистка таймеров и подписок в `onDidDispose`.
- **localResourceRoots:** задавать минимально необходимый набор (например, только `context.extensionUri` или подпапка `media`), не разрешать лишние каталоги.
- **Темизация:** контент webview должен поддерживать `vscode-light`, `vscode-dark`, `vscode-high-contrast` (класс на `body`) и [Theme Color](https://code.visualstudio.com/api/references/theme-color) через CSS-переменные `var(--vscode-*-*)`. Проверить отображение в high-contrast для доступности.
- **Не открывать webview при обновлении расширения** — лучше показать уведомление (Notification); не открывать на каждое окно без контекста.

### 7.5 Тестирование
- Официальный подход: интеграционные тесты в Extension Development Host через `@vscode/test-electron` и `@vscode/test-cli`; unit-тесты без VS Code требуют обёрток над `vscode` (инъекция зависимостей) или моков.
- После рефакторинга имеет смысл добавить тесты для чистых модулей (git/shell, маппинги веток, валидация) без полного API; для сценариев с командами и webview — интеграционные прогоны.
- В тестах использовать `ensureNoDisposablesAreLeakedInTestSuite()` (или аналог), чтобы проверять, что все созданные Disposable корректно очищаются и нет утечек.

### 7.6 Extension entry (activate / deactivate)
- В `extension.ts` экспортировать только `activate` и `deactivate`. Вся логика — в подключаемых модулях. В `deactivate` при необходимости вызывать явную очистку (как сейчас `runUninstallLifecycle`); для большинства ресурсов достаточно `context.subscriptions`.

### 7.7 extensionKind (для Cursor / Remote)
- Если расширение должно выполняться в окружении workspace (доступ к git, файлам репо), в `package.json` можно указать `"extensionKind": ["workspace"]` для сценариев Cursor/VS Code Remote, чтобы расширение запускалось на стороне workspace, а не UI.

---

## 8. Порядок работ (приоритеты)

1. **Константы и типы** — вынести в `constants.ts`, `types/webview.ts`, `types/git.ts`. Минимальный риск, сразу уменьшится шум в extension.ts.
2. **Git-слой** — `git/shell.ts` (emptyTree, getParentCommit, безопасный runGit/runGitSync), затем перенос findFilePathInRevision и getCommitFile. После этого заменить дубликаты emptyTree и rev-parse в extension.ts на вызовы из shell.
3. **Утилиты веток/remote** — `git/remote.ts`, вынос getShortBranchName, mapLocalBranchesToWebview, mapRemoteBranchesToWebview. Подключить в handleApiRequest.
4. **Git API для webview (раздел 2 плана)** — оформить единый фасад `api/gitForgeApi.ts`: методы чтения (getCurrentBranch, getBranches, getCommits, getChangedFiles, getCommitChangedFiles, getRepositoryRoot, getTags и т.д.) и вызовы команд (initRepo, showCreateBranchDialog, pullBranch, checkout и т.д.). Все вызовы из message handler идут только через этот API. Подписки на события Git (repo.state.onDidChange, onDidOpenRepository, watchers на .git/HEAD и .git/refs/**) собрать в одном месте с дебаунсом и вызовом notifyGitStateChanged.
5. **API-обработчики** — вынести handleInitRepo, handleShowCreateBranchDialog, handleShowCreateTagDialog, handlePullBranch в api/handlers.ts; handleApiRequest и все case делегируют в gitForgeApi. extension.ts только импортирует и вызывает.
6. **Webview message handler** — регистр команд, перенос обработки сообщений в webview/messageHandler.ts. По `request` вызывать gitForgeApi.request(method, params, repo) и отправлять response; по `command` — вызывать зарегистрированный обработчик; по `setContextMenu` / `clearContextMenu` — выставлять/сбрасывать контекстные ключи (раздел 3). В extension в resolveWebviewView остаётся только создание провайдера и вызов handler.register(webview, repoManager, ...).
7. **Context Menu API (раздел 3)** — реестр пунктов меню (id, title, icon, keybinding, when, group, order); константы контекстных ключей; обработка setContextMenu/clearContextMenu с вызовом setContext; при необходимости — keybindings в package.json с when по контексту. Webview при правом клике отправляет setContextMenu с section и данными.
8. **Tree и статус-бар** — вынос ChangedFilesTreeProvider и ChangedFilesDecorationProvider в tree/changedFilesTree.ts; логики статус-бара — в statusBar/branchStatusBar.ts.
9. **Команды** — регистрацию команд для Changed File контекста вынести в commands/changedFileCommands.ts с одной точкой входа registerChangedFileCommands(context, deps). Аналогично палитра и контекстное меню веток.
10. **Безопасность** — добавить валидацию в git/shell (commit hash, path), обернуть decodeDiffDocUri в try/catch и проверку структуры, таймауты для fetch аватарок.
11. **Логирование** — в тихих catch добавить log.debug (или log.trace) с контекстом.
12. **Bundling и практики VS Code** — настроить esbuild (или webpack), перенести `main` на `dist/extension.js`, обновить `.vscodeignore`; убедиться, что все Disposable в `context.subscriptions`, в webview — очистка таймеров в onDidDispose; при желании — activationEvents `onView:...` для отложенной активации.
13. **Тесты** — добавить интеграционные тесты (@vscode/test-electron) и/или unit-тесты для чистых модулей; проверка утечек disposable в тестах.

После каждого шага полезно запускать расширение (F5) и проверять сценарии: ветки, коммиты, diff, создание ветки, статус-бар, дерево изменённых файлов.

---

## 9. Краткий чеклист

**Структура и код**
- [ ] Вынести константы и типы в отдельные файлы.
- [ ] Ввести git/shell (и при необходимости git/remote, git/avatars) с безопасным выполнением команд и валидацией.
- [ ] Устранить дублирование: getShortBranchName, emptyTree, getParentCommit, mapLocalBranchesToWebview, mapRemoteBranchesToWebview, openDiffEditor.
- [ ] **Git API для webview (раздел 2):** единый фасад (getBranches, getCommits, getChangedFiles и т.д. + команды), вызов только через API; подписки на события Git в одном месте, дебаунс, notifyGitStateChanged.
- [ ] **Выполнение Git без терминала (п. 2.7):** pull, fetch, sync, push и др. выполняются в фоне через git-слой, без открытия Integrated Terminal; экшены в расширении ведут себя как в нативном Source Control.
- [ ] Разбить handleApiRequest и обработчики сообщений webview по модулям и регистру команд; запросы/команды — через gitForgeApi.
- [ ] **Context Menu API (раздел 3):** реестр пунктов (id, title, icon, keybinding, when, group); setContextMenu/clearContextMenu с setContext; иконки и keybindings в package.json; включение/выключение пунктов через when и контекстные ключи.
- [ ] Вынести tree-провайдеры и статус-бар в отдельные модули.
- [ ] Оставить extension.ts только с activate/deactivate и регистрацией провайдеров/команд.

**Ошибки и безопасность**
- [ ] Заменить тихие catch на логирование (хотя бы debug).
- [ ] Валидация и безопасность: commit/filePath в git-командах, decodeDiffDocUri, таймауты fetch.

**Практики VS Code/Cursor**
- [ ] Все Disposable добавлять в context.subscriptions; в webview — очистка notifyGitStateChangedTimer в onDidDispose.
- [ ] Webview: localResourceRoots по минимуму, темизация (light/dark/high-contrast и var(--vscode-*)).
- [ ] Bundling: esbuild/webpack, main → dist/extension.js, tsc --noEmit, обновить .vscodeignore.
- [ ] По желанию: activationEvents onView для отложенной активации; extensionKind для workspace.
- [ ] Тесты: @vscode/test-electron и/или unit для чистых модулей; проверка очистки disposable.

Этот план можно использовать как дорожную карту для пошагового рефакторинга без «большого взрыва».
