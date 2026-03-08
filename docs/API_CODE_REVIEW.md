# Code Review: `src/host/api`

Обзор API-слоя расширения: что сделано хорошо и что можно улучшить.

---

## Общая оценка

**Плюсы:**
- Чёткое разделение: маппинг (`branchMapping`, `dateFormat`), контекст (`ideContext`), хендлеры (`handlers`), фасад (`webviewApi`).
- Единая точка входа `GitForgeApi.request()` — удобно для webview и отладки.
- Использование l10n и fallback для дат.
- Типизация через `WebviewBranch`, `WebviewCommit` и т.д.

**Минусы и риски:**
- Дублирование типов и логики, слабая защита от неизвестных методов, возможные баги в краевых случаях.

---

## 1. `branchMapping.ts`

### 1.1 `getTagRefs` — тихий проглатывание ошибок

```ts
} catch (err) {
  return [];
}
```

**Проблема:** При любой ошибке (в т.ч. "нет прав", сломанный репо) возвращается пустой массив, причину теряем.

**Рекомендация:** Логировать ошибку и по необходимости пробрасывать или возвращать структуру `{ refs: [], error?: string }` для отладки.

```ts
} catch (err) {
  log.debug("getTagRefs failed", repo.rootUri.fsPath, err);
  return [];
}
```

Минимум — добавить `log.debug`, чтобы в логах было видно сбой.

---

### 1.2 Дублирование логики короткого имени ветки

В `mapLocalBranchesToWebview` и в других местах:

- `(b.name ?? "").replace(/^refs\/heads\//, "").trim()`
- `getShortBranchName(headName) || headName.replace(/^refs\/heads\//, "").trim()`

**Рекомендация:** Вынести в хелпер в `branchMapping` (или в `git/remote`) и везде использовать его, чтобы не расходиться в регулярках и обработке `refs/heads/`.

```ts
export function toShortBranchName(fullRef: string | undefined): string {
  if (!fullRef) return "";
  return getShortBranchName(fullRef) || fullRef.replace(/^refs\/heads\//, "").trim();
}
```

---

### 1.3 `mapRemoteBranchesToWebview` — тип возврата

Сейчас возвращается массив объектов `{ name: string; children: WebviewBranch[] }`, тогда как тип указан как `WebviewBranch[]`. У `WebviewBranch` есть `children?: WebviewBranch[]`, то есть элементы — это "узлы с детьми", а не плоский список веток.

**Рекомендация:** Ввести отдельный тип для дерева remote-веток, чтобы не смешивать "ветку" и "remote как группу":

```ts
export type WebviewRemoteBranchGroup = { name: string; children: WebviewBranch[] };
export function mapRemoteBranchesToWebview(...): WebviewRemoteBranchGroup[]
```

И в `webviewApi` / типах webview использовать именно его там, где ожидается "список remote-групп".

---

### 1.4 Множественные вызовы `getBranchBehindCount` / `getBranchUpstreamRef`

В цикле по веткам для каждой вызываются синхронные git-команды (`getBranchBehindCount`, `getBranchUpstreamRef`). При большом числе веток это может подтормаживать.

**Рекомендация:** Рассмотреть кэш на время одного запроса или один вызов `git for-each-ref` с нужным форматом, чтобы получить behind/ahead/upstream одним проходом, и дальше только маппить в webview-структуру.

---

## 2. `ideContext.ts`

### 2.1 Константа для дефолтной темы

```ts
const colorThemeKind = vscode.window.activeColorTheme?.kind ?? 2; // default dark
```

**Рекомендация:** Вынести `2` в именованную константу (например, из `vscode.ColorThemeKind`), чтобы было понятно, что это "dark", а не магическое число.

```ts
const defaultThemeKind = vscode.ColorThemeKind.Dark;
const colorThemeKind = vscode.window.activeColorTheme?.kind ?? defaultThemeKind;
```

---

### 2.2 Расширяемость `detectIdeFlavor`

При появлении новых форков (например, "VSCodium") придётся править функцию.

