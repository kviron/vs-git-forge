/**
 * Дерево «Branch Diff»: список файлов с отличиями между веткой и рабочим деревом.
 * Отображается как проводник (те же иконки, что и Changed Files). По клику — diff в редакторе.
 */

import * as path from "path";
import * as vscode from "vscode";
import type { WebviewChangedFile } from "../types/webview";
import type { ChangedFileTreeNode } from "../types/webview";
import { GIT_STATUS_THEME_IDS } from "../types/git";
import { getDiffNameStatusWorktree } from "../git/shell";
import { getShortBranchName } from "../git/remote";

/** Узел дерева Branch Diff: заголовок (две строки — текст и кнопка своп) или папка/файл */
export type BranchDiffTreeNode =
  | ChangedFileTreeNode
  | { kind: "headerText" }
  | { kind: "headerSwap" };

/** Декорации для дерева Branch Diff: подсветка по переданному статусу (актуальный diff). */
export class BranchDiffDecorationProvider
  implements vscode.FileDecorationProvider
{
  private _onDidChangeFileDecorations =
    new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations =
    this._onDidChangeFileDecorations.event;

  private uriToStatus = new Map<string, "added" | "modified" | "deleted">();

  setUriStatuses(
    repoRoot: string,
    files: WebviewChangedFile[],
    virtualPrefix: string,
  ): void {
    this.uriToStatus.clear();
    const norm = (p: string) => p.replace(/\\/g, "/");
    for (const f of files) {
      const virtualPath = path.normalize(
        path.join(repoRoot, virtualPrefix, norm(f.path)),
      );
      this.uriToStatus.set(virtualPath, f.status ?? "modified");
    }
    const uris = Array.from(this.uriToStatus.keys(), (p) =>
      vscode.Uri.file(p),
    );
    this._onDidChangeFileDecorations.fire(uris);
  }

  provideFileDecoration(
    uri: vscode.Uri,
  ): vscode.ProviderResult<vscode.FileDecoration> {
    const key = path.normalize(uri.fsPath);
    const status = this.uriToStatus.get(key);
    if (!status) {
      return undefined;
    }
    const themeId = GIT_STATUS_THEME_IDS[status];
    return { color: new vscode.ThemeColor(themeId) };
  }
}

