/** Upstream ветки (откуда тянем pull) */
export interface BranchUpstream {
  remote: string;
  name: string;
}

/** Ветка (локальная или удалённая). Поля соответствуют данным из VS Code Git API и getBranches. */
export interface Branch {
  /** Отображаемое имя (короткое: master, или remote/name для удалённых) */
  name: string;
  /** Полное имя ref (refs/heads/master, refs/remotes/origin/feature) */
  refName?: string;
  /** Хеш коммита, на который указывает ветка */
  commit?: string;
  /** Имя remote для удалённой ветки (origin и т.д.) */
  remote?: string;
  isCurrent?: boolean;
  /** Главная ветка репозитория (master/main) — отображается со звёздочкой */
  isMain?: boolean;
  isFavorite?: boolean;
  /** Локальная ветка отстаёт от upstream на N коммитов (для кнопки Update selected) */
  behind?: number;
  /** Локальная ветка впереди upstream на N коммитов (из Git API) */
  ahead?: number;
  /** У локальной ветки настроен upstream (можно делать pull) */
  hasUpstream?: boolean;
  /** Upstream: remote + имя ветки на remote */
  upstream?: BranchUpstream;
  children?: Branch[];
}

/** Тег */
export interface Tag {
  name: string;
  commit?: string;
}

/** Специальный хеш для строки «Uncommitted Changes» в таблице коммитов */
export const UNCOMMITTED_HASH = "UNCOMMITTED";

/** Коммит для списка и графа */
export interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail?: string;
  date: string;
  dateRelative?: string;
  branches?: string[];
  isMerge?: boolean;
  /** Хеши родительских коммитов (для построения графа веток) */
  parents?: string[];
  /** Индексы линий графа для отрисовки (0 = первая колонка) */
  graphRow?: number[];
  /** Для строки Uncommitted Changes — список незакоммиченных файлов */
  uncommittedFiles?: ChangedFile[];
}

/** Изменённый файл в коммите */
export interface ChangedFile {
  path: string;
  name: string;
  status?: 'added' | 'modified' | 'deleted';
}
