// The module 'vscode' contains the VS Code extensibility API
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

/** Обновляет пункт в статус-баре: иконка + имя ветки. */
function updateBranchStatusBar(item: vscode.StatusBarItem, branch: string | undefined): void {
	if (branch) {
		item.text = `$(git-branch) ${branch}`;
		item.tooltip = `Ветка: ${branch}. Нажми, чтобы открыть Git Forge`;
		item.command = 'vs-git-forge.openGitForge';
		item.show();
	} else {
		item.hide();
	}
}

/** Читает имя ветки из .git/HEAD (работает без встроенного Git-расширения, в т.ч. в Cursor). */
async function getBranchFromGitHead(): Promise<string | undefined> {
	const folders = vscode.workspace.workspaceFolders;
	if (!folders?.length) return undefined;
	for (const folder of folders) {
		const headPath = vscode.Uri.joinPath(folder.uri, '.git', 'HEAD');
		try {
			const data = await vscode.workspace.fs.readFile(headPath);
			const content = new TextDecoder().decode(data).trim();
			const match = /^ref: refs\/heads\/(.+)$/.exec(content);
			if (match) return match[1];
		} catch {
			// файла нет или не репозиторий
		}
	}
	return undefined;
}

let branchStatusBarSubscribed = false;

/** Подписывается на Git через API (VS Code) и обновляет статус-бар. Возвращает true, если удалось. */
async function initBranchStatusBarFromApi(
	context: vscode.ExtensionContext,
	item: vscode.StatusBarItem
): Promise<boolean> {
	const gitExtension = vscode.extensions.getExtension<{ getAPI(version: number): GitAPI }>('vscode.git');
	if (!gitExtension) return false;
	let git: GitAPI;
	try {
		git = gitExtension.isActive ? gitExtension.exports.getAPI(1) : (await gitExtension.activate()).getAPI(1);
	} catch {
		return false;
	}
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
			git.onDidOpenRepository((repo: { state: { onDidChange(fn: () => void): vscode.Disposable } }) => {
				context.subscriptions.push(repo.state.onDidChange(update));
			})
		);
	}
	return true;
}

/** Показывает ветку в статус-баре: сначала пробуем API, иначе читаем .git/HEAD. */
async function initBranchStatusBar(
	context: vscode.ExtensionContext,
	item: vscode.StatusBarItem
): Promise<boolean> {
	const fromApi = await initBranchStatusBarFromApi(context, item);
	if (fromApi) return true;
	const branch = await getBranchFromGitHead();
	updateBranchStatusBar(item, branch);
	return !!branch;
}

// Минимальные типы для встроенного Git API
interface GitAPI {
	readonly repositories: ReadonlyArray<{
		state: { HEAD?: { name?: string }; onDidChange(fn: () => void): vscode.Disposable };
	}>;
	onDidOpenRepository(fn: (repo: { state: { onDidChange(fn: () => void): vscode.Disposable } }) => void): vscode.Disposable;
}

export function activate(context: vscode.ExtensionContext) {
	console.log('Extension "vs-git-forge" is now active!');

	// Статус-бар: иконка + имя ветки (слева внизу)
	const branchStatusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		100
	);
	branchStatusBarItem.command = 'vs-git-forge.openGitForge';
	context.subscriptions.push(branchStatusBarItem);
	void initBranchStatusBar(context, branchStatusBarItem);

	// Обновление из .git/HEAD (для Cursor и когда API недоступен)
	const refreshFromFile = async (): Promise<void> => {
		const branch = await getBranchFromGitHead();
		updateBranchStatusBar(branchStatusBarItem, branch);
	};
	// Следим за .git/HEAD: создание (git init) и изменение (checkout) — обновляем статус-бар
	const gitHeadWatcher = vscode.workspace.createFileSystemWatcher('**/.git/HEAD');
	gitHeadWatcher.onDidCreate(async () => {
		const tryInit = async (delayMs: number): Promise<boolean> => {
			await new Promise((r) => setTimeout(r, delayMs));
			return initBranchStatusBar(context, branchStatusBarItem);
		};
		if (!(await tryInit(800))) {
			await tryInit(2000);
		}
		if (!branchStatusBarSubscribed) await refreshFromFile();
	});
	gitHeadWatcher.onDidChange(async () => {
		if (!branchStatusBarSubscribed) await refreshFromFile();
	});
	context.subscriptions.push(gitHeadWatcher);

	const treeProvider = new GitForgeTreeProvider();
	// Панель внизу (вкладка рядом с Терминалом)
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('vs-git-forge.gitForgeView', treeProvider)
	);
	// Боковая панель (Activity Bar) — при открытии автоматически показываем вкладку Git Forge внизу
	const sidebarTreeView = vscode.window.createTreeView('vs-git-forge.gitForgeSidebarView', {
		treeDataProvider: treeProvider,
	});
	sidebarTreeView.onDidChangeVisibility((e) => {
		if (e.visible) {
			void vscode.commands.executeCommand('vs-git-forge.gitForgeView.focus');
		}
	});
	// При старте редактора: если раздел Git Forge в Activity Bar уже открыт — открыть вкладку внизу
	if (sidebarTreeView.visible) {
		void vscode.commands.executeCommand('vs-git-forge.gitForgeView.focus');
	}
	context.subscriptions.push(sidebarTreeView);

	// По клику на ветку в статус-баре: открыть раздел Git Forge в Activity Bar и вкладку внизу
	context.subscriptions.push(
		vscode.commands.registerCommand('vs-git-forge.openGitForge', async () => {
			await vscode.commands.executeCommand('vs-git-forge.gitForgeSidebarView.focus');
			await vscode.commands.executeCommand('vs-git-forge.gitForgeView.focus');
		})
	);

	const cmdDisposable = vscode.commands.registerCommand('vs-git-forge.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Git Forge!');
	});
	context.subscriptions.push(cmdDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
