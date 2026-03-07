import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  encodeDiffDocUri,
  DiffSide,
  GitFileStatus,
  UNCOMMITTED as DIFF_UNCOMMITTED,
} from "../diffDocProvider";
import { getParentCommit, runGitSync } from "../git/shell";
import { GIT_DIFF_MAX_BUFFER } from "../constants";
import { log } from "../core/logger";
import type { WebviewChangedFile } from "../types/webview";
import type { ChangedFileTreeNode } from "../types/webview";
import type { ChangedFilesTreeProvider } from "../tree/changedFilesTree";

export interface ChangedFileContext {
  repoRoot: string;
  commitHash: string;
  file: WebviewChangedFile;
  fromHash: string;
  toHash: string;
}

function webviewStatusToGitFileStatus(
  status: "added" | "modified" | "deleted",
): GitFileStatus {
  return status === "added"
    ? GitFileStatus.Added
    : status === "deleted"
      ? GitFileStatus.Deleted
      : GitFileStatus.Modified;
}

export interface RegisterChangedFileCommandsDeps {
  repoManager: { getCurrentRepo(): Promise<{ rootUri: { fsPath: string } } | null> };
  changedFilesTreeProvider: ChangedFilesTreeProvider;
  changedFilesTreeView: vscode.TreeView<ChangedFileTreeNode>;
  gitForgeProvider: { notifyGitStateChanged(): void };
}

/**
 * Регистрирует команды для дерева Changed Files и openChangedFileDiff.
 */