**Рекомендация:** Оставить как есть, но зафиксировать в комментарии или в типе список известных форков и что `"other"` — запасной вариант для неизвестных. При необходимости можно вынести маппинг "substring → flavor" в конфиг/константу.

---

## 3. `dateFormat.ts`

### 3.1 `getDateLocale()` при пустом `language`

```ts
const lang = vscode.env.language;
return lang.startsWith("ru") ? "ru-RU" : "en-US";
```

Если `vscode.env.language` когда-нибудь будет `undefined`, будет исключение.

**Рекомендация:** Сделать безопасный fallback:

```ts
function getDateLocale(): string {
  const lang = vscode.env.language ?? "";
  return lang.startsWith("ru") ? "ru-RU" : "en-US";
}
```

---

### 3.2 Дублирование ключей l10n

Строки `"date.yesterday"` и `"date.daysAgo"` захардкожены и сравниваются с возвращаемым значением для fallback. Если ключи переименуют в l10n, логика сломается тихо.

**Рекомендация:** Вынести ключи в константы в одном месте (например, в этом же файле или в shared/i18n) и использовать везде, включая проверку на fallback.

---

## 4. `handlers.ts`

### 4.1 Тип параметров `params`

Во всех хендлерах используется `Record<string, unknown> | undefined`. Удобно для единой сигнатуры, но теряется контракт "какие поля нужны для метода".

**Рекомендация:** Ввести маленькие интерфейсы для параметров и использовать их в сигнатурах, а в `request()` приводить `params` к нужному типу (с проверкой при необходимости):

```ts
interface InitRepoParams {
  rootUri?: string;
}
interface PullBranchParams {
  branchName: string;
}
```

Тогда в хендлерах будет явно видно, что именно ожидается, и проще добавлять валидацию.

---

### 4.2 `handleShowCreateBranchDialog` — магическая задержка

```ts
await new Promise((r) => setTimeout(r, 100));
```

**Проблема:** Неочевидно, зачем 100 ms и достаточно ли этого во всех средах.

**Рекомендация:** Либо убрать, если без неё всё стабильно, либо вынести в константу и кратко пояснить в комментарии (например, "даём время закрыться предыдущему UI перед открытием диалога").

---

### 4.3 `handlePullBranch` — двойной checkout

Сначала делается `checkout` на целевую ветку, потом `pull`, потом возврат на исходную. При падении `pull` пользователь остаётся на другой ветке.

**Рекомендация:** Либо явно обрабатывать ошибку и восстанавливать исходную ветку в `catch`, либо документировать текущее поведение ("при ошибке pull текущая ветка может измениться"). В идеале — использовать Git API (если есть метод pull), чтобы не дергать checkout вручную.

---

### 4.4 Несогласованность ключей l10n в createTag

В `handleShowCreateTagDialog` при отсутствии репо возвращается `createBranch.repoNotFoundShort` вместо отдельного ключа для тега (например, `createTag.repoNotFoundShort`). Для консистентности и переводов лучше завести отдельный ключ.

---

### 4.5 `void` перед `showErrorMessage` / `showInformationMessage`

Использование `void` явно показывает, что промис намеренно не ожидается — это хорошая практика и её стоит сохранить.

---

## 5. `webviewApi.ts`

### 5.1 Дублирование типа `ApiResult`

`ApiResult` объявлен и в `handlers.ts`, и в `webviewApi.ts`. При расхождении полей легко получить баги.

**Рекомендация:** Определить `ApiResult` один раз (например, в `webviewApi.ts` или в `shared/api/types.ts`) и реэкспортировать/импортировать в `handlers.ts`.

---

### 5.2 Огромный `switch` в `request()`

Метод разросся: много кейсов, вложенная логика (особенно `getCommits`). Сложнее тестировать и добавлять новые методы.

**Рекомендация:** Разбить на отдельные функции по методам и вызывать их из `request()` по маппингу или объекту "method → handler". Пример:

