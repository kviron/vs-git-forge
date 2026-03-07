// The module 'vscode' contains the VS Code extensibility API
import { execSync } from "child_process";
import * as path from "path";
import * as vscode from "vscode";

class GitForgeTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getChildren(): vscode.TreeItem[] {
    return [
      new vscode.TreeItem(
        "Добро пожаловать в Git Forge",
        vscode.TreeItemCollapsibleState.None,
      ),
    ];
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }
}

/** Обновляет пункт в статус-баре: иконка + имя ветки. */
function updateBranchStatusBar(
  item: vscode.StatusBarItem,
  branch: string | undefined,
): void {
  if (branch) {
    item.text = `$(git-branch) ${branch}`;
    item.tooltip = `Ветка: ${branch}. Нажми, чтобы открыть Git Forge`;
    item.command = "vs-git-forge.openGitForge";
    item.show();
  } else {
    item.hide();
  }
}

/** Читает имя ветки из .git/HEAD (работает без встроенного Git-расширения, в т.ч. в Cursor). */
async function getBranchFromGitHead(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  for (const folder of folders) {
    const headPath = vscode.Uri.joinPath(folder.uri, ".git", "HEAD");
    try {
      const data = await vscode.workspace.fs.readFile(headPath);
      const content = new TextDecoder().decode(data).trim();
      const match = /^ref: refs\/heads\/(.+)$/.exec(content);
      if (match) {
        return match[1];
      }
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
  item: vscode.StatusBarItem,
): Promise<boolean> {
  const gitExtension = vscode.extensions.getExtension<{
    getAPI(version: number): GitAPI;
  }>("vscode.git");
  if (!gitExtension) {
    return false;
  }
  let git: GitAPI;
  try {
    git = gitExtension.isActive
      ? gitExtension.exports.getAPI(1)
      : (await gitExtension.activate()).getAPI(1);
  } catch {
    return false;
  }
  if (!git?.repositories?.length) {
    return false;
  }
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
      git.onDidOpenRepository(
        (repo: {
          state: { onDidChange(fn: () => void): vscode.Disposable };
        }) => {
          context.subscriptions.push(repo.state.onDidChange(update));
        },
      ),
    );
  }
  return true;
}

/** Показывает ветку в статус-баре: сначала пробуем API, иначе читаем .git/HEAD. */
async function initBranchStatusBar(
  context: vscode.ExtensionContext,
  item: vscode.StatusBarItem,
): Promise<boolean> {
  const fromApi = await initBranchStatusBarFromApi(context, item);
  if (fromApi) {
    return true;
  }
  const branch = await getBranchFromGitHead();
  updateBranchStatusBar(item, branch);
  return !!branch;
}

// Минимальные типы для встроенного Git API (vscode.git)
// RefType: Head=0, RemoteHead=1, Tag=2
const GitRefTypeTag = 2;
interface GitRef {
  readonly type: number;
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}
interface GitBranch extends GitRef {
  readonly upstream?: { remote: string; name: string };
  readonly ahead?: number;
  readonly behind?: number;
}
interface GitCommit {
  readonly hash: string;
  readonly message: string;
  readonly parents: string[];
  readonly authorDate?: Date;
  readonly authorName?: string;
  readonly authorEmail?: string;
}
interface GitChange {
  readonly uri: vscode.Uri;
  readonly status: number;
}
interface GitRepositoryState {
  readonly HEAD?: GitBranch;
  readonly refs: GitRef[];
  readonly workingTreeChanges: GitChange[];
  readonly indexChanges: GitChange[];
  onDidChange(fn: () => void): vscode.Disposable;
}
interface GitRepository {
  readonly rootUri: vscode.Uri;
  readonly state: GitRepositoryState;
  getBranches(
    query: { remote?: boolean },
    token?: vscode.CancellationToken,
  ): Promise<GitBranch[]>;
  getRefs?(query?: { pattern?: string | string[] }): Promise<GitRef[]>;
  log(options?: { maxEntries?: number; ref?: string }): Promise<GitCommit[]>;
}
interface GitAPI {
  readonly repositories: ReadonlyArray<GitRepository>;
  onDidOpenRepository(fn: (repo: GitRepository) => void): vscode.Disposable;
  init(root: vscode.Uri): Promise<GitRepository>;
}

