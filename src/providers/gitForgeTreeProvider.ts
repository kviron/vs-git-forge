import * as vscode from "vscode";

/** Простой tree provider для placeholder (дерево приветствия). */
export class GitForgeTreeProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  getChildren(): vscode.TreeItem[] {
    return [
      new vscode.TreeItem(
        vscode.l10n.t("tree.welcome"),
        vscode.TreeItemCollapsibleState.None,
      ),
    ];
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }
}
