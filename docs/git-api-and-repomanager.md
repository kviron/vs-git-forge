# VS Code Git API и RepoManager

## Полнота сущностей

Типы в `src/types/vscodeGit.ts` и `src/types/webview.ts` приведены к полному набору полей по контракту VS Code и Git:

- **Commit:** hash, message, parents, authorDate/authorName/authorEmail, **commitDate**, **shortStat** (files, insertions, deletions).
- **Ref/Branch:** type (Head/RemoteHead/Tag), name, commit, **commitDetails**, remote; у Branch — upstream с полями **remote, name, commit**.
- **Change:** uri, **originalUri**, **renameUri**, status.
- **RepositoryState:** HEAD, refs, **remotes**, indexChanges, workingTreeChanges, **mergeChanges**, **untrackedChanges**, **rebaseCommit**.
- **WebviewCommit:** все поля коммита + **commitDate**/commitDateRelative, **shortStat**.
- **WebviewBranch:** **type**, upstream с **commit**.
- **WebviewTag:** name, commit, **message**, **tagger** (для аннотированных тегов).
- **WebviewChangedFile:** path, name, status, oldPath, **originalPath**, **renamePath**.

Маппинг в `api/webviewApi.ts` и `api/branchMapping.ts` прокидывает эти поля; для лога коммитов запрашивается `shortStats: true`, чтобы приходить shortStat.

---

# VS Code Git API и RepoManager

## Кто что делает

- **VS Code Git API** (`vscode.git`) — встроенное расширение Microsoft. Мы его **не расширяем**, только **используем**: получаем `getAPI(1)` и работаем с `repositories`, методами репозиториев и событиями.
- **RepoManager** (`src/core/repoManager.ts`) — наш слой: выбор текущего репо, подписки на открытие репо, хелперы. Его мы **расширяем** по мере надобности (новые методы, обёртки).

## Что реально даёт VS Code Git API

Расширение `vscode.git` отдаёт репозитории с богатым интерфейсом (см. [api1.ts](https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/api1.ts)). Помимо того, что мы уже используем:

**Чтение**
- `state.HEAD`, `state.indexChanges`, `state.workingTreeChanges`
- `getBranches()`, `getRefs()`, `log()`
- `getCommit(ref)`, `show(ref, path)` — один коммит и содержимое файла на ревизии
- `getConfig(key)`, `getGlobalConfig(key)`
- `diffBetween(ref1, ref2, path?)` — diff между ревизиями

**Операции без терминала (как в Source Control)**
- `checkout(treeish)` — переключение ветки/тега/коммита
- `push(remoteName?, branchName?, setUpstream?, force?)` — push ветки (учётные данные через VS Code)
- `pull(unshallow?)` — pull текущей ветки
- `fetch(options?)` — fetch
- `merge(ref)`, `rebase(branch)`
- `createBranch(name, checkout, ref?)`, `deleteBranch(name, force?)`
- `tag(name, message, ref?)`, `deleteTag(name)`

Использование этих методов даёт единый слой с нативным Git в VS Code (credentials, провайдеры, без лишнего терминала).

## Что мы описали в типах и добавили в RepoManager

### Типы (`src/types/vscodeGit.ts`)

В интерфейс `GitRepository` добавлены **опциональные** методы (через `?`), чтобы TypeScript не ругался и мы могли вызывать их при наличии:

- `checkout?(treeish)`
- `push?(remoteName?, branchName?, setUpstream?, force?)`
- `pull?(unshallow?)`
- `fetch?(options?)`
- `merge?(ref)`, `rebase?(branch)`
- `show?(ref, path)` — содержимое файла на ревизии
- `getCommit?(ref)`
- `diffBetween?(ref1, ref2, path?)`
- `createBranch?`, `deleteBranch?`, `tag?`, `deleteTag?`
- `getConfig?(key)`

В рантайме объект от `getAPI(1)` эти методы уже имеет; типы просто это отражают.

### RepoManager

- **`getCurrentRepoRoot(): Promise<string | null>`** — путь к корню текущего репо (удобно, когда нужен только путь).
- **`getCurrentBranchShortName(): Promise<string | null>`** — короткое имя текущей ветки (без `refs/heads/`).

Остальной функционал — как раньше: `getCurrentRepo()`, `getRepos()`, `getGitApi()`, `getRepoContainingFile()`, `isKnownRepo()`.

## Как использовать методы API в коде

Если у тебя есть `repo: GitRepository` (например из `repoManager.getCurrentRepo()`), можно вызывать методы, проверяя наличие:

```ts
// Push ветки — предпочтительно через API (учётные данные VS Code)
if (typeof repo.push === "function") {
  await repo.push("origin", branchName);
} else {
  runGitSync(repoRoot, ["push", "origin", branchName]);
}

// Checkout
if (typeof repo.checkout === "function") {
  await repo.checkout(treeish);
} else {
  runGitSync(repoRoot, ["checkout", treeish]);
}

// Содержимое файла на ревизии (вместо git/shell.getCommitFileContent при необходимости)
if (typeof repo.show === "function") {
  const content = await repo.show(commit, filePath);
}
```

В `messageHandler` для **pushBranch** уже используется `repo.push?.()`, если он есть, иначе `runGitSync`. Остальные команды (checkout, pull, merge, rebase) можно по тому же шаблону перевести на вызовы `repo.checkout?`, `repo.pull?` и т.д., чтобы всё шло через один слой VS Code Git.

## Что добавлять дальше

- При необходимости в **RepoManager** можно добавить обёртки вида `runPush(repo, remote, branch)` / `runCheckout(repo, treeish)`, которые внутри вызывают `repo.push?`/`repo.checkout?` с fallback на `runGitSync` — тогда вся логика «сначала API, потом shell» будет в одном месте.
- Для операций с тегами (push tag, delete remote tag) встроенный API может не давать отдельного метода — их оставляем через `runGitSync`.
- Если понадобится `repo.getConfig("user.email")` или `repo.show(ref, path)` для Diff — типы и примеры выше уже позволяют это вызывать из нашего кода.
