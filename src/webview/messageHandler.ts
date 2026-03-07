/**
 * Обработчик сообщений webview: request/response, command (регистр команд), setContextMenu, прочее.
 */

import * as path from "path";
import * as vscode from "vscode";
import { handleApiRequest } from "../api/webviewApi";
import {
  encodeDiffDocUri,
  DiffSide,
  GitFileStatus,
  UNCOMMITTED as DIFF_UNCOMMITTED,
} from "../diffDocProvider";
import { runGitSync, getParentCommit } from "../git/shell";
import { getShortBranchName } from "../git/remote";
import { GIT_DIFF_MAX_BUFFER } from "../constants";
import { log } from "../core/logger";
import type { GitRepository } from "../core/repoManager";
import type { WebviewChangedFile } from "../types/webview";
import { SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH } from "../constants";

export interface GitForgePanelProvider {
  notifyGitStateChanged(): void;
  setLastContextMenuBranchRef(ref: string | null): void;
  runCreateBranchFromContext(): Promise<void>;
  runCheckoutFromContext(): Promise<void>;
}

export interface RegisterMessageHandlerDeps {
  repoManager: { getCurrentRepo(): Promise<GitRepository | null> };
  context: vscode.ExtensionContext;
  changedFilesTreeProvider?: {
    setData(
      commitHash: string | null,
      files: WebviewChangedFile[],
      repoRoot?: string,
    ): void;
  };
  panelProvider: GitForgePanelProvider;
}

type WebviewMessage = {
  type?: string;
  width?: number;
  requestId?: string;
  method?: string;
  params?: Record<string, unknown>;
  command?: string;
  branchRef?: string;
  level?: string;
  message?: string;
  args?: unknown[];
  commitHash?: string;
  files?: WebviewChangedFile[];
};

/**
 * Регистрирует обработчик сообщений для webview.
 * Вызывать из resolveWebviewView после установки webview.options.
 */
