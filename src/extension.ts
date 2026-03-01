// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

class GitForgeTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	getChildren(): vscode.TreeItem[] {
		return [
			new vscode.TreeItem('Добро пожаловать в Git Forge', vscode.TreeItemCollapsibleState.None),
		];
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Extension "vs-git-forge" is now active!');

	const treeProvider = new GitForgeTreeProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('vs-git-forge.gitForgeView', treeProvider)
	);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('vs-git-forge.gitForgeSidebarView', treeProvider)
	);

	const cmdDisposable = vscode.commands.registerCommand('vs-git-forge.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Git Forge!');
	});
	context.subscriptions.push(cmdDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
