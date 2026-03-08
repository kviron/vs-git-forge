/**
 * Реэкспорт типов Git API расширения vscode.git из официального контракта
 * (см. src/types/vscode-git.d.ts — копия из microsoft/vscode/extensions/git/src/api/git.d.ts).
 *
 * Алиасы Git* сохранены, чтобы не менять импорты по коду.
 * RepoChangeEvent — наш тип для события смены списка репозиториев.
 */

import type {
  API,
  Branch,
  Change,
  Commit,
  CommitShortStat,
  Ref,
  Remote,
  Repository,
  RepositoryState,
  UpstreamRef,
} from "./vscode-git.d";
import { RefType } from "./vscode-git.d";

export type {
  API,
  Branch,
  Change,
  Commit,
  CommitShortStat,
  Ref,
  Remote,
  Repository,
  RepositoryState,
  UpstreamRef,
};

export { RefType };

export type GitAPI = API;
export type GitBranch = Branch;
export type GitChange = Change;
export type GitCommit = Commit;
export type GitCommitShortStat = CommitShortStat;
export type GitRef = Ref;
export type GitRemote = Remote;
export type GitRepository = Repository;
export type GitRepositoryState = RepositoryState;
export type GitUpstreamRef = UpstreamRef;

export const GitRefTypeHead = RefType.Head;
export const GitRefTypeRemoteHead = RefType.RemoteHead;
export const GitRefTypeTag = RefType.Tag;

/** Событие смены списка репозиториев (используется в RepoManager). */
export interface RepoChangeEvent {
  readonly repos: GitRepository[];
  readonly numRepos: number;
}

// --- Дополнительные типы (SCM, URI, timeline) ---

export type { ScmResource } from "./vscode-git.resources";
export { ScmResourceGroupType } from "./vscode-git.resources.enums";
export type { ScmStatus } from "./vscode-git.resources.enums";
export {
  GIT_URI_SCHEME,
  getQueryDataFromScmGitUri,
  type GitUriQuery,
} from "./vscode-git.uri";