export function registerWebviewMessageHandler(
  webviewView: vscode.WebviewView,
  deps: RegisterMessageHandlerDeps,
): vscode.Disposable {
  const { repoManager, context, changedFilesTreeProvider, panelProvider } = deps;

  const handleMessage = async (msg: WebviewMessage): Promise<void> => {
    if (msg.type === "webviewLog" && typeof msg.message === "string") {
      const level =
        msg.level === "warn" || msg.level === "error" || msg.level === "info"
          ? msg.level
          : "debug";
      const args = Array.isArray(msg.args) ? msg.args : [];
      log[level](`[webview] ${msg.message}`, ...args);
      return;
    }
    if (msg.type === "sidebarWidth" && typeof msg.width === "number") {
      context.globalState.update(SIDEBAR_WIDTH_KEY, msg.width);
      return;
    }
    if (
      msg.type === "setContextMenuBranch" &&
      typeof msg.branchRef === "string"
    ) {
      panelProvider.setLastContextMenuBranchRef(msg.branchRef);
      return;
    }
    if (msg.type === "selectedCommitChanged") {
      const commitHash =
        typeof msg.commitHash === "string" ? msg.commitHash : null;
      const files = Array.isArray(msg.files) ? msg.files : [];
      const repo = await repoManager.getCurrentRepo();
      const repoRoot = repo?.rootUri.fsPath;
      changedFilesTreeProvider?.setData(commitHash, files, repoRoot);
      return;
    }
    if (msg.type === "command" && msg.command) {
      if (msg.command === "applyPanelSettings") {
        const run = (commandId: string, ...args: unknown[]) =>
          vscode.commands
            .executeCommand(commandId, ...args)
            .then(() => true, () => false);
        await run("workbench.action.positionPanelBottom");
        await run("workbench.action.toggleMaximizedPanel");
        await run("workbench.action.setActivityBarPosition", "left");
        await run("workbench.action.setPanelAlignment", "justify");
        const config = vscode.workspace.getConfiguration("workbench");
        const updates: Thenable<void>[] = [];
        if (config.get("panel.defaultLocation") !== "bottom") {
          updates.push(
            config.update(
              "panel.defaultLocation",
              "bottom",
              vscode.ConfigurationTarget.Global,
            ),
          );
        }
        if (config.get("panel.opensMaximized") !== "always") {
          updates.push(
            config.update(
              "panel.opensMaximized",
              "always",
              vscode.ConfigurationTarget.Global,
            ),
          );
        }
        if (config.get("activityBar.orientation") !== "vertical") {
          updates.push(
            config.update(
              "activityBar.orientation",
              "vertical",
              vscode.ConfigurationTarget.Global,
            ),
          );
        }
        const isCursor =
          typeof vscode.env.appName === "string" &&
          vscode.env.appName.includes("Cursor");
        if (
          isCursor &&
          config.get("panel.align") !== "justify"
        ) {
          updates.push(
            config.update(
              "panel.align",
              "justify",
              vscode.ConfigurationTarget.Global,
            ),
          );
        }
        await Promise.all(updates);
        return;
      }

      const repo = await repoManager.getCurrentRepo();
      if (!repo) return;
      const repoRoot = repo.rootUri.fsPath;
      const p = msg.params ?? {};

      const runCmd = async (
        fn: () => void | Promise<void>,
      ): Promise<void> => {
        try {
          await fn();
        } catch (err) {
          log.errorException(err, msg.command ?? "command");
          const errMsg = err instanceof Error ? err.message : String(err);
          void vscode.window.showErrorMessage(errMsg);
        }
      };

      switch (msg.command) {
        case "viewDiff": {
          const fromHash = typeof p.fromHash === "string" ? p.fromHash : "HEAD";
          const toHash = typeof p.toHash === "string" ? p.toHash : "HEAD";
          const oldPath = typeof p.oldFilePath === "string" ? p.oldFilePath : "";
          const newPath = typeof p.newFilePath === "string" ? p.newFilePath : oldPath;
          const status =
            p.type === "added"
              ? GitFileStatus.Added
              : p.type === "deleted"
                ? GitFileStatus.Deleted
                : GitFileStatus.Modified;
          const leftUri = encodeDiffDocUri(
            repoRoot,
            oldPath,
            fromHash,
            status,
            DiffSide.Old,
            toHash,
          );
          const rightUri = encodeDiffDocUri(
            repoRoot,
            newPath,
            toHash,
            status,
            DiffSide.New,
          );
          const title = `${path.basename(newPath || oldPath)} (${fromHash === DIFF_UNCOMMITTED ? "working" : fromHash.slice(0, 7)} ↔ ${toHash === DIFF_UNCOMMITTED ? "working" : toHash.slice(0, 7)})`;
          const diffOptions = (p.openInNewTab as boolean)
            ? { viewColumn: vscode.ViewColumn.Beside }
            : undefined;
          void vscode.commands.executeCommand(
            "vscode.diff",
            leftUri,
            rightUri,
            title,
            diffOptions,
          );
          break;
        }
        case "viewFileAtRevision": {
          const hash = typeof p.hash === "string" ? p.hash : "HEAD";
          const filePath = typeof p.filePath === "string" ? p.filePath : "";
          if (!filePath) break;
          const type =
            p.type === "deleted"
              ? GitFileStatus.Deleted
              : GitFileStatus.Modified;
          const uri = encodeDiffDocUri(
            repoRoot,
            filePath,
            hash,
            type,
            DiffSide.New,
          );
          void vscode.window.showTextDocument(uri);
          break;
        }
        case "openWorkingFile": {
          const filePath = typeof p.filePath === "string" ? p.filePath : "";
          if (!filePath) break;
          void vscode.window.showTextDocument(
            vscode.Uri.file(path.join(repoRoot, filePath)),
          );
          break;
        }
        case "revertWorkingFile": {
          const filePath = typeof p.filePath === "string" ? p.filePath : "";
          if (!filePath) break;
          await runCmd(async () => {
            runGitSync(repoRoot, ["checkout", "--", filePath]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "getFileFromRevision": {
          const commitHash =
            typeof p.commitHash === "string" ? p.commitHash.trim() : "";
          const filePath = typeof p.filePath === "string" ? p.filePath : "";
          if (!commitHash || !filePath) break;
          await runCmd(async () => {
            runGitSync(repoRoot, ["checkout", commitHash, "--", filePath]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "createPatchForFile": {
          const commitHash =
            typeof p.commitHash === "string" ? p.commitHash.trim() : "";
          const filePath = typeof p.filePath === "string" ? p.filePath : "";
          const oldFilePath =
            typeof p.oldFilePath === "string" ? p.oldFilePath : filePath;
          if (!commitHash || !filePath) break;
          await runCmd(async () => {
            const parent = getParentCommit(repoRoot, commitHash);
            const patch = runGitSync(repoRoot, [
              "diff",
              parent,
              commitHash,
              "--",
              oldFilePath,
              filePath,
            ], { maxBuffer: GIT_DIFF_MAX_BUFFER });
            const doc = await vscode.workspace.openTextDocument({
              content: patch,
              language: "diff",
            });
            void vscode.window.showTextDocument(doc, {
              viewColumn: vscode.ViewColumn.Beside,
            });
          });
          break;
        }
        case "cherryPickFile": {
          const commitHash =
            typeof p.commitHash === "string" ? p.commitHash.trim() : "";
          const filePath = typeof p.filePath === "string" ? p.filePath : "";
          if (!commitHash || !filePath) break;
          await runCmd(async () => {
            runGitSync(repoRoot, ["checkout", commitHash, "--", filePath]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "fileHistoryUpToCommit": {
          const commitHash =
            typeof p.commitHash === "string" ? p.commitHash.trim() : "";
          const filePath = typeof p.filePath === "string" ? p.filePath : "";
          if (!commitHash || !filePath) break;
          const fullPath = path.join(repoRoot, filePath);
          void vscode.commands
            .executeCommand("git.viewFileHistory", vscode.Uri.file(fullPath), commitHash)
            .then(
              () => {},
              () => {
                void vscode.window.showInformationMessage(
                  "Git: View File History may not be available. Try Timeline or Git History extension.",
                );
              },
            );
          break;
        }
        case "checkoutBranch": {
          const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
          if (!branchRef) break;
          await runCmd(async () => {
            runGitSync(repoRoot, ["checkout", getShortBranchName(branchRef)]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "createBranchFromContext":
          void panelProvider.runCreateBranchFromContext();
          break;
        case "deleteBranch": {
          const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
          if (!branchRef) break;
          const branchName = getShortBranchName(branchRef);
          const tryDelete = (force: boolean) => {
            runGitSync(repoRoot, ["branch", force ? "-D" : "-d", branchName]);
            panelProvider.notifyGitStateChanged();
          };
          try {
            tryDelete(false);
          } catch (err) {
            const errMessage = err instanceof Error ? err.message : String(err);
            const isNotMerged = /is not fully merged/i.test(errMessage);
            if (isNotMerged) {
              const forceDelete = vscode.l10n.t("deleteBranch.forceDelete");
              const cancel = vscode.l10n.t("deleteBranch.cancel");
              void vscode.window
                .showWarningMessage(
                  vscode.l10n.t("deleteBranch.notMerged", branchName),
                  { modal: true },
                  forceDelete,
                  cancel,
                )
                .then((choice) => {
                  if (choice === forceDelete) {
                    try {
                      tryDelete(true);
                      void vscode.window.showInformationMessage(
                        vscode.l10n.t("deleteBranch.deleted", branchName),
                      );
                    } catch (forceErr) {
                      log.errorException(forceErr, "deleteBranch (force)");
                      void vscode.window.showErrorMessage(
                        forceErr instanceof Error
                          ? forceErr.message
                          : String(forceErr),
                      );
                    }
                  }
                });
            } else {
              log.errorException(err, "deleteBranch");
              void vscode.window.showErrorMessage(errMessage);
            }
          }
          break;
        }
        case "deleteRemoteBranch": {
          const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
          const remote = typeof p.remote === "string" ? p.remote : "origin";
          if (!branchRef) break;
          await runCmd(async () => {
            runGitSync(repoRoot, [
              "push",
              remote,
              "--delete",
              getShortBranchName(branchRef),
            ]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "deleteTag": {
          const tagName = typeof p.tagName === "string" ? p.tagName.trim() : "";
          if (!tagName) break;
          await runCmd(async () => {
            runGitSync(repoRoot, ["tag", "-d", tagName]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "checkoutTag": {
          const tagName = typeof p.tagName === "string" ? p.tagName.trim() : "";
          if (!tagName) break;
          await runCmd(async () => {
            runGitSync(repoRoot, ["checkout", tagName]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "mergeTagIntoCurrent": {
          const tagName = typeof p.tagName === "string" ? p.tagName.trim() : "";
          if (!tagName) break;
          if (!repo.state.HEAD?.name) {
            void vscode.window.showErrorMessage(
              vscode.l10n.t("tagContext.noHead"),
            );
            break;
          }
          await runCmd(async () => {
            runGitSync(repoRoot, ["merge", tagName]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "pushTag": {
          const tagName = typeof p.tagName === "string" ? p.tagName.trim() : "";
          if (!tagName) break;
          await runCmd(async () => {
            runGitSync(repoRoot, ["push", "origin", tagName]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "checkoutAndRebase": {
          const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
          const ontoRef =
            typeof p.ontoBranchRef === "string" ? p.ontoBranchRef : "";
          if (!branchRef || !ontoRef) break;
          await runCmd(async () => {
            runGitSync(repoRoot, ["checkout", getShortBranchName(branchRef)]);
            runGitSync(repoRoot, ["rebase", getShortBranchName(ontoRef)]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "compareBranches": {
          const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
          const otherRef =
            typeof p.otherBranchRef === "string" ? p.otherBranchRef : "";
          if (!branchRef || !otherRef) break;
          await runCmd(async () => {
            const diffOut = runGitSync(repoRoot, [
              "diff",
              branchRef,
              otherRef,
            ], { maxBuffer: GIT_DIFF_MAX_BUFFER });
            const doc = await vscode.workspace.openTextDocument({
              content: diffOut,
              language: "diff",
            });
            void vscode.window.showTextDocument(doc, {
              viewColumn: vscode.ViewColumn.Beside,
            });
          });
          break;
        }
        case "showDiffWithWorkingTree": {
          const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
          if (!branchRef) break;
          await runCmd(async () => {
            const diffOut = runGitSync(repoRoot, ["diff", branchRef], {
              maxBuffer: GIT_DIFF_MAX_BUFFER,
            });
            const doc = await vscode.workspace.openTextDocument({
              content: diffOut,
              language: "diff",
            });
            void vscode.window.showTextDocument(doc, {
              viewColumn: vscode.ViewColumn.Beside,
            });
          });
          break;
        }
        case "rebaseOnto": {
          const toRebaseRef =
            typeof p.branchToRebaseRef === "string" ? p.branchToRebaseRef : "";
          const ontoRef =
            typeof p.ontoBranchRef === "string" ? p.ontoBranchRef : "";
          if (!toRebaseRef || !ontoRef) break;
          await runCmd(async () => {
            runGitSync(repoRoot, ["checkout", getShortBranchName(toRebaseRef)]);
            runGitSync(repoRoot, ["rebase", getShortBranchName(ontoRef)]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "mergeInto": {
          const sourceRef =
            typeof p.sourceBranchRef === "string" ? p.sourceBranchRef : "";
          const targetRef =
            typeof p.targetBranchRef === "string" ? p.targetBranchRef : "";
          if (!sourceRef || !targetRef) break;
          await runCmd(async () => {
            runGitSync(repoRoot, ["checkout", getShortBranchName(targetRef)]);
            runGitSync(repoRoot, ["merge", getShortBranchName(sourceRef)]);
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "pushBranch": {
          const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
          if (!branchRef) break;
          await runCmd(async () => {
            const branchName = getShortBranchName(branchRef);
            if (typeof repo.push === "function") {
              await repo.push("origin", branchName);
            } else {
              runGitSync(repoRoot, ["push", "origin", branchName]);
            }
            panelProvider.notifyGitStateChanged();
          });
          break;
        }
        case "renameBranch": {
          const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
          if (!branchRef) break;
          const oldName = getShortBranchName(branchRef);
          const newName = await vscode.window.showInputBox({
            title: vscode.l10n.t("renameBranch.title"),
            prompt: vscode.l10n.t("renameBranch.prompt"),
            value: oldName,
            validateInput(value) {
              if (!value?.trim()) return vscode.l10n.t("renameBranch.nameEmpty");
              return null;
            },
          });
          if (
            newName == null ||
            newName.trim() === "" ||
            newName.trim() === oldName
          )
            break;
          await runCmd(async () => {
            runGitSync(repoRoot, ["branch", "-m", oldName, newName.trim()]);
            panelProvider.notifyGitStateChanged();
            void vscode.window.showInformationMessage(
              vscode.l10n.t("renameBranch.renamed", newName.trim()),
            );
          });
          break;
        }
        case "editCommitMessage": {
          const commitHash =
            typeof p.commitHash === "string" ? p.commitHash.trim() : "";
          const message = typeof p.message === "string" ? p.message : "";
          if (!commitHash) break;
          if (repo.state.HEAD?.commit !== commitHash) {
            void vscode.window.showWarningMessage(
              vscode.l10n.t("editCommit.onlyHead"),
            );
            break;
          }
          const newMessage = await vscode.window.showInputBox({
            title: vscode.l10n.t("editCommit.title"),
            prompt: vscode.l10n.t("editCommit.prompt"),
            value: message,
            validateInput(value) {
              if (!value?.trim())
                return vscode.l10n.t("editCommit.messageEmpty");
              return null;
            },
          });
          if (newMessage == null || newMessage.trim() === "") break;
          await runCmd(async () => {
            runGitSync(repoRoot, [
              "commit",
              "--amend",
              "-m",
              newMessage.trim(),
            ]);
            panelProvider.notifyGitStateChanged();
            void vscode.window.showInformationMessage(
              vscode.l10n.t("editCommit.done"),
            );
          });
          break;
        }
        default:
          break;
      }
      return;
    }

    if (msg.type === "request" && msg.requestId && msg.method) {
      const method = msg.method;
      const repo =
        method === "initRepo"
          ? null
          : await repoManager.getCurrentRepo();
      const result = await handleApiRequest(method, msg.params, repo);
      webviewView.webview.postMessage({
        type: "response",
        requestId: msg.requestId,
        data: result.data,
        error: result.error,
      });
    }
  };

  return webviewView.webview.onDidReceiveMessage(handleMessage);
}
