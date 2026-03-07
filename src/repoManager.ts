/**
 * RepoManager — управление репозиториями по образцу vscode-git-graph.
 * Использует встроенный Git API (vscode.git), не сканирует файловую систему.
 */

import * as path from "path";
import * as vscode from "vscode";
import { log } from "./logger";

// --- Минимальные типы встроенного Git API (vscode.git) ---
export const GitRefTypeTag = 2;
export interface GitRef {
  readonly type: number;
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}
export interface GitBranch extends GitRef {
  readonly upstream?: { remote: string; name: string };
  readonly ahead?: number;
  readonly behind?: number;
}
export interface GitCommit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
  readonly authorDate?: Date;
  readonly authorName?: string;
  readonly authorEmail?: string;
}
export interface GitChange {
  readonly uri: vscode.Uri;
  readonly status: number;
}
export interface GitRepositoryState {
  readonly HEAD?: GitBranch;
  readonly refs: GitRef[];
  readonly workingTreeChanges: GitChange[];
  readonly indexChanges: GitChange[];
  onDidChange(fn: () => void): vscode.Disposable;
}
export interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  getBranches(
    query: { remote?: boolean },
    token?: vscode.CancellationToken,
  ): Promise<GitBranch[]>;
  getRefs?(query?: { pattern?: string | string[] }): Promise<GitRef[]>;
  log(options?: { maxEntries?: number; ref?: string; refNames?: string[] }): Promise<GitCommit[]>;
}
export interface GitAPI {
  readonly repositories: ReadonlyArray<GitRepository>;
  onDidOpenRepository(fn: (repo: GitRepository) => void): vscode.Disposable;
  init(root: vscode.Uri): Promise<GitRepository>;
}

export interface RepoChangeEvent {
  readonly repos: GitRepository[];
  readonly numRepos: number;
}

const GIT_REPO_WAIT_TIMEOUT_MS = 5000;

function pathWithTrailingSep(p: string): string {
  return p.endsWith(path.sep) ? p : p + path.sep;
}

/**
 * Возвращает Git API (vscode.git) или null.
 */
export async function getGitApi(): Promise<GitAPI | null> {
  const ext = vscode.extensions.getExtension<{
    getAPI(version: number): GitAPI;
  }>("vscode.git");
  if (!ext) {return null;}
  try {
    return ext.isActive
      ? ext.exports.getAPI(1)
      : (await ext.activate()).getAPI(1);
  } catch (e) {
    log.errorException(e, "getGitApi: расширение vscode.git недоступно");
    return null;
  }
}

/**
 * Менеджер репозиториев: список репо из workspace, выбор текущего по активному редактору,
 * подписка на изменение списка (onDidOpenRepository).
 */
export class RepoManager implements vscode.Disposable {
  private api: GitAPI | null = null;
  private apiPromise: Promise<GitAPI | null> | null = null;
  private readonly _onDidChangeRepos = new vscode.EventEmitter<RepoChangeEvent>();
  private didOpenSub: vscode.Disposable | null = null;

  /** Событие при изменении списка репозиториев (добавлен новый репо). */
  readonly onDidChangeRepos: vscode.Event<RepoChangeEvent> =
    this._onDidChangeRepos.event;

  private async ensureApi(): Promise<GitAPI | null> {
    if (this.api) {return this.api;}
    if (!this.apiPromise) {this.apiPromise = getGitApi();}
    this.api = await this.apiPromise;
    if (this.api && !this.didOpenSub) {
      this.didOpenSub = this.api.onDidOpenRepository(() => {
        this._onDidChangeRepos.fire({
          repos: this.getReposSync(),
          numRepos: this.getNumReposSync(),
        });
      });
    }
    return this.api;
  }

  private getReposSync(): GitRepository[] {
    if (!this.api?.repositories) {return [];}
    return [...this.api.repositories];
  }

  private getNumReposSync(): number {
    return this.api?.repositories?.length ?? 0;
  }

  /**
   * Список всех известных репозиториев (из Git API).
   */
  async getRepos(): Promise<GitRepository[]> {
    await this.ensureApi();
    return this.getReposSync();
  }

  /**
   * Количество известных репозиториев.
   */
  async getNumRepos(): Promise<number> {
    await this.ensureApi();
    return this.getNumReposSync();
  }

  /**
   * Репозиторий, в котором лежит файл по пути `filePath`.
   * Если путь не в известном репо — null.
   */
  getRepoContainingFile(filePath: string): GitRepository | null {
    const repos = this.getReposSync();
    if (repos.length === 0) {return null;}
    if (repos.length === 1) {return repos[0];}
    let found: GitRepository | null = null;
    for (const r of repos) {
      const root = r.rootUri.fsPath;
      const rootNorm = pathWithTrailingSep(root);
      if (
        filePath === root ||
        filePath.startsWith(rootNorm)
      ) {
        if (!found || root.length > found.rootUri.fsPath.length) {
          found = r;
        }
      }
    }
    return found;
  }

  /**
   * Проверяет, известен ли репозиторий (по корневому пути).
   */
  isKnownRepo(repoRootPath: string): boolean {
    const repos = this.getReposSync();
    return repos.some(
      (r) =>
        r.rootUri.fsPath === repoRootPath ||
        pathWithTrailingSep(r.rootUri.fsPath) === pathWithTrailingSep(repoRootPath),
    );
  }

  /**
   * Выбор «текущего» репо: по активному редактору, иначе первый.
   * Если репо ещё нет — ждёт onDidOpenRepository до таймаута.
   */
  async getCurrentRepo(): Promise<GitRepository | null> {
    const api = await this.ensureApi();
    if (!api) {return null;}

    const repos = this.getReposSync();
    const picked = this.pickRepoFromList(repos);
    if (picked) {return picked;}

    return new Promise<GitRepository | null>((resolve) => {
      const timeout = setTimeout(() => {
        sub.dispose();
        resolve(null);
      }, GIT_REPO_WAIT_TIMEOUT_MS);
      const sub = api.onDidOpenRepository((repo) => {
        clearTimeout(timeout);
        sub.dispose();
        resolve(repo);
      });
    });
  }

  /**
   * Выбор репо из списка: по активному документу, иначе первый.
   */
  private pickRepoFromList(
    repos: ReadonlyArray<GitRepository>,
  ): GitRepository | null {
    if (repos.length === 0) {return null;}
    if (repos.length === 1) {return repos[0];}
    const activeUri = vscode.window.activeTextEditor?.document?.uri;
    if (activeUri) {
      const repo = this.getRepoContainingFile(activeUri.fsPath);
      if (repo) {return repo;}
    }
    return repos[0];
  }

  /**
   * Получить сырой Git API (для подписок на state и т.п.).
   */
  async getGitApi(): Promise<GitAPI | null> {
    return this.ensureApi();
  }

  dispose(): void {
    this.didOpenSub?.dispose();
    this.didOpenSub = null;
    this._onDidChangeRepos.dispose();
  }
}
