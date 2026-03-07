import * as path from "path";
import * as vscode from "vscode";
import type { WebviewChangedFile } from "../types/webview";
import { GIT_STATUS_THEME_IDS } from "../types/git";
import type { ChangedFileTreeNode } from "../types/webview";

/** Провайдер декораций для дерева Changed Files: подсветка по статусу из коммита */
export class ChangedFilesDecorationProvider
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
    if (!status) return undefined;
    const themeId = GIT_STATUS_THEME_IDS[status];
    return { color: new vscode.ThemeColor(themeId) };
  }
}

/** Провайдер нативного дерева «Changed Files» в стиле проводника VS Code */
export class ChangedFilesTreeProvider
  implements vscode.TreeDataProvider<ChangedFileTreeNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ChangedFileTreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private files: WebviewChangedFile[] = [];
  private commitHash: string | null = null;
  private repoRoot: string | null = null;

  static readonly VIRTUAL_PREFIX = ".gitforge-tree";

  constructor(
    private readonly decorationProvider: ChangedFilesDecorationProvider,
  ) {}

  private normalize(p: string): string {
    return p.replace(/\\/g, "/");
  }

  private getFileCountInFolder(folderPath: string): number {
    const prefix = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;
    return this.files.filter((f) => f.path.startsWith(prefix)).length;
  }

  setData(
    commitHash: string | null,
    files: WebviewChangedFile[],
    repoRoot?: string,
    _commitInfo?: unknown,
  ): void {
    this.commitHash = commitHash;
    this.repoRoot = repoRoot ?? null;
    this.files = files.map((f) => ({
      ...f,
      path: this.normalize(f.path),
    }));
    if (this.repoRoot != null) {
      this.decorationProvider.setUriStatuses(
        this.repoRoot,
        this.files,
        ChangedFilesTreeProvider.VIRTUAL_PREFIX,
      );
    } else {
      this.decorationProvider.setUriStatuses(
        "",
        [],
        ChangedFilesTreeProvider.VIRTUAL_PREFIX,
      );
    }
    this._onDidChangeTreeData.fire();
  }

  getChildren(element?: ChangedFileTreeNode): ChangedFileTreeNode[] {
    const prefix = element
      ? element.kind === "folder"
        ? `${element.path}/`
        : undefined
      : "";
    if (prefix === undefined) return [];

    if (!prefix) {
      const items: ChangedFileTreeNode[] = [];
      const seen = new Set<string>();
      for (const f of this.files) {
        const rest = f.path;
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
          if (seen.has(segment)) continue;
          seen.add(segment);
          items.push({ kind: "folder", path: segment, segment });
        }
      }
      items.sort((a, b) => {
        const aLabel = a.kind === "folder" ? a.segment : a.name;
        const bLabel = b.kind === "folder" ? b.segment : b.name;
        const aIsFolder = a.kind === "folder";
        const bIsFolder = b.kind === "folder";
        if (aIsFolder !== bIsFolder)
          return (bIsFolder ? 1 : 0) - (aIsFolder ? 1 : 0);
        return aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" });
      });
      return items;
    }

    const items: ChangedFileTreeNode[] = [];
    const seen = new Set<string>();
    for (const f of this.files) {
      if (!f.path.startsWith(prefix)) continue;
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
        if (seen.has(segment)) continue;
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
        a.kind === "folder" ? a.segment : a.kind === "file" ? a.name : "";
      const bLabel =
        b.kind === "folder" ? b.segment : b.kind === "file" ? b.name : "";
      const aIsFolder = a.kind === "folder";
      const bIsFolder = b.kind === "folder";
      if (aIsFolder !== bIsFolder)
        return (bIsFolder ? 1 : 0) - (aIsFolder ? 1 : 0);
      return aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" });
    });
    return items;
  }

  getParent(
    element: ChangedFileTreeNode,
  ): vscode.ProviderResult<ChangedFileTreeNode> {
    const idx = element.path.lastIndexOf("/");
    if (idx <= 0) return undefined;
    const parentPath = element.path.slice(0, idx);
    const segment = parentPath.includes("/")
      ? parentPath.slice(parentPath.lastIndexOf("/") + 1)
      : parentPath;
    return { kind: "folder", path: parentPath, segment };
  }

  getTreeItem(element: ChangedFileTreeNode): vscode.TreeItem {
    const virtualPath =
      this.repoRoot != null
        ? path.join(
            this.repoRoot,
            ChangedFilesTreeProvider.VIRTUAL_PREFIX,
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
      item.description = count === 1 ? "1 file" : `${count} files`;
      if (virtualPath != null) {
        item.resourceUri = vscode.Uri.file(virtualPath);
      } else {
        item.iconPath = new vscode.ThemeIcon("folder");
      }
      return item;
    }
    const item = new vscode.TreeItem(element.name);
    item.description = element.status;
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
    if (this.commitHash && element.kind === "file") {
      item.command = {
        command: "vs-git-forge.changedFileDiffOnDoubleClick",
        title: vscode.l10n.t("command.openDiff.title"),
        arguments: [
          this.commitHash,
          element.path,
          element.status ?? "modified",
          element.oldPath,
        ],
      };
    }
    return item;
  }

  getCurrentCommitHash(): string | null {
    return this.commitHash;
  }

  getRepoRoot(): string | null {
    return this.repoRoot;
  }

  getFileByPath(filePath: string): WebviewChangedFile | undefined {
    const norm = this.normalize(filePath);
    return this.files.find((f) => this.normalize(f.path) === norm);
  }

  getFilePathFromUri(uri: vscode.Uri): string | null {
    if (!this.repoRoot) return null;
    const prefix = path.join(
      this.repoRoot,
      ChangedFilesTreeProvider.VIRTUAL_PREFIX,
    );
    const fsPath = path.normalize(uri.fsPath);
    if (!fsPath.startsWith(prefix + path.sep) && fsPath !== prefix) return null;
    const relative = fsPath
      .slice(prefix.length)
      .replace(/^[/\\]/, "")
      .replace(/\\/g, "/");
    return relative || null;
  }
}
