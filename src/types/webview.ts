/** Статистика коммита для webview. */
export interface WebviewCommitShortStat {
  files: number;
  insertions: number;
  deletions: number;
}

/** Ветка для webview — все поля из Ref + Branch (без урезания). */
export interface WebviewBranch {
  name: string;
  refName?: string;
  /** Тип ref: 0=Head, 1=RemoteHead, 2=Tag */
  type?: number;
  commit?: string;
  remote?: string;
  isCurrent?: boolean;
  isMain?: boolean;
  behind?: number;
  ahead?: number;
  hasUpstream?: boolean;
  upstream?: { remote: string; name: string; commit?: string };
  children?: WebviewBranch[];
}

/** Тег для webview — имя, коммит, опционально сообщение аннотированного тега. */
export interface WebviewTag {
  name: string;
  commit?: string;
  message?: string;
  tagger?: string;
}

/** Коммит для webview — все поля из Git API + форматированные даты и аватарки. */
export interface WebviewCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail?: string;
  /** URL аватарки с хоста (GitHub/GitLab), если remote и автор найден там */
  authorAvatarUrl?: string;
  /** Дата авторства (отформатированная) */
  date: string;
  dateRelative?: string;
  /** Дата коммита (отформатированная), если отличается от authorDate */
  commitDate?: string;
  commitDateRelative?: string;
  branches?: string[];
  isMerge?: boolean;
  parents?: string[];
  graphRow?: number[];
  /** Статистика: файлы, добавления, удаления */
  shortStat?: WebviewCommitShortStat;
}

/** Изменённый файл для webview — путь, статус, для переименований оба пути. */
export interface WebviewChangedFile {
  path: string;
  name: string;
  status?: "added" | "modified" | "deleted";
  /** Для переименований (R): путь до переименования, для левой стороны diff. */
  oldPath?: string;
  /** Оригинальный путь (из GitChange.originalUri), если есть */
  originalPath?: string;
  /** URI переименования (из GitChange.renameUri), если есть */
  renamePath?: string;
}

/** Узел дерева: папка или файл */
export type ChangedFileTreeNode =
  | { kind: "folder"; path: string; segment: string }
  | {
      kind: "file";
      path: string;
      name: string;
      status: "added" | "modified" | "deleted";
      oldPath?: string;
    };
