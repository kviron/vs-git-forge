/**
 * Точка входа расширения vs-git-forge.
 * Только activate/deactivate и регистрация провайдеров и команд.
 */

import * as path from "path";
import * as vscode from "vscode";
import { handleShowCreateBranchDialog } from "./host/api/handlers";
import { GitForgeApi } from "./host/api/webviewApi";
import { registerChangedFileCommands } from "./host/commands/changedFileCommands";
import { initLogger, log } from "./host/core/logger";
import { RepoManager } from "./host/core/repoManager";
import { getCommitFile } from "./host/diff/getCommitFile";
import {
  DiffDocProvider,
  DiffSide,
  encodeDiffDocUri,
  GitFileStatus,
} from "./host/diffDocProvider";
import { getShortBranchName } from "./host/git/remote";
import { runStartupLifecycle } from "./host/lifecycle/startup";
import { runUninstallLifecycle } from "./host/lifecycle/uninstall";
import {
  BRANCH_DIFF_TAB_TITLE_PREFIX,
  DOUBLE_CLICK_THRESHOLD_MS,
  PANEL_VIEW_SIZE_INITIAL_DELAY_MS,
  PANEL_VIEW_SIZE_STEP_DELAY_MS,
} from "./constants";
import {
  initBranchStatusBar,
  updateBranchStatusBar,
} from "./host/statusBar/branchStatusBar";
import {
  BranchDiffDecorationProvider,
  BranchDiffTreeProvider,
} from "./host/tree/branchDiffTree";
import {
  ChangedFilesDecorationProvider,
  ChangedFilesTreeProvider,
} from "./host/tree/changedFilesTree";
import { GitForgePanelViewProvider } from "./host/panelProvider";

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

  const gitForgeApi = new GitForgeApi();

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
  void initBranchStatusBar(
    context,
    branchStatusBarItem,
    repoManager,
    gitForgeApi,
  );

  const refreshFromFile = async (): Promise<void> => {
    const branch = await gitForgeApi.getBranchFromGitHead();
    updateBranchStatusBar(branchStatusBarItem, branch);
  };

  const gitHeadWatcher =
    vscode.workspace.createFileSystemWatcher("**/.git/HEAD");
  gitHeadWatcher.onDidCreate(async () => {
    const tryInit = async (delayMs: number): Promise<boolean> => {
      await new Promise((r) => setTimeout(r, delayMs));
      return initBranchStatusBar(
        context,
        branchStatusBarItem,
        repoManager,
        gitForgeApi,
      );
    };
    if (!(await tryInit(800))) {
      await tryInit(2000);
    }
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
    vscode.window.registerFileDecorationProvider(
      changedFilesDecorationProvider,
    ),
  );
  const changedFilesTreeProvider = new ChangedFilesTreeProvider(
    changedFilesDecorationProvider,
  );
  const branchDiffDecorationProvider = new BranchDiffDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(branchDiffDecorationProvider),
  );
  const branchDiffTreeProvider = new BranchDiffTreeProvider(
    branchDiffDecorationProvider,
  );
  const gitForgeProvider = new GitForgePanelViewProvider(
    context,
    repoManager,
    gitForgeApi,
    changedFilesTreeProvider,
    branchDiffTreeProvider,
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

  void vscode.commands.executeCommand(
    "setContext",
    "gitForge.branchDiffActive",
    false,
  );
  const branchDiffTreeView = vscode.window.createTreeView(
    "vs-git-forge.branchDiffView",
    { treeDataProvider: branchDiffTreeProvider },
  );
  context.subscriptions.push(branchDiffTreeView);
  gitForgeProvider.setBranchDiffTreeView(branchDiffTreeView);

  const setupGitStateWatchers = (): void => {
    gitForgeProvider.notifyGitStateChanged();
  };
  void repoManager.getGitApi().then((git) => {
    if (!git) {
      return;
    }
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
    if (steps <= 0) {
      return;
    }
    let count = 0;
    const run = (): void => {
      if (count >= steps) {
        return;
      }
      void vscode.commands.executeCommand("workbench.action.increaseViewSize");
      count += 1;
      setTimeout(run, PANEL_VIEW_SIZE_STEP_DELAY_MS);
    };
    setTimeout(run, PANEL_VIEW_SIZE_INITIAL_DELAY_MS);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("vs-git-forge.openGitForge", async () => {
      await vscode.commands.executeCommand("vs-git-forge.gitForgeView.focus");
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

  let lastBranchDiffFile: string | null = null;
  let lastBranchDiffTime = 0;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vs-git-forge.branchDiffDiffOnDoubleClick",
      (
        repoRoot: string,
        branchRef: string,
        filePath: string,
        status: "added" | "modified" | "deleted",
        oldPath?: string,
      ) => {
        const now = Date.now();
        const isDoubleClick =
          lastBranchDiffFile === filePath &&
          now - lastBranchDiffTime < DOUBLE_CLICK_THRESHOLD_MS;
        lastBranchDiffFile = filePath;
        lastBranchDiffTime = now;
        if (isDoubleClick) {
          lastBranchDiffFile = null;
          void vscode.commands.executeCommand(
            "vs-git-forge.branchDiffOpenFile",
            repoRoot,
            branchRef,
            filePath,
            status,
            oldPath,
          );
        }
      },
    ),
  );

  let lastBranchDiffOpenedFile: {
    repoRoot: string;
    branchRef: string;
    filePath: string;
    status: "added" | "modified" | "deleted";
    oldPath?: string;
  } | null = null;

  const closeFirstBranchDiffTab = async (): Promise<void> => {
    const tabGroups = vscode.window.tabGroups;
    for (const group of tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.label.startsWith(BRANCH_DIFF_TAB_TITLE_PREFIX)) {
          await tabGroups.close(tab, false);
          return;
        }
      }
    }
  };

  const closeAllBranchDiffTabs = async (): Promise<void> => {
    const tabGroups = vscode.window.tabGroups;
    for (const group of tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.label.startsWith(BRANCH_DIFF_TAB_TITLE_PREFIX)) {
          await tabGroups.close(tab, false);
        }
      }
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vs-git-forge.branchDiffSwap",
      async () => {
        branchDiffTreeProvider.setReversed(
          !branchDiffTreeProvider.getReversed(),
        );
        await closeFirstBranchDiffTab();
        if (lastBranchDiffOpenedFile) {
          const a = lastBranchDiffOpenedFile;
          await vscode.commands.executeCommand(
            "vs-git-forge.branchDiffOpenFile",
            a.repoRoot,
            a.branchRef,
            a.filePath,
            a.status,
            a.oldPath,
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vs-git-forge.branchDiffClose",
      async () => {
        await closeAllBranchDiffTabs();
        lastBranchDiffOpenedFile = null;
        branchDiffTreeProvider.clear();
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vs-git-forge.branchDiffOpenFile",
      async (
        repoRoot: string,
        branchRef: string,
        filePath: string,
        status: "added" | "modified" | "deleted",
        oldPath?: string,
      ) => {
        const gitStatus =
          status === "added"
            ? GitFileStatus.Added
            : status === "deleted"
              ? GitFileStatus.Deleted
              : GitFileStatus.Modified;
        const leftPath = status === "modified" && oldPath ? oldPath : filePath;
        const leftUri =
          gitStatus === GitFileStatus.Added
            ? encodeDiffDocUri(
                repoRoot,
                filePath,
                branchRef,
                gitStatus,
                DiffSide.Old,
              )
            : encodeDiffDocUri(
                repoRoot,
                leftPath,
                branchRef,
                gitStatus,
                DiffSide.Old,
              );
        const rightUri =
          gitStatus === GitFileStatus.Deleted
            ? encodeDiffDocUri(
                repoRoot,
                filePath,
                branchRef,
                gitStatus,
                DiffSide.New,
              )
            : vscode.Uri.file(path.join(repoRoot, filePath));

        const reversed = branchDiffTreeProvider.getReversed();
        const finalLeft = reversed ? leftUri : rightUri;
        const finalRight = reversed ? rightUri : leftUri;

        await closeFirstBranchDiffTab();

        lastBranchDiffOpenedFile = {
          repoRoot,
          branchRef,
          filePath,
          status,
          oldPath,
        };

        const fileName = path.basename(filePath);
        const title = BRANCH_DIFF_TAB_TITLE_PREFIX + fileName;
        await vscode.commands.executeCommand(
          "vscode.diff",
          finalLeft,
          finalRight,
          title,
          { viewColumn: vscode.ViewColumn.Active },
        );
      },
    ),
  );

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
