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
  | 'getRepositoryRoot'
  | 'initRepo'
  | 'showCreateBranchDialog'
  | 'pullBranch';

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