export function registerChangedFileCommands(
  context: vscode.ExtensionContext,
  deps: RegisterChangedFileCommandsDeps,
): void {
  const {
    repoManager,
    changedFilesTreeProvider,
    changedFilesTreeView,
    gitForgeProvider,
  } = deps;

  function getContextFromNode(
    node: ChangedFileTreeNode,
  ): ChangedFileContext | null {
    if (node.kind !== "file") return null;
    const file: WebviewChangedFile = {
      path: node.path,
      name: node.name,
      status: node.status ?? "modified",
      oldPath: node.oldPath,
    };
    const repoRoot = changedFilesTreeProvider.getRepoRoot();
    if (!repoRoot) return null;
    const commitHash = changedFilesTreeProvider.getCurrentCommitHash();
    if (!commitHash) return null;
    const isUncommitted = commitHash === "UNCOMMITTED";
    const fromHash = isUncommitted
      ? "HEAD"
      : getParentCommit(repoRoot, commitHash);
    const toHash = isUncommitted ? DIFF_UNCOMMITTED : commitHash;
    return { repoRoot, commitHash, file, fromHash, toHash };
  }

  function getChangedFileContextFromTree(): ChangedFileContext | null {
    const sel = changedFilesTreeView.selection as ChangedFileTreeNode[];
    if (!sel.length) return null;
    return getContextFromNode(sel[0]);
  }

  function getChangedFileContext(
    nodeOrNothing: ChangedFileTreeNode | undefined,
  ): ChangedFileContext | null {
    if (nodeOrNothing != null) {
      const ctx = getContextFromNode(nodeOrNothing);
      if (ctx) return ctx;
    }
    return getChangedFileContextFromTree();
  }

  function registerChangedFileContextCommand(
    id: string,
    run: (ctx: ChangedFileContext) => void | Promise<void>,
  ): void {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        id,
        async (node: ChangedFileTreeNode | undefined) => {
          const ctx = getChangedFileContext(node);
          if (!ctx) return;
          if (node != null) {
            await changedFilesTreeView.reveal(node, {
              select: true,
              focus: true,
            });
          }
          await run(ctx);
        },
      ),
    );
  }

  context.subscriptions.push(
    changedFilesTreeView.onDidChangeSelection((e) => {
      const sel = e.selection as ChangedFileTreeNode[];
      if (!sel.length || sel[0].kind !== "file") return;
      void changedFilesTreeView.reveal(sel[0], {
        select: true,
        focus: false,
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vs-git-forge.openChangedFileDiff",
      async (
        commitHash: string,
        filePath: string,
        status: "added" | "modified" | "deleted",
        oldFilePath?: string,
      ) => {
        const repo = await repoManager.getCurrentRepo();
        if (!repo) return;
        const root = repo.rootUri.fsPath;
        let fromHash: string;
        let toHash: string;
        if (commitHash === "UNCOMMITTED") {
          fromHash = "HEAD";
          toHash = DIFF_UNCOMMITTED;
        } else {
          fromHash = getParentCommit(root, commitHash);
          toHash = commitHash;
        }
        const statusEnum = webviewStatusToGitFileStatus(status);
        const leftPath = oldFilePath ?? filePath;
        const leftUri = encodeDiffDocUri(
          root,
          leftPath,
          fromHash,
          statusEnum,
          DiffSide.Old,
          toHash,
        );
        const rightUri = encodeDiffDocUri(
          root,
          filePath,
          toHash,
          statusEnum,
          DiffSide.New,
        );
        const title = `${path.basename(filePath)} (${fromHash.slice(0, 7)} ↔ ${toHash === DIFF_UNCOMMITTED ? "working" : toHash.slice(0, 7)})`;
        void vscode.commands.executeCommand(
          "vscode.diff",
          leftUri,
          rightUri,
          title,
        );
      },
    ),
  );

  const DOUBLE_CLICK_MS = 400;
  let lastClickedFile: string | null = null;
  let lastClickedTime = 0;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vs-git-forge.changedFileDiffOnDoubleClick",
      (
        commitHash: string,
        filePath: string,
        status: "added" | "modified" | "deleted",
        oldPath?: string,
      ) => {
        const now = Date.now();
        const isDoubleClick =
          lastClickedFile === filePath && now - lastClickedTime < DOUBLE_CLICK_MS;
        lastClickedFile = filePath;
        lastClickedTime = now;
        if (isDoubleClick) {
          lastClickedFile = null;
          void vscode.commands.executeCommand(
            "vs-git-forge.openChangedFileDiff",
            commitHash,
            filePath,
            status,
            oldPath,
          );
        }
      },
    ),
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileShowDiff",
    ({ repoRoot, file, fromHash, toHash }) => {
      const status = webviewStatusToGitFileStatus(file.status ?? "modified");
      const oldPath = file.oldPath ?? file.path;
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
        file.path,
        toHash,
        status,
        DiffSide.New,
      );
      const title = `${path.basename(file.path)} (${fromHash.slice(0, 7)} ↔ ${toHash === DIFF_UNCOMMITTED ? "working" : toHash.slice(0, 7)})`;
      void vscode.commands.executeCommand(
        "vscode.diff",
        leftUri,
        rightUri,
        title,
      );
    },
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileShowDiffNewTab",
    ({ repoRoot, file, fromHash, toHash }) => {
      const status = webviewStatusToGitFileStatus(file.status ?? "modified");
      const oldPath = file.oldPath ?? file.path;
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
        file.path,
        toHash,
        status,
        DiffSide.New,
      );
      const title = `${path.basename(file.path)} (${fromHash.slice(0, 7)} ↔ ${toHash === DIFF_UNCOMMITTED ? "working" : toHash.slice(0, 7)})`;
      void vscode.commands.executeCommand(
        "vscode.diff",
        leftUri,
        rightUri,
        title,
        { viewColumn: vscode.ViewColumn.Beside },
      );
    },
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileCompareWithLocal",
    (ctx) => {
      if (ctx.commitHash === "UNCOMMITTED") return;
      const status = webviewStatusToGitFileStatus(ctx.file.status ?? "modified");
      const oldPath = ctx.file.oldPath ?? ctx.file.path;
      const leftUri = encodeDiffDocUri(
        ctx.repoRoot,
        oldPath,
        ctx.commitHash,
        status,
        DiffSide.Old,
        DIFF_UNCOMMITTED,
      );
      const rightUri = encodeDiffDocUri(
        ctx.repoRoot,
        ctx.file.path,
        DIFF_UNCOMMITTED,
        status,
        DiffSide.New,
      );
      const title = `${path.basename(ctx.file.path)} (${ctx.commitHash.slice(0, 7)} ↔ working)`;
      void vscode.commands.executeCommand(
        "vscode.diff",
        leftUri,
        rightUri,
        title,
      );
    },
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileCompareBeforeWithLocal",
    (ctx) => {
      if (ctx.commitHash === "UNCOMMITTED") return;
      const status = webviewStatusToGitFileStatus(ctx.file.status ?? "modified");
      const oldPath = ctx.file.oldPath ?? ctx.file.path;
      const leftUri = encodeDiffDocUri(
        ctx.repoRoot,
        oldPath,
        ctx.fromHash,
        status,
        DiffSide.Old,
        DIFF_UNCOMMITTED,
      );
      const rightUri = encodeDiffDocUri(
        ctx.repoRoot,
        ctx.file.path,
        DIFF_UNCOMMITTED,
        status,
        DiffSide.New,
      );
      const title = `${path.basename(ctx.file.path)} (before ↔ working)`;
      void vscode.commands.executeCommand(
        "vscode.diff",
        leftUri,
        rightUri,
        title,
      );
    },
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileEditSource",
    async (ctx) => {
      if (ctx.file.status === "deleted") return;
      const fullPath = path.join(ctx.repoRoot, ctx.file.path);
      if (!fs.existsSync(fullPath)) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t("changedFile.editSource.fileNotFound", path.basename(ctx.file.path)),
        );
        return;
      }
      try {
        await vscode.window.showTextDocument(vscode.Uri.file(fullPath), {
          preserveFocus: false,
        });
      } catch (err) {
        log.errorException(err, "changedFileEditSource");
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileOpenRepoVersion",
    (ctx) => {
      if (ctx.commitHash === "UNCOMMITTED") return;
      const status =
        ctx.file.status === "deleted"
          ? GitFileStatus.Deleted
          : GitFileStatus.Modified;
      const uri = encodeDiffDocUri(
        ctx.repoRoot,
        ctx.file.path,
        ctx.commitHash,
        status,
        DiffSide.New,
      );
      void vscode.window.showTextDocument(uri);
    },
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileRevert",
    (ctx) => {
      if (ctx.commitHash !== "UNCOMMITTED") return;
      try {
        runGitSync(ctx.repoRoot, ["checkout", "--", ctx.file.path]);
        gitForgeProvider.notifyGitStateChanged();
      } catch (err) {
        log.errorException(err, "changedFileRevert");
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileCherryPick",
    (ctx) => {
      if (ctx.commitHash === "UNCOMMITTED") return;
      try {
        runGitSync(ctx.repoRoot, [
          "checkout",
          ctx.commitHash,
          "--",
          ctx.file.path,
        ]);
        gitForgeProvider.notifyGitStateChanged();
      } catch (err) {
        log.errorException(err, "changedFileCherryPick");
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileCreatePatch",
    async (ctx) => {
      if (ctx.commitHash === "UNCOMMITTED") return;
      try {
        const patch = runGitSync(
          ctx.repoRoot,
          [
            "diff",
            ctx.fromHash,
            ctx.commitHash,
            "--",
            ctx.file.oldPath ?? ctx.file.path,
            ctx.file.path,
          ],
          { maxBuffer: GIT_DIFF_MAX_BUFFER },
        );
        const doc = await vscode.workspace.openTextDocument({
          content: patch,
          language: "diff",
        });
        void vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
        });
      } catch (err) {
        log.errorException(err, "changedFileCreatePatch");
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileGetFromRevision",
    (ctx) => {
      if (ctx.commitHash === "UNCOMMITTED") return;
      try {
        runGitSync(ctx.repoRoot, [
          "checkout",
          ctx.commitHash,
          "--",
          ctx.file.path,
        ]);
        gitForgeProvider.notifyGitStateChanged();
      } catch (err) {
        log.errorException(err, "changedFileGetFromRevision");
        void vscode.window.showErrorMessage(
          err instanceof Error ? err.message : String(err),
        );
      }
    },
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileHistoryUpToHere",
    (ctx) => {
      if (ctx.commitHash === "UNCOMMITTED") return;
      const uri = vscode.Uri.file(path.join(ctx.repoRoot, ctx.file.path));
      void vscode.commands
        .executeCommand("git.viewFileHistory", uri, ctx.commitHash)
        .then(
          () => {},
          () => {
            void vscode.window.showInformationMessage(
              "Git: View File History may not be available.",
            );
          },
        );
    },
  );

  registerChangedFileContextCommand(
    "vs-git-forge.changedFileShowChangesToParents",
    (ctx) => {
      if (ctx.commitHash === "UNCOMMITTED") return;
      const status = webviewStatusToGitFileStatus(ctx.file.status ?? "modified");
      const oldPath = ctx.file.oldPath ?? ctx.file.path;
      const leftUri = encodeDiffDocUri(
        ctx.repoRoot,
        oldPath,
        ctx.fromHash,
        status,
        DiffSide.Old,
        ctx.commitHash,
      );
      const rightUri = encodeDiffDocUri(
        ctx.repoRoot,
        ctx.file.path,
        ctx.commitHash,
        status,
        DiffSide.New,
      );
      const title = `${path.basename(ctx.file.path)} (parent ↔ ${ctx.commitHash.slice(0, 7)})`;
      void vscode.commands.executeCommand(
        "vscode.diff",
        leftUri,
        rightUri,
        title,
      );
    },
  );
}
