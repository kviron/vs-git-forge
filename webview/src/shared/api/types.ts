import type { Branch, Tag, Commit, ChangedFile } from '../lib/types';

/** Запрос от webview к extension */
export interface ApiRequest {
  type: 'request';
  requestId: string;
  method: ApiMethod;
  params?: Record<string, unknown>;
}

/** Ответ extension к webview */
export interface ApiResponse<T = unknown> {
  type: 'response';
  requestId: string;
  data?: T;
  error?: string;
}

export type ApiMethod =
  | 'getCurrentBranch'
  | 'getLocalBranches'
  | 'getRemoteBranches'
  | 'getBranches'
  | 'getTags'
  | 'getCommits'
  | 'getChangedFiles'
  | 'getCommitChangedFiles'
  | 'getRepositoryRoot'
  | 'getIdeContext'
  | 'initRepo'
  | 'showCreateBranchDialog'
  | 'showCreateTagDialog'
  | 'pullBranch';

/** Распознанный форк IDE: Cursor, VS Code или другой */
export type IdeFlavor = 'cursor' | 'vscode' | 'other';

/** Контекст IDE: язык, тема, приложение (расширение прокидывает из vscode.env / window) */
export interface IdeContextPayload {
  language: string;
  appName: string;
  /** Cursor, VS Code или другой форк */
  ideFlavor: IdeFlavor;
  appHost: string;
  colorThemeKind: number; // 1=light, 2=dark, 3=high contrast
  uiKind: 'desktop' | 'web';
}

/** Ответ getBranches / getLocalBranches / getRemoteBranches */
export interface BranchesPayload {
  currentBranch: string | null;
  local: Branch[];
  remote: Branch[];
  tags?: Tag[];
}

/** Ответ getCommits */
export interface CommitsPayload {
  commits: Commit[];
}

/** Ответ getChangedFiles (рабочая директория + индекс) */
export interface ChangedFilesPayload {
  files: ChangedFile[];
}

/** Ответ getRepositoryRoot */
export interface RepositoryRootPayload {
  root: string | null;
}

/** Ответ initRepo */
export interface InitRepoPayload {
  success: boolean;
}
