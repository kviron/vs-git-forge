/**
 * Точка входа расширения vs-git-forge.
 * Только activate/deactivate и регистрация провайдеров и команд.
 */

import * as vscode from "vscode";
import { DiffDocProvider } from "./diffDocProvider";
import { getCommitFile } from "./diff/getCommitFile";
import { runStartupLifecycle } from "./lifecycle/startup";
import { runUninstallLifecycle } from "./lifecycle/uninstall";
import { log, initLogger } from "./core/logger";
import { RepoManager } from "./core/repoManager";
import {
  initBranchStatusBar,
  updateBranchStatusBar,
} from "./statusBar/branchStatusBar";
import { getBranchFromGitHead } from "./api/webviewApi";
import { ChangedFilesDecorationProvider } from "./tree/changedFilesTree";
import { ChangedFilesTreeProvider } from "./tree/changedFilesTree";
import { GitForgePanelViewProvider } from "./webview/panelProvider";
import { registerChangedFileCommands } from "./commands/changedFileCommands";
import { handleShowCreateBranchDialog } from "./api/handlers";

export function activate(context: vscode.ExtensionContext): void {
  initLogger(context);
  log.info('Расширение "vs-git-forge" активировано.');

  try {
    runActivate(context);
  } catch (e) {
    log.errorException(e, "activate");
    throw e;
  }
}

function runActivate(context: vscode.ExtensionContext): void {
  const lifecycle = runStartupLifecycle(context, {
    skipInDevelopmentHost: true,
  });
  if (lifecycle.stage === "install") {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("lifecycle.installed"),
    );
  }

  const repoManager = new RepoManager();
  context.subscriptions.push(repoManager);

  const diffDocProvider = new DiffDocProvider(getCommitFile);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      DiffDocProvider.scheme,
      diffDocProvider,
    ),
  );

  const branchStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  branchStatusBarItem.command = "vs-git-forge.openGitForge";
  context.subscriptions.push(branchStatusBarItem);
  void initBranchStatusBar(context, branchStatusBarItem, repoManager);

  const refreshFromFile = async (): Promise<void> => {
    const branch = await getBranchFromGitHead();
    updateBranchStatusBar(branchStatusBarItem, branch);
  };

  const gitHeadWatcher =
    vscode.workspace.createFileSystemWatcher("**/.git/HEAD");
  gitHeadWatcher.onDidCreate(async () => {
    const tryInit = async (delayMs: number): Promise<boolean> => {
      await new Promise((r) => setTimeout(r, delayMs));
      return initBranchStatusBar(context, branchStatusBarItem, repoManager);
    };
    if (!(await tryInit(800))) await tryInit(2000);
    await refreshFromFile();
    gitForgeProvider.notifyGitStateChanged();
  });
  gitHeadWatcher.onDidChange(async () => {
    await refreshFromFile();
    gitForgeProvider.notifyGitStateChanged();
  });
  context.subscriptions.push(gitHeadWatcher);

  const changedFilesDecorationProvider = new ChangedFilesDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(changedFilesDecorationProvider),
  );
  const changedFilesTreeProvider = new ChangedFilesTreeProvider(
    changedFilesDecorationProvider,
  );
  const gitForgeProvider = new GitForgePanelViewProvider(
    context,
    repoManager,
    changedFilesTreeProvider,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "vs-git-forge.gitForgeView",
      gitForgeProvider,
    ),
  );

  const changedFilesTreeView = vscode.window.createTreeView(
    "vs-git-forge.changedFilesView",
    { treeDataProvider: changedFilesTreeProvider },
  );
  context.subscriptions.push(changedFilesTreeView);

  const setupGitStateWatchers = (): void => {
    gitForgeProvider.notifyGitStateChanged();
  };
  void repoManager.getGitApi().then((git) => {
    if (!git) return;
    for (const repo of git.repositories) {
      context.subscriptions.push(repo.state.onDidChange(setupGitStateWatchers));
    }
    context.subscriptions.push(
      git.onDidOpenRepository(
        (repo: {
          state: { onDidChange(fn: () => void): vscode.Disposable };
        }) => {
          context.subscriptions.push(
            repo.state.onDidChange(setupGitStateWatchers),
          );
        },
      ),
    );
  });

  const gitRefsWatcher =
    vscode.workspace.createFileSystemWatcher("**/.git/refs/**");
  gitRefsWatcher.onDidChange(setupGitStateWatchers);
  gitRefsWatcher.onDidCreate(setupGitStateWatchers);
  gitRefsWatcher.onDidDelete(setupGitStateWatchers);
  context.subscriptions.push(gitRefsWatcher);

  const applyPanelViewSize = (): void => {
    const steps = vscode.workspace
      .getConfiguration("gitForge")
      .get<number>("panelViewSizeSteps", 4);
    if (steps <= 0) return;
    let count = 0;
    const run = (): void => {
      if (count >= steps) return;
      void vscode.commands.executeCommand(
        "workbench.action.increaseViewSize",
      );
      count += 1;
      setTimeout(run, 50);
    };
    setTimeout(run, 100);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("vs-git-forge.openGitForge", async () => {
      await vscode.commands.executeCommand(
        "vs-git-forge.gitForgeView.focus",
      );
      applyPanelViewSize();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vs-git-forge.createBranch", async () => {
      const repo = await repoManager.getCurrentRepo();
      const result = await handleShowCreateBranchDialog(undefined, repo);
      if (result.error) {
        void vscode.window.showErrorMessage(result.error);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vs-git-forge.createBranchFromContext",
      () => gitForgeProvider.runCreateBranchFromContext(),
    ),
    vscode.commands.registerCommand(
      "vs-git-forge.checkoutBranchFromContext",
      () => gitForgeProvider.runCheckoutFromContext(),
    ),
  );

  registerChangedFileCommands(context, {
    repoManager,
    changedFilesTreeProvider,
    changedFilesTreeView,
    gitForgeProvider,
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("vs-git-forge.helloWorld", () => {
      vscode.window.showInformationMessage(vscode.l10n.t("helloWorld"));
    }),
  );
  log.debug("Регистрация команд и провайдеров завершена.");
}

export function deactivate(): void {
  log.info("Расширение деактивировано.");
  void runUninstallLifecycle();
}
