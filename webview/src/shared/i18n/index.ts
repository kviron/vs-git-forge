/**
 * Локализация webview. Язык берётся из data-lang атрибута корневого элемента,
 * который устанавливается расширением из vscode.env.language.
 */

export type Locale = "en" | "ru";

const bundles: Record<Locale, Record<string, string>> = {
  en: {
    "repo.notInitialized": "Git repository not initialized",
    "repo.createRepo": "Create repository",
    "panel.resizeTitle": "Resize left panel",
    "user.allAuthors": "User: All authors",
    "user.label": "User: {0}",
    "branches.local": "Local",
    "branches.remote": "Remote",
    "changedFiles.empty": "No changed files",
    "branch.label": "Branch",
    "branch.head": "Branch: HEAD",
    "branch.filter": "Branch: {0}",
    "branch.ellipsis": "Branch: …",
    "branch.filterDropdown": "Branch filter",
    "branch.clearFilter": "Clear branch filter",
    "branch.ariaOne": "Branch (single selection)",
    "branch.currentHead": "Current branch (HEAD)",
    "toolbar.sortOptions": "Sort and options",
    "toolbar.refresh": "Refresh",
    "toolbar.cherryPick": "Cherry-pick",
    "toolbar.visibility": "Visibility",
    "toolbar.search": "Search",
    "toolbar.hidePanel": "Hide panel",
    "toolbar.deleteBranch": "Delete branch",
  },
  ru: {
    "repo.notInitialized": "Не инициализирован Git-репозиторий",
    "repo.createRepo": "Создать репозиторий",
    "panel.resizeTitle": "Изменить ширину левой панели",
    "user.allAuthors": "User: Все авторы",
    "user.label": "User: {0}",
    "branches.local": "Локальные",
    "branches.remote": "Удалённые",
    "changedFiles.empty": "Нет изменённых файлов",
    "branch.label": "Ветка",
    "branch.head": "Ветка: HEAD",
    "branch.filter": "Ветка: {0}",
    "branch.ellipsis": "Ветка: …",
    "branch.filterDropdown": "Фильтр по ветке",
    "branch.clearFilter": "Сбросить фильтр по ветке",
    "branch.ariaOne": "Ветка (только одна)",
    "branch.currentHead": "Текущая ветка (HEAD)",
    "toolbar.sortOptions": "Сортировка и опции",
    "toolbar.refresh": "Обновить",
    "toolbar.cherryPick": "Cherry-pick",
    "toolbar.visibility": "Видимость",
    "toolbar.search": "Поиск",
    "toolbar.hidePanel": "Скрыть панель",
    "toolbar.deleteBranch": "Удалить ветку",
  },
};

function getLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const root = document.getElementById("root");
  const lang = root?.getAttribute("data-lang") ?? "en";
  if (lang.startsWith("ru")) return "ru";
  return "en";
}

let cachedLocale: Locale | null = null;

/** Текущая локаль (кэшируется при первом вызове). */
export function getLang(): Locale {
  if (cachedLocale === null) {
    cachedLocale = getLocale();
  }
  return cachedLocale;
}

/**
 * Перевести ключ. Подстановки: {0}, {1}, ... заменяются на args.
 */
export function t(key: string, ...args: string[]): string {
  const locale = getLang();
  const bundle = bundles[locale] ?? bundles.en;
  let msg = bundle[key] ?? bundles.en[key] ?? key;
  args.forEach((arg, i) => {
    msg = msg.replace(new RegExp(`\\{${i}\\}`, "g"), arg);
  });
  return msg;
}
