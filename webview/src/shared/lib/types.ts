/** Ветка (локальная или удалённая) */
export interface Branch {
  name: string;
  remote?: string;
  isCurrent?: boolean;
  /** Главная ветка репозитория (master/main) — отображается со звёздочкой */
  isMain?: boolean;
  isFavorite?: boolean;
  isSelected?: boolean;
  /** Локальная ветка отстаёт от remote на N коммитов (для кнопки Update selected) */
  behind?: number;
  /** У локальной ветки настроен upstream (можно делать pull) */
  hasUpstream?: boolean;
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