```ts
private readonly methodHandlers: Record<string, (params, repo) => Promise<ApiResult>> = {
  getCurrentBranch: this.getCurrentBranch.bind(this),
  getLocalBranches: this.getLocalBranches.bind(this),
  // ...
};
```

Тогда добавление нового метода = новая функция + одна строка в маппинге.

---

### 5.3 Ранний возврат для `getIdeContext` и `initRepo` без `repo`

Сейчас методы вроде `getIdeContext` и `initRepo` обрабатываются до проверки `repo`. Это ок, но ветвление "сначала особые методы, потом проверка repo, потом switch" со временем становится запутанным. Вынос обработчиков в отдельные функции/объект (как выше) сделает порядок проверок более явным.

---

### 5.4 `getCommits` — синхронные вызовы в цикле

Сбор `refsByCommit` и маппинг коммитов — синхронные. Тяжёлая часть — `fetchGitHubCommitAvatars` / `fetchGitLabAvatarsByEmail` — уже асинхронная и выполняется один раз. Для очень больших логов можно подумать о пагинации или ограничении `maxEntries` (сейчас 100 по умолчанию — разумно). Имеет смысл лишь убедиться, что `maxEntries` не может быть подставлен неограниченно из webview (например, cap 500).

**Рекомендация:** Ограничить сверху:

```ts
const maxEntries = Math.min(
  (params?.maxEntries as number) ?? 100,
  500
);
```

---

### 5.5 Обработка ошибок в `request()`

В конце общий `catch` логирует и возвращает `{ error: message }`. Хорошо. Но в некоторых кейсах (например, `getCommitChangedFiles`) внутри switch возвращается `{ data: { files: [] } }` при ошибке, то есть ошибка не пробрасывается наверх и webview не узнает, что что-то пошло не так.

**Рекомендация:** Для консистентности либо везде при сбое возвращать `{ error: string }`, либо явно разделить "мягкие" сбои (пустой результат) и "жёсткие" (сообщение пользователю). Сейчас смешано.

---

### 5.6 Неиспользуемый импорт `getShortBranchName`

В `webviewApi.ts` импортируется `getShortBranchName` из `../git/remote`, но в файле он не используется (короткое имя считается через `.replace(...)`). Либо использовать его вместо дублирования логики, либо удалить импорт.

---

## 6. Общие рекомендации

1. **Индексный файл**  
   Добавить `src/host/api/index.ts`, реэкспортирующий публичное API (`GitForgeApi`, `getIdeContext`, типы, хендлеры при необходимости), чтобы импорты шли из одного входа.

2. **Валидация входов**  
   Для методов с параметрами из webview (commitHash, branchName, maxEntries) — централизованная валидация или маленькие DTO с проверками (например, не пустая строка, число в диапазоне), чтобы не размазывать проверки по разным файлам.

3. **Тесты**  
   `branchMapping` и `dateFormat` хорошо подходят для юнит-тестов (чистые функции или с моками vscode). `ideContext` можно тестировать с моком `vscode.env` / `vscode.window`. Хендлеры и `request()` — интеграционные или с моками Git API.

4. **Документация**  
   В `webviewApi.ts` в JSDoc для `request()` перечислить поддерживаемые `method` и кратко описать ожидаемые `params` и формат ответа — это упростит поддержку и синхронизацию с webview.

---

## Приоритеты внедрения

| Приоритет | Что сделать |
|-----------|-------------|
| Высокий   | Один общий тип `ApiResult`; защита `getDateLocale()` от `undefined`; убрать/заменить неиспользуемый импорт `getShortBranchName` в webviewApi. |
| Средний   | Тип для remote-веток; константы для l10n и темы; ограничение `maxEntries`; лог в `getTagRefs` при ошибке. |
| Низкий    | Рефакторинг `request()` в маппинг обработчиков; хелпер для короткого имени ветки; константа для задержки 100 ms; отдельный l10n-ключ для createTag. |

Если хочешь, могу предложить конкретные патчи по файлам (по одному на выбор) или сгенерировать диффы под выбранные пункты.