export class BranchDiffTreeProvider
  implements vscode.TreeDataProvider<BranchDiffTreeNode>
{
  static readonly VIRTUAL_PREFIX = ".gitforge-branch-diff";

  private _onDidChangeTreeData = new vscode.EventEmitter<
    BranchDiffTreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private files: WebviewChangedFile[] = [];
  private repoRoot: string | null = null;
  private branchRef: string | null = null;
  private currentBranchName: string | null = null;
  private reversed = false;

  constructor(
    private readonly decorationProvider: BranchDiffDecorationProvider,
  ) {}

  private normalize(p: string): string {
    return p.replace(/\\/g, "/");
  }

  private getFileCountInFolder(folderPath: string): number {
    const prefix = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;
    return this.files.filter((f) => f.path.startsWith(prefix)).length;
  }

  /**
   * Установить данные: ветка и репозиторий. Список файлов получается через git diff ref.
   */
  setData(repoRoot: string, branchRef: string, currentBranchName?: string): void {
    this.repoRoot = repoRoot;
    this.branchRef = branchRef;
    this.currentBranchName = currentBranchName ?? null;
    try {
      this.files = getDiffNameStatusWorktree(repoRoot, branchRef).map((f) => ({
        ...f,
        path: this.normalize(f.path),
      }));
    } catch {
      this.files = [];
    }
    this.decorationProvider.setUriStatuses(
      repoRoot,
      this.files,
      BranchDiffTreeProvider.VIRTUAL_PREFIX,
    );
    void vscode.commands.executeCommand(
      "setContext",
      "gitForge.branchDiffActive",
      true,
    );
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.repoRoot = null;
    this.branchRef = null;
    this.currentBranchName = null;
    this.files = [];
    this.decorationProvider.setUriStatuses(
      "",
      [],
      BranchDiffTreeProvider.VIRTUAL_PREFIX,
    );
    void vscode.commands.executeCommand(
      "setContext",
      "gitForge.branchDiffActive",
      false,
    );
    this._onDidChangeTreeData.fire();
  }

  getBranchRef(): string | null {
    return this.branchRef;
  }

  getReversed(): boolean {
    return this.reversed;
  }

  setReversed(value: boolean): void {
    if (this.reversed === value) return;
    this.reversed = value;
    this._onDidChangeTreeData.fire();
  }

  getRepoRoot(): string | null {
    return this.repoRoot;
  }

  getChildren(element?: BranchDiffTreeNode): BranchDiffTreeNode[] {
    if (element?.kind === "headerText" || element?.kind === "headerSwap") {
      return [];
    }

    const prefix = element
      ? element.kind === "folder"
        ? `${element.path}/`
        : undefined
      : "";
    if (prefix === undefined) {
      return [];
    }

    if (!prefix) {
      const fileFolderItems: ChangedFileTreeNode[] = [];
      const seen = new Set<string>();
      for (const f of this.files) {
        const rest = f.path;
        const nextSlash = rest.indexOf("/");
        if (nextSlash === -1) {
          fileFolderItems.push({
            kind: "file",
            path: f.path,
            name: f.name,
            status: f.status ?? "modified",
            oldPath: f.oldPath,
          });
        } else {
          const segment = rest.slice(0, nextSlash);
          if (seen.has(segment)) {
            continue;
          }
          seen.add(segment);
          fileFolderItems.push({ kind: "folder", path: segment, segment });
        }
      }
      fileFolderItems.sort((a, b) => {
        const aLabel = a.kind === "folder" ? a.segment : a.name;
        const bLabel = b.kind === "folder" ? b.segment : b.name;
        const aIsFolder = a.kind === "folder";
        const bIsFolder = b.kind === "folder";
        if (aIsFolder !== bIsFolder) {
          return (bIsFolder ? 1 : 0) - (aIsFolder ? 1 : 0);
        }
        return aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" });
      });
      if (this.branchRef && this.currentBranchName != null) {
        return [
          { kind: "headerText" },
          { kind: "headerSwap" },
          ...fileFolderItems,
        ];
      }
      return fileFolderItems;
    }

    const items: BranchDiffTreeNode[] = [];
    const seen = new Set<string>();
    for (const f of this.files) {
      if (!f.path.startsWith(prefix)) {
        continue;
      }
      const rest = f.path.slice(prefix.length);
      const nextSlash = rest.indexOf("/");
      if (nextSlash === -1) {
        items.push({
          kind: "file",
          path: f.path,
          name: f.name,
          status: f.status ?? "modified",
          oldPath: f.oldPath,
        });
      } else {
        const segment = rest.slice(0, nextSlash);
        if (seen.has(segment)) {
          continue;
        }
        seen.add(segment);
        items.push({
          kind: "folder",
          path: prefix + segment,
          segment,
        });
      }
    }
    items.sort((a, b) => {
      const aLabel =
        a.kind === "headerText" || a.kind === "headerSwap"
          ? ""
          : a.kind === "folder"
            ? a.segment
            : a.name;
      const bLabel =
        b.kind === "headerText" || b.kind === "headerSwap"
          ? ""
          : b.kind === "folder"
            ? b.segment
            : b.name;
      const aIsFolder = a.kind === "folder";
      const bIsFolder = b.kind === "folder";
      if (aIsFolder !== bIsFolder) {
        return (bIsFolder ? 1 : 0) - (aIsFolder ? 1 : 0);
      }
      return aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" });
    });
    return items;
  }

  getParent(
    element: BranchDiffTreeNode,
  ): vscode.ProviderResult<BranchDiffTreeNode> {
    if (element.kind === "headerText" || element.kind === "headerSwap") {
      return undefined;
    }
    const idx = element.path.lastIndexOf("/");
    if (idx <= 0) {
      return undefined;
    }
    const parentPath = element.path.slice(0, idx);
    const segment = parentPath.includes("/")
      ? parentPath.slice(parentPath.lastIndexOf("/") + 1)
      : parentPath;
    return { kind: "folder", path: parentPath, segment };
  }

  /** Заголовок: порядок как в diff — слева рабочее дерево (текущая ветка), справа выбранная ветка. */
  private getHeaderLabel(): string {
    const branchName = this.branchRef
      ? getShortBranchName(this.branchRef)
      : "";
    const workingTreeBranch = this.currentBranchName ?? "HEAD";
    if (this.reversed) {
      return `${branchName} ↔ ${workingTreeBranch}`;
    }
    return `${workingTreeBranch} ↔ ${branchName}`;
  }

  getTreeItem(element: BranchDiffTreeNode): vscode.TreeItem {
    if (element.kind === "headerText") {
      const fullText = this.getHeaderLabel();
      const item = new vscode.TreeItem(
        fullText,
        vscode.TreeItemCollapsibleState.None,
      );
      item.tooltip = fullText;
      item.contextValue = "branchDiffHeaderText";
      return item;
    }
    if (element.kind === "headerSwap") {
      const isRu = vscode.env.language.startsWith("ru");
      const swapText = isRu ? "Поменять ветки" : "Swap branches";
      const item = new vscode.TreeItem(
        swapText,
        vscode.TreeItemCollapsibleState.None,
      );
      item.contextValue = "branchDiffHeaderSwap";
      item.iconPath = new vscode.ThemeIcon("arrow-swap");
      item.command = {
        command: "vs-git-forge.branchDiffSwap",
        title: swapText,
      };
      return item;
    }

    const virtualPath =
      this.repoRoot != null
        ? path.join(
            this.repoRoot,
            BranchDiffTreeProvider.VIRTUAL_PREFIX,
            element.path,
          )
        : null;

    if (element.kind === "folder") {
      const item = new vscode.TreeItem(
        element.segment,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = "folder";
      const count = this.getFileCountInFolder(element.path);
      const oneFile = vscode.l10n.t("branchDiff.oneFile", "1 file");
      const filesCount = vscode.l10n.t("branchDiff.filesCount", "{0} files", String(count));
      const isRu = vscode.env.language.startsWith("ru");
      item.description =
        count === 1
          ? oneFile === "branchDiff.oneFile"
            ? isRu ? "1 файл" : "1 file"
            : oneFile
          : filesCount === "branchDiff.filesCount"
            ? isRu ? `${count} файлов` : `${count} files`
            : filesCount;
      if (virtualPath != null) {
        item.resourceUri = vscode.Uri.file(virtualPath);
      } else {
        item.iconPath = new vscode.ThemeIcon("folder");
      }
      return item;
    }

    const item = new vscode.TreeItem(element.name);
    item.description = element.status ?? "modified";
    if (virtualPath != null) {
      item.resourceUri = vscode.Uri.file(virtualPath);
    } else {
      const iconId =
        element.status === "added"
          ? "git-add"
          : element.status === "deleted"
            ? "git-delete"
            : "git-modified";
      item.iconPath = new vscode.ThemeIcon(iconId);
    }
    item.contextValue =
      element.status === "deleted" ? "fileDeleted" : "file";

    if (this.repoRoot && this.branchRef && element.kind === "file") {
      item.command = {
        command: "vs-git-forge.branchDiffDiffOnDoubleClick",
        title: vscode.l10n.t("command.openDiff.title"),
        arguments: [
          this.repoRoot,
          this.branchRef,
          element.path,
          element.status ?? "modified",
          element.oldPath,
        ],
      };
    }
    return item;
  }
}