/** Получить Git API (или null, если расширение Git недоступно). */
async function getGitApi(): Promise<GitAPI | null> {
  const ext = vscode.extensions.getExtension<{
    getAPI(version: number): GitAPI;
  }>("vscode.git");
  if (!ext) {
    return null;
  }
  try {
    return ext.isActive
      ? ext.exports.getAPI(1)
      : (await ext.activate()).getAPI(1);
  } catch {
    return null;
  }
}

async function getGitRepo(): Promise<GitRepository | null> {
  const api = await getGitApi();
  const repos = api?.repositories ?? [];
  if (repos.length === 0) {
    return null;
  }
  if (repos.length === 1) {
    return repos[0] as GitRepository;
  }
  // Несколько репозиториев: берём тот, в котором открыт активный файл, иначе первый
  const activeUri = vscode.window.activeTextEditor?.document?.uri;
  if (activeUri) {
    const repo = repos.find((r) => {
      const root = (r as GitRepository).rootUri.fsPath;
      const normalized = root + (root.endsWith(path.sep) ? "" : path.sep);
      return (
        activeUri.fsPath === root || activeUri.fsPath.startsWith(normalized)
      );
    });
    if (repo) {
      return repo as GitRepository;
    }
  }
  return repos[0] as GitRepository;
}

/** Получить теги: через getRefs (если есть) или из state.refs. */
async function getTagRefs(repo: GitRepository): Promise<GitRef[]> {
  if (typeof repo.getRefs === "function") {
    try {
      const refs = await repo.getRefs({ pattern: "refs/tags/*" });
      return refs ?? [];
    } catch {
      // fallback
    }
  }
  return (repo.state.refs ?? []).filter((r) => r.type === GitRefTypeTag);
}

