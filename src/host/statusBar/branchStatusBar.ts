import * as vscode from "vscode";
import type { GitForgeApi } from "../api/webviewApi";
import type { RepoManager } from "../core/repoManager";

let branchStatusBarSubscribed = false;

/** Обновляет пункт в статус-баре: иконка + имя ветки. */
export function updateBranchStatusBar(
  item: vscode.StatusBarItem,
  branch: string | undefined,
): void {
  if (branch) {
    item.text = `$(git-branch) ${branch}`;
    item.tooltip = vscode.l10n.t("statusBar.branchTooltip", branch);
    item.command = "vs-git-forge.openGitForge";
    item.show();
  } else {
    item.hide();
  }
}

/** Подписывается на Git через API (VS Code) и обновляет статус-бар. */
export async function initBranchStatusBarFromApi(
  context: vscode.ExtensionContext,
  item: vscode.StatusBarItem,
  repoManager: RepoManager,
): Promise<boolean> {
  const git = await repoManager.getGitApi();
  if (!git?.repositories?.length) return false;
  const update = (): void => {
    const repo = git.repositories[0];
    updateBranchStatusBar(item, repo?.state?.HEAD?.name);
  };
  update();
  if (!branchStatusBarSubscribed) {
    branchStatusBarSubscribed = true;
    for (const repo of git.repositories) {
      context.subscriptions.push(repo.state.onDidChange(update));
    }
    context.subscriptions.push(
      git.onDidOpenRepository(
        (repo: {
          state: { onDidChange(fn: () => void): vscode.Disposable };
        }) => {
          context.subscriptions.push(repo.state.onDidChange(update));
        },
      ),
    );
  }
  return true;
}

/** Показывает ветку в статус-баре: сначала API, иначе .git/HEAD через gitForgeApi. */
export async function initBranchStatusBar(
  context: vscode.ExtensionContext,
  item: vscode.StatusBarItem,
  repoManager: RepoManager,
  gitForgeApi: GitForgeApi,
): Promise<boolean> {
  const fromApi = await initBranchStatusBarFromApi(
    context,
    item,
    repoManager,
  );
  if (fromApi) return true;
  const branch = await gitForgeApi.getBranchFromGitHead();
  updateBranchStatusBar(item, branch);
  return !!branch;
}
