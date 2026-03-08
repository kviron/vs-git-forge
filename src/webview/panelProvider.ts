import * as path from "path";
import * as vscode from "vscode";
import { runGitSync } from "../git/shell";
import { getShortBranchName } from "../git/remote";
import { log } from "../core/logger";
import { handleShowCreateBranchDialog } from "../api/handlers";
import type { GitForgeApi } from "../api/webviewApi";
import type { RepoManager } from "../core/repoManager";
import type { ChangedFilesTreeProvider } from "../tree/changedFilesTree";
import type { BranchDiffTreeProvider } from "../tree/branchDiffTree";
import { getGitForgePanelHtml } from "./panelHtml";
import {
  registerWebviewMessageHandler,
  type GitForgePanelProvider,
} from "./messageHandler";
import {
  SIDEBAR_WIDTH_KEY,
  DEFAULT_SIDEBAR_WIDTH,
} from "../constants";

export class GitForgePanelViewProvider
  implements vscode.WebviewViewProvider, GitForgePanelProvider
{
  private currentWebviewView: vscode.WebviewView | null = null;
  lastContextMenuBranchRef: string | null = null;
  private notifyGitStateChangedTimer: ReturnType<typeof setTimeout> | undefined;

  private branchDiffTreeView: vscode.TreeView<unknown> | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repoManager: RepoManager,
    private readonly gitForgeApi: GitForgeApi,
    private readonly changedFilesTreeProvider?: ChangedFilesTreeProvider,
    private readonly branchDiffTreeProvider?: BranchDiffTreeProvider,
  ) {}

  setBranchDiffTreeView(view: vscode.TreeView<unknown>): void {
    this.branchDiffTreeView = view;
  }

  getBranchDiffTreeView(): { reveal(): void } | null {
    if (!this.branchDiffTreeView) {
      return null;
    }
    const view = this.branchDiffTreeView;
    return {
      reveal() {
        void view.reveal(undefined as unknown);
      },
    };
  }

  notifyGitStateChanged(): void {
    if (this.notifyGitStateChangedTimer !== undefined) {
      clearTimeout(this.notifyGitStateChangedTimer);
    }
    this.notifyGitStateChangedTimer = setTimeout(() => {
      this.notifyGitStateChangedTimer = undefined;
      this.currentWebviewView?.webview.postMessage({
        type: "gitStateChanged",
      });
    }, 150);
  }

  setLastContextMenuBranchRef(ref: string | null): void {
    this.lastContextMenuBranchRef = ref;
  }

  async runCreateBranchFromContext(): Promise<void> {
    const ref = this.lastContextMenuBranchRef;
    this.lastContextMenuBranchRef = null;
    if (!ref) return;
    const repo = await this.repoManager.getCurrentRepo();
    const result = await handleShowCreateBranchDialog(
      { sourceBranchName: ref },
      repo,
    );
    if (result.error) {
      void vscode.window.showErrorMessage(result.error);
    } else if (result.data != null) {
      this.notifyGitStateChanged();
    }
  }

  async runCheckoutFromContext(): Promise<void> {
    const ref = this.lastContextMenuBranchRef;
    this.lastContextMenuBranchRef = null;
    if (!ref) return;
    const repo = await this.repoManager.getCurrentRepo();
    if (!repo) return;
    const cwd = repo.rootUri.fsPath;
    try {
      runGitSync(cwd, ["checkout", getShortBranchName(ref)]);
      this.notifyGitStateChanged();
    } catch (err) {
      log.errorException(err, "runCheckoutFromContext");
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(msg);
    }
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.currentWebviewView = webviewView;
    webviewView.onDidDispose(() => {
      this.currentWebviewView = null;
      if (this.notifyGitStateChangedTimer !== undefined) {
        clearTimeout(this.notifyGitStateChangedTimer);
        this.notifyGitStateChangedTimer = undefined;
      }
    });

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    const msgDisposable = registerWebviewMessageHandler(webviewView, {
      repoManager: this.repoManager,
      gitForgeApi: this.gitForgeApi,
      context: this.context,
      changedFilesTreeProvider: this.changedFilesTreeProvider,
      panelProvider: this,
      branchDiffTreeProvider: this.branchDiffTreeProvider,
    });
    this.context.subscriptions.push(msgDisposable);

    const savedWidth = this.context.globalState.get<number>(
      SIDEBAR_WIDTH_KEY,
      DEFAULT_SIDEBAR_WIDTH,
    );
    const scriptUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.js"),
    );
    const styleUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.css"),
    );
    const codiconsCssUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "node_modules",
        "@vscode/codicons",
        "dist",
        "codicon.css",
      ),
    );
    webviewView.webview.html = getGitForgePanelHtml(
      webviewView.webview,
      savedWidth,
      scriptUri,
      styleUri,
      codiconsCssUri,
    );
  }
}