function mapTagRefsToWebview(refs: GitRef[]): WebviewTag[] {
  const list = refs
    .filter((r) => (r.name ?? "").length > 0)
    .map((r) => {
      const name = r.name ?? "";
      const shortName = name.startsWith("refs/tags/")
        ? name.replace(/^refs\/tags\//, "")
        : name;
      return { name: shortName, commit: r.commit };
    });
  list.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return list;
}

/** Инициализировать Git-репозиторий в папке. */
async function handleInitRepo(
  params: Record<string, unknown> | undefined,
): Promise<{ data?: unknown; error?: string }> {
  const rootUri =
    typeof params?.rootUri === "string" ? params.rootUri : undefined;
  const folder = rootUri
    ? vscode.Uri.file(rootUri)
    : vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder) {
    return { error: "Нет открытой папки для инициализации репозитория." };
  }
  const api = await getGitApi();
  if (!api) {
    return {
      error: "Расширение Git недоступно. Установите встроенное расширение Git.",
    };
  }
  try {
    await api.init(folder);
    return { data: { success: true } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}

// Статусы из vscode git (extensions/git/src/api/git.d.ts)
const GitStatus = {
  INDEX_ADDED: 1,
  INDEX_DELETED: 2,
  INDEX_MODIFIED: 0,
  MODIFIED: 5,
  DELETED: 6,
  UNTRACKED: 7,
  INTENT_TO_ADD: 9,
} as const;

function gitStatusToKind(status: number): "added" | "modified" | "deleted" {
  if (
    status === GitStatus.INDEX_ADDED ||
    status === GitStatus.UNTRACKED ||
    status === GitStatus.INTENT_TO_ADD
  ) {
    return "added";
  }
  if (status === GitStatus.INDEX_DELETED || status === GitStatus.DELETED) {
    return "deleted";
  }
  return "modified";
}

function formatDate(d: Date | undefined): string {
  if (!d) {
    return "";
  }
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateRelative(d: Date | undefined): string {
  if (!d) {
    return "";
  }
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days === 0) {
    return d.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (days === 1) {
    return (
      "Вчера " +
      d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    );
  }
  if (days < 7) {
    return `${days} дн. назад`;
  }
  return formatDate(d);
}

/** Ветка/коммит для webview (типы из webview shared/lib/types) */
interface WebviewBranch {
  name: string;
  remote?: string;
  isCurrent?: boolean;
  children?: WebviewBranch[];
}
interface WebviewTag {
  name: string;
  commit?: string;
}
interface WebviewCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  authorEmail?: string;
  date: string;
  dateRelative?: string;
  branches?: string[];
  isMerge?: boolean;
  graphRow?: number[];
}
interface WebviewChangedFile {
  path: string;
  name: string;
  status?: "added" | "modified" | "deleted";
}

/** Показать диалог создания новой ветки и выполнить git branch. */
async function handleShowCreateBranchDialog(
  params: Record<string, unknown> | undefined,
  repo: GitRepository | null,
): Promise<{ data?: string | null; error?: string }> {
  if (!repo) {
    void vscode.window.showErrorMessage(
      "Git-репозиторий не найден. Откройте папку с репозиторием.",
    );
    return { error: "Git-репозиторий не найден." };
  }
  const sourceBranchName =
    typeof params?.sourceBranchName === "string"
      ? params.sourceBranchName.trim()
      : "";
  const sourceRef = sourceBranchName || repo.state.HEAD?.name || "HEAD";
  const title = `Создание новой ветки из ветки ${sourceRef}`;

  // Небольшая задержка, чтобы диалог гарантированно показался при вызове из webview
  await new Promise((r) => setTimeout(r, 100));

  const newName = await vscode.window.showInputBox({
    title,
    prompt: "Имя новой ветки",
    placeHolder: "например, feature/my-feature",
    validateInput(value) {
      const trimmed = value?.trim() ?? "";
      if (!trimmed) {
        return "Введите имя ветки";
      }
      if (!/^[a-zA-Z0-9/_.-]+$/.test(trimmed)) {
        return "Имя ветки может содержать только буквы, цифры, /, _, ., -";
      }
      return null;
    },
  });

  if (newName === undefined) {
    return { data: null };
  }
  const trimmedName = newName.trim();
  if (!trimmedName) {
    return { data: null };
  }

  try {
    execSync(
      `git branch ${JSON.stringify(trimmedName)} ${JSON.stringify(sourceRef)}`,
      {
        cwd: repo.rootUri.fsPath,
        encoding: "utf8",
      },
    );
    void vscode.window.showInformationMessage(
      `Ветка «${trimmedName}» создана из ${sourceRef}`,
    );
    return { data: trimmedName };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}

async function handleApiRequest(
  method: string,
  params: Record<string, unknown> | undefined,
  repo: GitRepository | null,
): Promise<{ data?: unknown; error?: string }> {
  if (method === "initRepo") {
    return handleInitRepo(params);
  }
  if (method === "showCreateBranchDialog") {
    return handleShowCreateBranchDialog(params, repo);
  }
  if (!repo) {
    const branch = await getBranchFromGitHead();
    if (method === "getCurrentBranch") {
      return { data: branch ?? null };
    }
    if (method === "getRepositoryRoot") {
      const folders = vscode.workspace.workspaceFolders;
      const root = folders?.[0]?.uri?.fsPath ?? null;
      return { data: { root } };
    }
    if (method === "getTags") {
      return { data: [] };
    }
    return {
      error:
        "Git-репозиторий не найден. Откройте папку с репозиторием или установите расширение Git.",
    };
  }

  try {
    switch (method) {
      case "getCurrentBranch": {
        const name = repo.state.HEAD?.name ?? null;
        return { data: name };
      }
      case "getLocalBranches": {
        const branches = await repo.getBranches({ remote: false });
        const current = repo.state.HEAD?.name;
        const local: WebviewBranch[] = branches.map((b) => ({
          name: b.name ?? "",
          isCurrent: b.name === current,
        }));
        // Текущая ветка всегда первая в списке Local
        local.sort((a, b) => {
          if (a.isCurrent) {
            return -1;
          }
          if (b.isCurrent) {
            return 1;
          }
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        });
        return { data: local };
      }
      case "getRemoteBranches": {
        const branches = await repo.getBranches({ remote: true });
        const byRemote = new Map<string, WebviewBranch[]>();
        const seenPerRemote = new Map<string, Set<string>>();
        for (const b of branches) {
          const remote = b.remote ?? "origin";
          const shortName = (b.name ?? "").startsWith(remote + "/")
            ? (b.name ?? "").slice(remote.length + 1)
            : (b.name ?? "");
          if (shortName === "HEAD") {
            continue;
          }
          if (!seenPerRemote.has(remote)) {
            seenPerRemote.set(remote, new Set());
          }
          if (seenPerRemote.get(remote)!.has(shortName)) {
            continue;
          }
          seenPerRemote.get(remote)!.add(shortName);
          if (!byRemote.has(remote)) {
            byRemote.set(remote, []);
          }
          byRemote.get(remote)!.push({ name: shortName, remote });
        }
        const remoteList: WebviewBranch[] = Array.from(byRemote.entries()).map(
          ([remote, children]) => ({
            name: remote,
            children,
          }),
        );
        return { data: remoteList };
      }
      case "getTags": {
        const tagRefs = await getTagRefs(repo);
        return { data: mapTagRefsToWebview(tagRefs) };
      }
      case "getBranches": {
        const [localBranches, remoteBranches] = await Promise.all([
          repo.getBranches({ remote: false }),
          repo.getBranches({ remote: true }),
        ]);
        const current = repo.state.HEAD?.name ?? null;
        const byRemote = new Map<string, WebviewBranch[]>();
        const seenPerRemote = new Map<string, Set<string>>();
        for (const b of remoteBranches) {
          const remote = b.remote ?? "origin";
          const shortName = (b.name ?? "").startsWith(remote + "/")
            ? (b.name ?? "").slice(remote.length + 1)
            : (b.name ?? "");
          if (shortName === "HEAD") {
            continue;
          }
          if (!seenPerRemote.has(remote)) {
            seenPerRemote.set(remote, new Set());
          }
          if (seenPerRemote.get(remote)!.has(shortName)) {
            continue;
          }
          seenPerRemote.get(remote)!.add(shortName);
          if (!byRemote.has(remote)) {
            byRemote.set(remote, []);
          }
          byRemote.get(remote)!.push({ name: shortName, remote });
        }
        const remoteList: WebviewBranch[] = Array.from(byRemote.entries()).map(
          ([remote, children]) => ({
            name: remote,
            children,
          }),
        );
        const tagRefs = await getTagRefs(repo);
        const tags = mapTagRefsToWebview(tagRefs);
        const local: WebviewBranch[] = localBranches.map((b) => ({
          name: b.name ?? "",
          isCurrent: b.name === current,
        }));
        // Текущая ветка всегда первая в списке Local
        local.sort((a, b) => {
          if (a.isCurrent) {
            return -1;
          }
          if (b.isCurrent) {
            return 1;
          }
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        });
        return {
          data: {
            currentBranch: current,
            local,
            remote: remoteList,
            tags,
          },
        };
      }
      case "getCommits": {
        const maxEntries = (params?.maxEntries as number) ?? 50;
        const ref = (params?.ref as string) ?? "HEAD";
        const commits = await repo.log({ maxEntries, ref });
        const headName = repo.state.HEAD?.name;
        const webviewCommits: WebviewCommit[] = commits.map((c) => ({
          hash: c.hash,
          shortHash: c.hash.slice(0, 8),
          message: c.message,
          author: c.authorName ?? "",
          authorEmail: c.authorEmail,
          date: formatDate(c.authorDate),
          dateRelative: formatDateRelative(c.authorDate),
          branches: headName ? [headName] : undefined,
          isMerge: (c.parents?.length ?? 0) > 1,
        }));
        return { data: webviewCommits };
      }
      case "getChangedFiles": {
        const all = [
          ...repo.state.indexChanges,
          ...repo.state.workingTreeChanges,
        ];
        const files: WebviewChangedFile[] = all.map((ch) => {
          const path = repo.rootUri.fsPath
            ? ch.uri.fsPath
                .replace(repo.rootUri.fsPath, "")
                .replace(/^[/\\]/, "")
            : ch.uri.fsPath;
          const name = path.split(/[/\\]/).pop() ?? path;
          return {
            path,
            name,
            status: gitStatusToKind(ch.status),
          };
        });
        return { data: { files } };
      }
      case "getRepositoryRoot":
        return { data: { root: repo.rootUri.fsPath } };
      default:
        return { error: `Неизвестный метод: ${method}` };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}

const SIDEBAR_WIDTH_KEY = "vs-git-forge.sidebarWidth";
const DEFAULT_SIDEBAR_WIDTH = 300;
const MIN_SIDEBAR_WIDTH = 150;
const MAX_SIDEBAR_WIDTH = 600;

function getGitForgePanelHtml(
  webview: vscode.Webview,
  sidebarWidthPx: number,
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri,
): string {
  const safeWidth = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, sidebarWidthPx),
  );
  const cspSource = webview.cspSource;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; script-src ${cspSource}; style-src ${cspSource}; connect-src ${cspSource} https:;">
	<link rel="stylesheet" href="${styleUri.toString()}">
</head>
<body>
	<div id="root" data-sidebar-width="${safeWidth}"></div>
	<script src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

class GitForgePanelViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    // Обработчик сообщений регистрируем до установки html, чтобы не потерять первый запрос от webview
    webviewView.webview.onDidReceiveMessage(
      async (msg: {
        type?: string;
        width?: number;
        requestId?: string;
        method?: string;
        params?: Record<string, unknown>;
      }) => {
        if (msg.type === "sidebarWidth" && typeof msg.width === "number") {
          this.context.globalState.update(SIDEBAR_WIDTH_KEY, msg.width);
          return;
        }
        if (msg.type === "request" && msg.requestId && msg.method) {
          const method = msg.method;
          const repo = method === "initRepo" ? null : await getGitRepo();
          const result = await handleApiRequest(method, msg.params, repo);
          webviewView.webview.postMessage({
            type: "response",
            requestId: msg.requestId,
            data: result.data,
            error: result.error,
          });
        }
      },
    );
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
    webviewView.webview.html = getGitForgePanelHtml(
      webviewView.webview,
      savedWidth,
      scriptUri,
      styleUri,
    );
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "vs-git-forge" is now active!');

  // Статус-бар: иконка + имя ветки (слева внизу)
  const branchStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  branchStatusBarItem.command = "vs-git-forge.openGitForge";
  context.subscriptions.push(branchStatusBarItem);
  void initBranchStatusBar(context, branchStatusBarItem);

  // Обновление из .git/HEAD (для Cursor и когда API недоступен)
  const refreshFromFile = async (): Promise<void> => {
    const branch = await getBranchFromGitHead();
    updateBranchStatusBar(branchStatusBarItem, branch);
  };
  // Следим за .git/HEAD: создание (git init) и изменение (checkout) — обновляем статус-бар
  const gitHeadWatcher =
    vscode.workspace.createFileSystemWatcher("**/.git/HEAD");
  gitHeadWatcher.onDidCreate(async () => {
    const tryInit = async (delayMs: number): Promise<boolean> => {
      await new Promise((r) => setTimeout(r, delayMs));
      return initBranchStatusBar(context, branchStatusBarItem);
    };
    if (!(await tryInit(800))) {
      await tryInit(2000);
    }
    if (!branchStatusBarSubscribed) {
      await refreshFromFile();
    }
  });
  gitHeadWatcher.onDidChange(async () => {
    if (!branchStatusBarSubscribed) {
      await refreshFromFile();
    }
  });
  context.subscriptions.push(gitHeadWatcher);

  const treeProvider = new GitForgeTreeProvider();
  // Панель внизу (вкладка рядом с Терминалом) — webview с сайдбаром (300px, ресайз) + контент
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "vs-git-forge.gitForgeView",
      new GitForgePanelViewProvider(context),
    ),
  );
  // Боковая панель (Activity Bar) — при открытии автоматически показываем вкладку Git Forge внизу
  const sidebarTreeView = vscode.window.createTreeView(
    "vs-git-forge.gitForgeSidebarView",
    {
      treeDataProvider: treeProvider,
    },
  );
  sidebarTreeView.onDidChangeVisibility((e) => {
    if (e.visible) {
      void vscode.commands.executeCommand("vs-git-forge.gitForgeView.focus");
    }
  });
  // При старте редактора: если раздел Git Forge в Activity Bar уже открыт — открыть вкладку внизу
  if (sidebarTreeView.visible) {
    void vscode.commands.executeCommand("vs-git-forge.gitForgeView.focus");
  }
  context.subscriptions.push(sidebarTreeView);

  // По клику на ветку в статус-баре: открыть раздел Git Forge в Activity Bar и вкладку внизу
  context.subscriptions.push(
    vscode.commands.registerCommand("vs-git-forge.openGitForge", async () => {
      await vscode.commands.executeCommand(
        "vs-git-forge.gitForgeSidebarView.focus",
      );
      await vscode.commands.executeCommand("vs-git-forge.gitForgeView.focus");
    }),
  );

  // Команда «Создать ветку» из палитры (тот же диалог, что по кнопке в webview)
  context.subscriptions.push(
    vscode.commands.registerCommand("vs-git-forge.createBranch", async () => {
      const repo = await getGitRepo();
      const result = await handleShowCreateBranchDialog(undefined, repo);
      if (result.error) {
        void vscode.window.showErrorMessage(result.error);
      }
    }),
  );

  const cmdDisposable = vscode.commands.registerCommand(
    "vs-git-forge.helloWorld",
    () => {
      vscode.window.showInformationMessage("Hello World from Git Forge!");
    },
  );
  context.subscriptions.push(cmdDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
