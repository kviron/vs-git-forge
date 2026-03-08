---
name: add-webview
description: Adds a new webview to the VS Code extension (new panel/sidebar/custom editor). Use when the user wants to add another webview, plug a view in a different place in VS Code, or register a new view in the views registry. Assumes FSD layout and single-bundle webview (app/views-registry, host/panelHtml).
---

# Добавление нового webview

Один бандл `webview.js` обслуживает все представления; выбор view — по `data-view` в HTML и реестру в `app/views-registry.tsx`.

## Шаги

### 1. Слайс представления в `src/views/<name>/`

- **`view.tsx`** — корневой компонент: обёртка с провайдерами (если нужны) и страница/контент.
- При необходимости **`ui/`** — страницы и компоненты, специфичные для этого view.
- Переиспользовать: `shared`, `entities`, `features`, `widgets`.

**Пример (как в git-view):**

```tsx
// src/views/<name>/view.tsx
export function MyNewView() {
  return (
    <SomeProviderIfNeeded>
      <MyPage />
    </SomeProviderIfNeeded>
  );
}
```

### 2. Регистрация в `src/app/views-registry.tsx`

- Добавить константу: `VIEW_IDS.MY_NEW = "my-new-id"`.
- Добавить в `VIEW_REGISTRY`: `[VIEW_IDS.MY_NEW]: MyNewView`.
- Для код-сплита можно обернуть в `lazy(() => import("@/views/<name>/view").then(m => ({ default: m.MyNewView })))`.

### 3. Хост: передача viewId при создании HTML

В месте, где создаётся WebviewViewProvider или WebviewPanel для нового места в VS Code:

- Вызвать `getGitForgePanelHtml(webview, sidebarWidthPx, scriptUri, cspNonce, lang, { viewId: "my-new-id" })`.
- Использовать тот же `scriptUri` (один `webview.js`), другой `viewId` — в разметке в `#root` попадёт `data-view="my-new-id"`, и `webview-main.tsx` отрисует нужный компонент из реестра.

## Проверка

- Сборка webview: `npm run build:webview:raw`.
- Сборка расширения: `npm run compile`.
- Запуск (F5): открыть место, где зарегистрирован новый провайдер с этим `viewId`.

## Ссылки

- Полная схема FSD и нескольких webview: [docs/FSD_VSCODE_PLAN.md](../../../docs/FSD_VSCODE_PLAN.md) (раздел 6).
