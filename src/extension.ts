// The module 'vscode' contains the VS Code extensibility API
import { execFileSync, execSync } from "child_process";
import * as path from "path";
import * as vscode from "vscode";
import {
  DiffDocProvider,
  DiffSide,
  encodeDiffDocUri,
  type GetCommitFileFn,
  GitFileStatus,
  UNCOMMITTED as DIFF_UNCOMMITTED,
} from "./diffDocProvider";
import { runStartupLifecycle } from "./lifecycle/startup";
import {
  type GitAPI,
  type GitBranch,
  type GitCommit,
  type GitRef,
  type GitRepository,
  getGitApi,
  GitRefTypeTag,
  RepoManager,
} from "./repoManager";

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
  repoManager: RepoManager,
): Promise<boolean> {
  const git = await repoManager.getGitApi();
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
  repoManager: RepoManager,
): Promise<boolean> {
  const fromApi = await initBranchStatusBarFromApi(context, item, repoManager);
  if (fromApi) {
    return true;
  }
  const branch = await getBranchFromGitHead();
  updateBranchStatusBar(item, branch);
  return !!branch;
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

/** Узнать upstream ветки (например "origin/main"), если настроен. */
function getBranchUpstreamRef(
  cwd: string,
  branchShortName: string,
): string | undefined {
  try {
    const out = execFileSync(
      "git",
      ["rev-parse", "-q", "--abbrev-ref", `${branchShortName}@{upstream}`],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const ref = out.trim();
    return ref.length > 0 ? ref : undefined;
  } catch {
    return undefined;
  }
}

/** Сколько коммитов локальная ветка отстаёт от upstream (если API не дал behind). */
function getBranchBehindCount(
  cwd: string,
  branchShortName: string,
  upstreamRef: string,
): number | undefined {
  try {
    const out = execFileSync(
      "git",
      ["rev-list", "--count", `${branchShortName}..${upstreamRef}`],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const n = parseInt(out.trim(), 10);
    return Number.isNaN(n) ? undefined : n;
  } catch {
    return undefined;
  }
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
  isMain?: boolean;
  /** Локальная ветка отстаёт от upstream (remote) на N коммитов — для кнопки Update selected */
  behind?: number;
  /** У локальной ветки настроен upstream (можно делать pull) */
  hasUpstream?: boolean;
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
  parents?: string[];
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

/** Обновить локальную ветку (git pull). Ветка должна отставать от remote. */
async function handlePullBranch(
  params: Record<string, unknown> | undefined,
  repo: GitRepository | null,
): Promise<{ data?: unknown; error?: string }> {
  if (!repo) {
    return { error: "Git-репозиторий не найден." };
  }
  const branchName =
    typeof params?.branchName === "string" ? params.branchName.trim() : "";
  if (!branchName) {
    return { error: "Укажите имя ветки." };
  }
  const cwd = repo.rootUri.fsPath;
  try {
    const headName = repo.state.HEAD?.name ?? "";
    const currentShort = headName.replace(/^refs\/heads\//, "").trim();
    if (currentShort !== branchName) {
      execSync(`git checkout ${JSON.stringify(branchName)}`, {
        cwd,
        encoding: "utf8",
      });
    }
    execSync("git pull", { cwd, encoding: "utf8" });
    if (currentShort !== branchName) {
      execSync(`git checkout ${JSON.stringify(currentShort)}`, {
        cwd,
        encoding: "utf8",
      });
    }
    return { data: { success: true } };
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
  if (method === "pullBranch") {
    return handlePullBranch(params, repo);
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
        const short =
          (name ?? "").replace(/^refs\/heads\//, "").trim() || null;
        return { data: short };
      }
      case "getLocalBranches": {
        const branches = await repo.getBranches({ remote: false });
        const headName = repo.state.HEAD?.name;
        const currentShort = (headName ?? "")
          .replace(/^refs\/heads\//, "")
          .trim() || null;
        const cwd = repo.rootUri.fsPath;
        const local: WebviewBranch[] = branches.map((b) => {
          const gb = b as GitBranch;
          const shortName = (b.name ?? "").replace(/^refs\/heads\//, "").trim();
          const displayName = shortName || (b.name ?? "");
          const isCurrent =
            currentShort != null &&
            (shortName === currentShort || (b.name ?? "") === headName);
          const isMain =
            displayName === "master" || displayName === "main";
          let behind =
            gb.behind != null && gb.behind > 0 ? gb.behind : undefined;
          let hasUpstream = false;
          const upstreamRef =
            gb.upstream?.remote != null && gb.upstream?.name != null
              ? `${gb.upstream.remote}/${gb.upstream.name}`
              : getBranchUpstreamRef(cwd, displayName);
          if (upstreamRef) {
            hasUpstream = true;
            if (behind === undefined) {
              const count = getBranchBehindCount(cwd, displayName, upstreamRef);
              if (count != null && count > 0) behind = count;
            }
          }
          return {
            name: displayName,
            isCurrent,
            isMain,
            ...(behind != null ? { behind } : {}),
            ...(hasUpstream ? { hasUpstream: true } : {}),
          };
        });
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
        const headName = repo.state.HEAD?.name ?? null;
        const currentShort = (headName ?? "")
          .replace(/^refs\/heads\//, "")
          .trim() || null;
        const cwd = repo.rootUri.fsPath;
        const local: WebviewBranch[] = localBranches.map((b) => {
          const gb = b as GitBranch;
          const shortName = (b.name ?? "").replace(/^refs\/heads\//, "").trim();
          const displayName = shortName || (b.name ?? "");
          const isCurrent =
            currentShort != null &&
            (shortName === currentShort || (b.name ?? "") === headName);
          const isMain =
            displayName === "master" || displayName === "main";
          let behind =
            gb.behind != null && gb.behind > 0 ? gb.behind : undefined;
          let hasUpstream = false;
          const upstreamRef =
            gb.upstream?.remote != null && gb.upstream?.name != null
              ? `${gb.upstream.remote}/${gb.upstream.name}`
              : getBranchUpstreamRef(cwd, displayName);
          if (upstreamRef) {
            hasUpstream = true;
            if (behind === undefined) {
              const count = getBranchBehindCount(cwd, displayName, upstreamRef);
              if (count != null && count > 0) behind = count;
            }
          }
          return {
            name: displayName,
            isCurrent,
            isMain,
            ...(behind != null ? { behind } : {}),
            ...(hasUpstream ? { hasUpstream: true } : {}),
          };
        });
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
            currentBranch: currentShort ?? headName,
            local,
            remote: remoteList,
            tags,
          },
        };
      }
      case "getCommits": {
        const maxEntries = (params?.maxEntries as number) ?? 100;
        const ref = (params?.ref as string) ?? "HEAD";
        const commits = await repo.log({ maxEntries, ref });
        const allRefs = repo.state.refs ?? [];
        const refsByCommit = new Map<string, string[]>();
        for (const r of allRefs) {
          if (r.commit && r.name) {
            const short = r.name
              .replace(/^refs\/heads\//, "")
              .replace(/^refs\/remotes\//, "")
              .trim();
            if (!short) continue;
            let list = refsByCommit.get(r.commit);
            if (!list) {
              list = [];
              refsByCommit.set(r.commit, list);
            }
            if (!list.includes(short)) list.push(short);
          }
        }
        const webviewCommits: WebviewCommit[] = commits.map((c) => ({
          hash: c.hash,
          shortHash: c.hash.slice(0, 8),
          message: c.message,
          author: c.authorName ?? "",
          authorEmail: c.authorEmail,
          date: formatDate(c.authorDate),
          dateRelative: formatDateRelative(c.authorDate),
          branches: refsByCommit.get(c.hash) ?? undefined,
          isMerge: (c.parents?.length ?? 0) > 1,
          parents: c.parents?.map((p) => p.slice(0, 8)),
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
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repoManager: RepoManager,
  ) {}

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
        command?: string;
      }) => {
        if (msg.type === "sidebarWidth" && typeof msg.width === "number") {
          this.context.globalState.update(SIDEBAR_WIDTH_KEY, msg.width);
          return;
        }
        if (msg.type === "command" && msg.command) {
          const repo = await this.repoManager.getCurrentRepo();
          if (!repo) {
            return;
          }
          const repoRoot = repo.rootUri.fsPath;
          const p = msg.params ?? {};
          if (msg.command === "viewDiff") {
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
            );
            const rightUri = encodeDiffDocUri(
              repoRoot,
              newPath,
              toHash,
              status,
              DiffSide.New,
            );
            const title = `${path.basename(newPath || oldPath)} (${fromHash === DIFF_UNCOMMITTED ? "working" : fromHash.slice(0, 7)} ↔ ${toHash === DIFF_UNCOMMITTED ? "working" : toHash.slice(0, 7)})`;
            void vscode.commands.executeCommand(
              "vscode.diff",
              leftUri,
              rightUri,
              title,
            );
          } else if (msg.command === "viewFileAtRevision") {
            const hash = typeof p.hash === "string" ? p.hash : "HEAD";
            const filePath = typeof p.filePath === "string" ? p.filePath : "";
            if (!filePath) {
              return;
            }
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
          }
          return;
        }
        if (msg.type === "request" && msg.requestId && msg.method) {
          const method = msg.method;
          const repo = method === "initRepo" ? null : await this.repoManager.getCurrentRepo();
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

/** Получить содержимое файла на указанной ревизии (для Diff View). */
const getCommitFile: GetCommitFileFn = async (repo, commit, filePath) => {
  const rev = `${commit}:${filePath.replace(/\\/g, "/")}`;
  const out = execSync(`git show ${JSON.stringify(rev)}`, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return out;
};

export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "vs-git-forge" is now active!');

  const lifecycle = runStartupLifecycle(context, {
    skipInDevelopmentHost: true,
  });
  if (lifecycle.stage === "install") {
    void vscode.window.showInformationMessage(
      "Git Forge установлен. Откройте панель Git Forge для работы с репозиторием.",
    );
  } else if (lifecycle.stage === "update" && lifecycle.previousVersion) {
    // При желании можно показать «Что нового» или открыть CHANGELOG
    // void vscode.window.showInformationMessage(
    //   `Git Forge обновлён до ${lifecycle.currentVersion}`,
    // );
  }

  const repoManager = new RepoManager();
  context.subscriptions.push(repoManager);

  const diffDocProvider = new DiffDocProvider(getCommitFile);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      DiffDocProvider.scheme,
      diffDocProvider,
    ),
  );

  // Статус-бар: иконка + имя ветки (слева внизу)
  const branchStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  branchStatusBarItem.command = "vs-git-forge.openGitForge";
  context.subscriptions.push(branchStatusBarItem);
  void initBranchStatusBar(context, branchStatusBarItem, repoManager);

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
      return initBranchStatusBar(context, branchStatusBarItem, repoManager);
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
      new GitForgePanelViewProvider(context, repoManager),
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
      const repo = await repoManager.getCurrentRepo();
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
