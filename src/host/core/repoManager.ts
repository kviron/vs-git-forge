/**
 * RepoManager — управление репозиториями по образцу vscode-git-graph.
 * Использует встроенный Git API (vscode.git), не сканирует файловую систему.
 */

import * as path from "path";
import * as vscode from "vscode";
import { log } from "./logger";
import type {
  GitAPI,
  GitRepository,
  RepoChangeEvent,
} from "../../types/vscodeGit";

// Re-export types so callers can keep importing from core/repoManager.
export type {
  GitAPI,
  GitBranch,
  GitChange,
  GitCommit,
  GitCommitShortStat,
  GitRef,
  GitRemote,
  GitRepository,
  GitRepositoryState,
  GitUpstreamRef,
  RepoChangeEvent,
} from "../../types/vscodeGit";
export { GitRefTypeTag } from "../../types/vscodeGit";

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
  if (!ext) {
    return null;
  }
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
  private readonly _onDidChangeRepos =
    new vscode.EventEmitter<RepoChangeEvent>();
  private didOpenSub: vscode.Disposable | null = null;

  readonly onDidChangeRepos: vscode.Event<RepoChangeEvent> =
    this._onDidChangeRepos.event;

  private async ensureApi(): Promise<GitAPI | null> {
    if (this.api) {
      return this.api;
    }
    if (!this.apiPromise) {
      this.apiPromise = getGitApi();
    }
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
    if (!this.api?.repositories) {
      return [];
    }
    return [...this.api.repositories];
  }

  private getNumReposSync(): number {
    return this.api?.repositories?.length ?? 0;
  }

  async getRepos(): Promise<GitRepository[]> {
    await this.ensureApi();
    return this.getReposSync();
  }

  async getNumRepos(): Promise<number> {
    await this.ensureApi();
    return this.getNumReposSync();
  }

  getRepoContainingFile(filePath: string): GitRepository | null {
    const repos = this.getReposSync();
    if (repos.length === 0) {
      return null;
    }
    if (repos.length === 1) {
      return repos[0];
    }
    let found: GitRepository | null = null;
    for (const r of repos) {
      const root = r.rootUri.fsPath;
      const rootNorm = pathWithTrailingSep(root);
      if (filePath === root || filePath.startsWith(rootNorm)) {
        if (!found || root.length > found.rootUri.fsPath.length) {
          found = r;
        }
      }
    }
    return found;
  }

  isKnownRepo(repoRootPath: string): boolean {
    const repos = this.getReposSync();
    return repos.some(
      (r) =>
        r.rootUri.fsPath === repoRootPath ||
        pathWithTrailingSep(r.rootUri.fsPath) ===
          pathWithTrailingSep(repoRootPath),
    );
  }

  async getCurrentRepo(): Promise<GitRepository | null> {
    const api = await this.ensureApi();
    if (!api) {
      return null;
    }
    const repos = this.getReposSync();
    const picked = this.pickRepoFromList(repos);
    if (picked) {
      return picked;
    }
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

  private pickRepoFromList(
    repos: ReadonlyArray<GitRepository>,
  ): GitRepository | null {
    if (repos.length === 0) {
      return null;
    }
    if (repos.length === 1) {
      return repos[0];
    }
    const activeUri = vscode.window.activeTextEditor?.document?.uri;
    if (activeUri) {
      const repo = this.getRepoContainingFile(activeUri.fsPath);
      if (repo) {
        return repo;
      }
    }
    return repos[0];
  }

  async getGitApi(): Promise<GitAPI | null> {
    return this.ensureApi();
  }

  /**
   * Корень текущего репозитория (fsPath) или null.
   * Удобно, когда нужен только путь без объекта repo.
   */
  async getCurrentRepoRoot(): Promise<string | null> {
    const repo = await this.getCurrentRepo();
    return repo?.rootUri.fsPath ?? null;
  }

  /**
   * Короткое имя текущей ветки (без refs/heads/) или null.
   */
  async getCurrentBranchShortName(): Promise<string | null> {
    const repo = await this.getCurrentRepo();
    const name = repo?.state?.HEAD?.name;
    if (!name) {
      return null;
    }
    return name.replace(/^refs\/heads\//, "").trim() || name;
  }

  dispose(): void {
    this.didOpenSub?.dispose();
    this.didOpenSub = null;
    this._onDidChangeRepos.dispose();
  }
}
