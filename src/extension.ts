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
import { runUninstallLifecycle } from "./lifecycle/uninstall";
import { log, initLogger } from "./logger";
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
        vscode.l10n.t("tree.welcome"),
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
    item.tooltip = vscode.l10n.t("statusBar.branchTooltip", branch);
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

/** Список имён remotes из конфига (git remote). Пустой, если remotes нет или команда не сработала. */
function getConfiguredRemotes(repoRoot: string): string[] {
  try {
    const out = execSync("git remote", {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
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

/** Получить теги через ApiRepository.getRefs() (state.refs устарел). */
async function getTagRefs(repo: GitRepository): Promise<GitRef[]> {
  if (typeof repo.getRefs !== "function") {return [];}
  try {
    const refs = await repo.getRefs({ pattern: "refs/tags/*" });
    return refs ?? [];
  } catch {
    return [];
  }
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
    return { error: vscode.l10n.t("initRepo.noFolder") };
  }
  const api = await getGitApi();
  if (!api) {
    return {
      error: vscode.l10n.t("initRepo.gitNotAvailable"),
    };
  }
  try {
    await api.init(folder);
    return { data: { success: true } };
  } catch (e) {
    log.errorException(e, "handleInitRepo");
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

/** Локаль из VS Code (ru, en и т.д.) для форматирования дат. */
function getDateLocale(): string {
  const lang = vscode.env.language;
  return lang.startsWith("ru") ? "ru-RU" : "en-US";
}

function formatDate(d: Date | undefined): string {
  if (!d) {
    return "";
  }
  const locale = getDateLocale();
  return d.toLocaleString(locale, {
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
  const locale = getDateLocale();
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days === 0) {
    return d.toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (days === 1) {
    return (
      vscode.l10n.t("date.yesterday") +
      " " +
      d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    );
  }
  if (days < 7) {
    return vscode.l10n.t("date.daysAgo", String(days));
  }
  return formatDate(d);
}

/** Ветка для webview (поля из VS Code Git API: Ref + Branch) */
interface WebviewBranch {
  name: string;
  refName?: string;
  commit?: string;
  remote?: string;
  isCurrent?: boolean;
  isMain?: boolean;
  behind?: number;
  ahead?: number;
  hasUpstream?: boolean;
  upstream?: { remote: string; name: string };
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
  /** Для переименований (R): путь до переименования, для левой стороны diff. */
  oldPath?: string;
}

/** Узел дерева: папка или файл */
type ChangedFileTreeNode =
  | { kind: "folder"; path: string; segment: string }
  | { kind: "file"; path: string; name: string; status: "added" | "modified" | "deleted"; oldPath?: string };

/** Цвета статуса из темы Git: зелёный — создан, синий — изменён, красный — удалён */
const GIT_STATUS_THEME_IDS = {
  added: "gitDecoration.addedResourceForeground",
  modified: "gitDecoration.modifiedResourceForeground",
  deleted: "gitDecoration.deletedResourceForeground",
} as const;

/** Провайдер декораций для дерева Changed Files: подсветка по статусу из коммита */
class ChangedFilesDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

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
    const uris = Array.from(this.uriToStatus.keys(), (p) => vscode.Uri.file(p));
    this._onDidChangeFileDecorations.fire(uris);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    const key = path.normalize(uri.fsPath);
    const status = this.uriToStatus.get(key);
    if (!status) {return undefined;}
    const themeId = GIT_STATUS_THEME_IDS[status];
    return { color: new vscode.ThemeColor(themeId) };
  }
}

/** Провайдер нативного дерева «Changed Files» в стиле проводника VS Code */
class ChangedFilesTreeProvider
  implements vscode.TreeDataProvider<ChangedFileTreeNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ChangedFileTreeNode | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private files: WebviewChangedFile[] = [];
  private commitHash: string | null = null;
  /** Корень репозитория для resourceUri; виртуальный путь не даёт SCM вешать подсветку Git */
  private repoRoot: string | null = null;

  /** Префикс виртуальной папки: иконки темы берутся по расширению имени, путь не совпадает с реальными файлами — Git не декорирует */
  private static readonly VIRTUAL_PREFIX = ".gitforge-tree";

  constructor(private readonly decorationProvider: ChangedFilesDecorationProvider) {}

  private normalize(p: string): string {
    return p.replace(/\\/g, "/");
  }

  /** Количество файлов в папке (включая вложенные) */
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
    if (this.repoRoot !== null && this.repoRoot !== undefined) {
      this.decorationProvider.setUriStatuses(
        this.repoRoot,
        this.files,
        ChangedFilesTreeProvider.VIRTUAL_PREFIX,
      );
    } else {
      this.decorationProvider.setUriStatuses("", [], ChangedFilesTreeProvider.VIRTUAL_PREFIX);
    }
    this._onDidChangeTreeData.fire();
  }

  getChildren(
    element?: ChangedFileTreeNode,
  ): ChangedFileTreeNode[] {

    const prefix = element
      ? element.kind === "folder"
        ? `${element.path}/`
        : undefined
      : "";
    if (prefix === undefined) {return [];}

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
          if (seen.has(segment)) {continue;}
          seen.add(segment);
          items.push({
            kind: "folder",
            path: segment,
            segment,
          });
        }
      }
      items.sort((a, b) => {
        const aLabel = a.kind === "folder" ? a.segment : a.name;
        const bLabel = b.kind === "folder" ? b.segment : b.name;
        const aIsFolder = a.kind === "folder";
        const bIsFolder = b.kind === "folder";
        if (aIsFolder !== bIsFolder) {return (bIsFolder ? 1 : 0) - (aIsFolder ? 1 : 0);}
        return aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" });
      });
      return items;
    }

    const items: ChangedFileTreeNode[] = [];
    const seen = new Set<string>();
    for (const f of this.files) {
      if (!f.path.startsWith(prefix)) {continue;}
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
        if (seen.has(segment)) {continue;}
        seen.add(segment);
        items.push({
          kind: "folder",
          path: prefix + segment,
          segment,
        });
      }
    }
    items.sort((a, b) => {
      const aLabel = a.kind === "folder" ? a.segment : a.kind === "file" ? a.name : "";
      const bLabel = b.kind === "folder" ? b.segment : b.kind === "file" ? b.name : "";
      const aIsFolder = a.kind === "folder";
      const bIsFolder = b.kind === "folder";
      if (aIsFolder !== bIsFolder) {return (bIsFolder ? 1 : 0) - (aIsFolder ? 1 : 0);}
      return aLabel.localeCompare(bLabel, undefined, { sensitivity: "base" });
    });
    return items;
  }

  getTreeItem(element: ChangedFileTreeNode): vscode.TreeItem {
    const virtualPath =
      this.repoRoot !== null && this.repoRoot !== undefined
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
      item.description =
        count === 1
          ? vscode.l10n.t("changedFiles.oneFile")
          : vscode.l10n.t("changedFiles.filesCount", String(count));
      if (virtualPath !== null && virtualPath !== undefined) {
        item.resourceUri = vscode.Uri.file(virtualPath);
      } else {
        item.iconPath = new vscode.ThemeIcon("folder");
      }
      return item;
    }
    const item = new vscode.TreeItem(element.name);
    item.description = element.status;
    if (virtualPath !== null && virtualPath !== undefined) {
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
    item.contextValue = "file";
    if (this.commitHash && element.kind === "file") {
      item.command = {
        command: "vs-git-forge.openChangedFileDiff",
        title: vscode.l10n.t("command.openDiff.title"),
        arguments: [this.commitHash, element.path, element.status, element.oldPath],
      };
    }
    return item;
  }

  getCurrentCommitHash(): string | null {
    return this.commitHash;
  }
}

/** Показать диалог создания новой ветки и выполнить git branch. */
async function handleShowCreateBranchDialog(
  params: Record<string, unknown> | undefined,
  repo: GitRepository | null,
): Promise<{ data?: string | null; error?: string }> {
  if (!repo) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("createBranch.repoNotFound"),
    );
    return { error: vscode.l10n.t("createBranch.repoNotFoundShort") };
  }
  const sourceCommitHash =
    typeof params?.sourceCommitHash === "string"
      ? params.sourceCommitHash.trim()
      : "";
  const sourceBranchName =
    typeof params?.sourceBranchName === "string"
      ? params.sourceBranchName.trim()
      : "";
  const sourceRef = sourceCommitHash
    ? sourceCommitHash
    : sourceBranchName || repo.state.HEAD?.name || "HEAD";
  const shortRef = sourceCommitHash
    ? sourceCommitHash.slice(0, 7)
    : sourceRef.replace(/^refs\/heads\//, "").trim() || sourceRef;
  const title = sourceCommitHash
    ? vscode.l10n.t("createBranch.titleFromCommit", shortRef)
    : vscode.l10n.t("createBranch.titleFromBranch", shortRef);

  // Небольшая задержка, чтобы диалог гарантированно показался при вызове из webview
  await new Promise((r) => setTimeout(r, 100));

  // Шаг 1: ввод имени ветки
  const newName = await vscode.window.showInputBox({
    title,
    prompt: vscode.l10n.t("createBranch.prompt"),
    placeHolder: vscode.l10n.t("createBranch.placeHolder"),
    validateInput(value) {
      const trimmed = value?.trim() ?? "";
      if (!trimmed) {
        return vscode.l10n.t("createBranch.validateEmpty");
      }
      if (!/^[a-zA-Z0-9/_.-]+$/.test(trimmed)) {
        return vscode.l10n.t("createBranch.validateInvalid");
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

  // Шаг 2: выбор — только создать или создать и переключиться (чекбокс по сути)
  const checkoutChoice = await vscode.window.showQuickPick(
    [
      {
        label: vscode.l10n.t("createBranch.choiceCreate"),
        description: vscode.l10n.t("createBranch.choiceCreateDesc"),
        checkout: false,
      },
      {
        label: `$(git-branch) ${vscode.l10n.t("createBranch.choiceCheckout")}`,
        description: vscode.l10n.t("createBranch.choiceCheckoutDesc"),
        checkout: true,
      },
    ],
    {
      title: vscode.l10n.t("createBranch.branchTitle", trimmedName),
      placeHolder: vscode.l10n.t("createBranch.placeHolderChoice"),
      ignoreFocusOut: true,
    },
  );

  if (checkoutChoice === undefined) {
    return { data: null };
  }

  const checkout = checkoutChoice.checkout;

  try {
    execSync(
      `git branch ${JSON.stringify(trimmedName)} ${JSON.stringify(sourceRef)}`,
      {
        cwd: repo.rootUri.fsPath,
        encoding: "utf8",
      },
    );
    if (checkout) {
      execSync(`git checkout ${JSON.stringify(trimmedName)}`, {
        cwd: repo.rootUri.fsPath,
        encoding: "utf8",
      });
    }
    void vscode.window.showInformationMessage(
      checkout
        ? vscode.l10n.t("createBranch.branchCreatedActive", trimmedName)
        : vscode.l10n.t("createBranch.branchCreatedFrom", trimmedName, shortRef),
    );
    return { data: trimmedName };
  } catch (e) {
    log.errorException(e, "handleShowCreateBranchDialog");
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
    return { error: vscode.l10n.t("pullBranch.repoNotFound") };
  }
  const branchName =
    typeof params?.branchName === "string" ? params.branchName.trim() : "";
  if (!branchName) {
    return { error: vscode.l10n.t("pullBranch.noBranch") };
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
    log.errorException(e, "handlePullBranch");
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}

/** Показать диалог создания тега на указанном коммите и выполнить git tag. */
async function handleShowCreateTagDialog(
  params: Record<string, unknown> | undefined,
  repo: GitRepository | null,
): Promise<{ data?: string | null; error?: string }> {
  if (!repo) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("createTag.repoNotFound"),
    );
    return { error: vscode.l10n.t("createBranch.repoNotFoundShort") };
  }
  const commitHash =
    typeof params?.commitHash === "string" ? params.commitHash.trim() : "";
  if (!commitHash) {
    return { error: vscode.l10n.t("createTag.noCommit") };
  }
  const shortHash = commitHash.slice(0, 7);
  const title = vscode.l10n.t("createTag.title", shortHash);

  await new Promise((r) => setTimeout(r, 100));

  const tagName = await vscode.window.showInputBox({
    title,
    prompt: vscode.l10n.t("createTag.prompt"),
    placeHolder: vscode.l10n.t("createTag.placeHolder"),
    validateInput(value) {
      const trimmed = value?.trim() ?? "";
      if (!trimmed) {
        return vscode.l10n.t("createTag.validateEmpty");
      }
      if (!/^[a-zA-Z0-9/_.-]+$/.test(trimmed)) {
        return vscode.l10n.t("createTag.validateInvalid");
      }
      return null;
    },
  });

  if (tagName === undefined || !tagName.trim()) {
    return { data: null };
  }

  const trimmedName = tagName.trim();
  try {
    execSync(`git tag ${JSON.stringify(trimmedName)} ${JSON.stringify(commitHash)}`, {
      cwd: repo.rootUri.fsPath,
      encoding: "utf8",
    });
    void vscode.window.showInformationMessage(
      vscode.l10n.t("createTag.created", trimmedName, shortHash),
    );
    return { data: trimmedName };
  } catch (e) {
    log.errorException(e, "handleShowCreateTagDialog");
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
  if (method === "showCreateTagDialog") {
    return handleShowCreateTagDialog(params, repo);
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
      error: vscode.l10n.t("api.repoNotFound"),
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
            currentShort !== null && currentShort !== undefined &&
            (shortName === currentShort || (b.name ?? "") === headName);
          const isMain =
            displayName === "master" || displayName === "main";
          let behind =
            gb.behind !== null && gb.behind !== undefined && gb.behind > 0 ? gb.behind : undefined;
          let hasUpstream = false;
          const upstreamRef =
            gb.upstream?.remote !== null && gb.upstream?.remote !== undefined && gb.upstream?.name !== null && gb.upstream?.name !== undefined
              ? `${gb.upstream.remote}/${gb.upstream.name}`
              : getBranchUpstreamRef(cwd, displayName);
          if (upstreamRef) {
            hasUpstream = true;
            if (behind === undefined) {
              const count = getBranchBehindCount(cwd, displayName, upstreamRef);
              if (count !== null && count !== undefined && count > 0) {behind = count;}
            }
          }
          return {
            name: displayName,
            refName: b.name,
            commit: b.commit,
            isCurrent,
            isMain,
            ...(behind !== null && behind !== undefined ? { behind } : {}),
            ...(gb.ahead !== null && gb.ahead !== undefined && gb.ahead > 0 ? { ahead: gb.ahead } : {}),
            ...(hasUpstream ? { hasUpstream: true } : {}),
            ...(gb.upstream ? { upstream: { remote: gb.upstream.remote, name: gb.upstream.name } } : {}),
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
          byRemote.get(remote)!.push({
            name: shortName,
            remote,
            refName: b.name,
            commit: b.commit,
          });
        }
        const configuredRemotes = getConfiguredRemotes(repo.rootUri.fsPath);
        const remoteList: WebviewBranch[] = Array.from(byRemote.entries())
          .filter(([remote]) => configuredRemotes.includes(remote))
          .map(([remote, children]) => ({
            name: remote,
            children,
          }));
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
          byRemote.get(remote)!.push({
            name: shortName,
            remote,
            refName: b.name,
            commit: b.commit,
          });
        }
        const configuredRemotes = getConfiguredRemotes(repo.rootUri.fsPath);
        const remoteList: WebviewBranch[] = Array.from(byRemote.entries())
          .filter(([remote]) => configuredRemotes.includes(remote))
          .map(([remote, children]) => ({
            name: remote,
            children,
          }));
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
            currentShort !== null && currentShort !== undefined &&
            (shortName === currentShort || (b.name ?? "") === headName);
          const isMain =
            displayName === "master" || displayName === "main";
          let behind =
            gb.behind !== null && gb.behind !== undefined && gb.behind > 0 ? gb.behind : undefined;
          let hasUpstream = false;
          const upstreamRef =
            gb.upstream?.remote !== null && gb.upstream?.remote !== undefined && gb.upstream?.name !== null && gb.upstream?.name !== undefined
              ? `${gb.upstream.remote}/${gb.upstream.name}`
              : getBranchUpstreamRef(cwd, displayName);
          if (upstreamRef) {
            hasUpstream = true;
            if (behind === undefined) {
              const count = getBranchBehindCount(cwd, displayName, upstreamRef);
              if (count !== null && count !== undefined && count > 0) {behind = count;}
            }
          }
          return {
            name: displayName,
            refName: b.name,
            commit: b.commit,
            isCurrent,
            isMain,
            ...(behind !== null && behind !== undefined ? { behind } : {}),
            ...(gb.ahead !== null && gb.ahead !== undefined && gb.ahead > 0 ? { ahead: gb.ahead } : {}),
            ...(hasUpstream ? { hasUpstream: true } : {}),
            ...(gb.upstream ? { upstream: { remote: gb.upstream.remote, name: gb.upstream.name } } : {}),
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
        // VS Code Git API log() принимает refNames: string[], а не ref
        const commits = await repo.log({
          maxEntries,
          refNames: [ref],
        });
        let allRefs: GitRef[] = [];
        if (typeof repo.getRefs === "function") {
          try {
            allRefs = (await repo.getRefs()) ?? [];
          } catch {
            // игнорируем
          }
        }
        const refsByCommit = new Map<string, string[]>();
        for (const r of allRefs) {
          if (r.commit && r.name) {
            const short = r.name
              .replace(/^refs\/heads\//, "")
              .replace(/^refs\/remotes\//, "")
              .trim();
            if (!short) {continue;}
            let list = refsByCommit.get(r.commit);
            if (!list) {
              list = [];
              refsByCommit.set(r.commit, list);
            }
            if (!list.includes(short)) {list.push(short);}
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
      case "getCommitChangedFiles": {
        const commitHash = typeof params?.commitHash === "string" ? params.commitHash.trim() : "";
        if (!commitHash) {
          return { data: { files: [] } };
        }
        try {
          const cwd = repo.rootUri.fsPath;
          const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
          let parent: string;
          try {
            parent = execSync(`git rev-parse ${JSON.stringify(commitHash + "^")}`, {
              cwd,
              encoding: "utf8",
            }).trim();
          } catch {
            parent = emptyTree;
          }
          const out = execSync(
            `git diff --name-status --find-renames --diff-filter=AMDR -z ${JSON.stringify(parent)} ${JSON.stringify(commitHash)}`,
            { cwd, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
          );
          const parts = out.split("\0").filter((s) => s.length > 0);
          const files: WebviewChangedFile[] = [];
          for (let i = 0; i < parts.length; ) {
            const statusToken = parts[i];
            if (!statusToken) {
              i += 1;
              continue;
            }
            const statusChar = statusToken.slice(0, 1).toUpperCase();
            const isRename = statusChar === "R";
            if (isRename && i + 2 < parts.length) {
              const path1 = parts[i + 1].replace(/\\/g, "/");
              const path2 = parts[i + 2].replace(/\\/g, "/");
              i += 3;
              const pathNorm = path2;
              const name = pathNorm.split("/").pop() ?? pathNorm;
              const fileEntry: WebviewChangedFile = {
                path: pathNorm,
                name,
                status: "modified",
                oldPath: path1 !== path2 ? path1 : undefined,
              };
              files.push(fileEntry);
            } else if (i + 1 < parts.length) {
              const path1 = parts[i + 1].replace(/\\/g, "/");
              i += 2;
              const pathNorm = path1;
              const name = pathNorm.split("/").pop() ?? pathNorm;
              const status: "added" | "modified" | "deleted" =
                statusChar === "A" ? "added" : statusChar === "D" ? "deleted" : "modified";
              files.push({ path: pathNorm, name, status });
            } else {
              i += 1;
            }
          }
          return { data: { files } };
        } catch (err) {
          log.errorException(err, "getCommitChangedFiles");
          return { data: { files: [] } };
        }
      }
      case "getRepositoryRoot":
        return { data: { root: repo.rootUri.fsPath } };
      default:
        return { error: vscode.l10n.t("api.unknownMethod", method) };
    }
  } catch (e) {
    log.errorException(e, `handleApiRequest(${method})`);
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}

const SIDEBAR_WIDTH_KEY = "vs-git-forge.sidebarWidth";
/** ~20% от типичной ширины панели (1200px) */
const DEFAULT_SIDEBAR_WIDTH = 240;
const MIN_SIDEBAR_WIDTH = 150;
const MAX_SIDEBAR_WIDTH = 600;

function getGitForgePanelHtml(
  webview: vscode.Webview,
  sidebarWidthPx: number,
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri,
  codiconsCssUri: vscode.Uri,
): string {
  const safeWidth = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, sidebarWidthPx),
  );
  const lang = vscode.env.language; // ru, en, etc.
  const cspSource = webview.cspSource;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; script-src ${cspSource}; style-src ${cspSource}; font-src ${cspSource}; connect-src ${cspSource} https:;">
	<link rel="stylesheet" href="${styleUri.toString()}">
	<link rel="stylesheet" href="${codiconsCssUri.toString()}">
</head>
<body>
	<div id="root" data-sidebar-width="${safeWidth}" data-lang="${lang}"></div>
	<script src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

class GitForgePanelViewProvider implements vscode.WebviewViewProvider {
  private currentWebviewView: vscode.WebviewView | null = null;
  /** Ветка, по которой открыли контекстное меню (для команды webview/context). */
  private lastContextMenuBranchRef: string | null = null;
  /** Дебаунс: один checkout вызывает notify от обработчика, от .git/HEAD и от Git API — объединяем в одно сообщение. */
  private notifyGitStateChangedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repoManager: RepoManager,
    private readonly changedFilesTreeProvider?: ChangedFilesTreeProvider,
  ) {}

  /** Уведомить webview об изменении состояния Git (новый коммит, смена ветки и т.д.). */
  notifyGitStateChanged(): void {
    if (this.notifyGitStateChangedTimer !== undefined) {
      clearTimeout(this.notifyGitStateChangedTimer);
    }
    this.notifyGitStateChangedTimer = setTimeout(() => {
      this.notifyGitStateChangedTimer = undefined;
      this.currentWebviewView?.webview.postMessage({ type: "gitStateChanged" });
    }, 150);
  }

  /** Выполнить «Создать ветку из этой» для ветки, по которой открыли контекстное меню. */
  async runCreateBranchFromContext(): Promise<void> {
    const ref = this.lastContextMenuBranchRef;
    this.lastContextMenuBranchRef = null;
    if (!ref) {
      return;
    }
    const repo = await this.repoManager.getCurrentRepo();
    const result = await handleShowCreateBranchDialog(
      { sourceBranchName: ref },
      repo,
    );
    if (result.error) {
      void vscode.window.showErrorMessage(result.error);
    } else if (result.data !== null && result.data !== undefined) {
      this.notifyGitStateChanged();
    }
  }

  /** Переключиться на ветку, по которой открыли контекстное меню (checkout). */
  async runCheckoutFromContext(): Promise<void> {
    const ref = this.lastContextMenuBranchRef;
    this.lastContextMenuBranchRef = null;
    if (!ref) {
      return;
    }
    const repo = await this.repoManager.getCurrentRepo();
    if (!repo) {
      return;
    }
    const cwd = repo.rootUri.fsPath;
    try {
      const branchName = ref.includes("/") ? ref.replace(/^[^/]+\//, "") : ref;
      execSync(`git checkout ${JSON.stringify(branchName)}`, {
        cwd,
        encoding: "utf8",
      });
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
        branchRef?: string;
        level?: string;
        message?: string;
        args?: unknown[];
      }) => {
        if (msg.type === "webviewLog" && typeof msg.message === "string") {
          const level = msg.level === "warn" || msg.level === "error" || msg.level === "info" ? msg.level : "debug";
          const args = Array.isArray(msg.args) ? msg.args : [];
          log[level](`[webview] ${msg.message}`, ...args);
          return;
        }
        if (msg.type === "sidebarWidth" && typeof msg.width === "number") {
          this.context.globalState.update(SIDEBAR_WIDTH_KEY, msg.width);
          return;
        }
        if (
          msg.type === "setContextMenuBranch" &&
          typeof msg.branchRef === "string"
        ) {
          this.lastContextMenuBranchRef = msg.branchRef;
          return;
        }
        if (msg.type === "selectedCommitChanged") {
          const m = msg as { commitHash?: string; files?: WebviewChangedFile[] };
          const commitHash =
            typeof m.commitHash === "string" ? m.commitHash : null;
          const files = Array.isArray(m.files) ? m.files : [];
          const repo = await this.repoManager.getCurrentRepo();
          const repoRoot = repo?.rootUri.fsPath;
          this.changedFilesTreeProvider?.setData(commitHash, files, repoRoot);
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
          } else if (msg.command === "checkoutBranch") {
            const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
            if (!branchRef) {
              return;
            }
            try {
              const branchName = branchRef.includes("/")
                ? branchRef.replace(/^[^/]+\//, "")
                : branchRef;
              execSync(`git checkout ${JSON.stringify(branchName)}`, {
                cwd: repoRoot,
                encoding: "utf8",
              });
              this.notifyGitStateChanged();
            } catch (err) {
              log.errorException(err, "checkoutBranch");
              const msg = err instanceof Error ? err.message : String(err);
              void vscode.window.showErrorMessage(msg);
            }
          } else if (msg.command === "createBranchFromContext") {
            void this.runCreateBranchFromContext();
          } else if (msg.command === "deleteBranch") {
            const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
            if (!branchRef) {
              return;
            }
            const branchName = branchRef.includes("/")
              ? branchRef.replace(/^[^/]+\//, "")
              : branchRef;
            const tryDeleteBranch = (force: boolean) => {
              const flag = force ? "-D" : "-d";
              execSync(`git branch ${flag} ${JSON.stringify(branchName)}`, {
                cwd: repoRoot,
                encoding: "utf8",
              });
              this.notifyGitStateChanged();
            };
            try {
              tryDeleteBranch(false);
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
                    cancel
                  )
                  .then((choice) => {
                    if (choice === forceDelete) {
                      try {
                        tryDeleteBranch(true);
                        void vscode.window.showInformationMessage(
                          vscode.l10n.t("deleteBranch.deleted", branchName),
                        );
                      } catch (forceErr) {
                        log.errorException(forceErr, "deleteBranch (force)");
                        void vscode.window.showErrorMessage(
                          forceErr instanceof Error ? forceErr.message : String(forceErr)
                        );
                      }
                    }
                  });
              } else {
                log.errorException(err, "deleteBranch");
                void vscode.window.showErrorMessage(errMessage);
              }
            }
          } else if (msg.command === "deleteRemoteBranch") {
            const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
            const remote = typeof p.remote === "string" ? p.remote : "origin";
            if (!branchRef) {return;}
            const branchName = branchRef.includes("/")
              ? branchRef.replace(/^[^/]+\//, "")
              : branchRef;
            try {
              execSync(`git push ${JSON.stringify(remote)} --delete ${JSON.stringify(branchName)}`, {
                cwd: repoRoot,
                encoding: "utf8",
              });
              this.notifyGitStateChanged();
            } catch (err) {
              log.errorException(err, "deleteRemoteBranch");
              void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
            }
          } else if (msg.command === "deleteTag") {
            const tagName = typeof p.tagName === "string" ? p.tagName.trim() : "";
            if (!tagName) {return;}
            try {
              execSync(`git tag -d ${JSON.stringify(tagName)}`, {
                cwd: repoRoot,
                encoding: "utf8",
              });
              this.notifyGitStateChanged();
            } catch (err) {
              log.errorException(err, "deleteTag");
              void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
            }
          } else if (msg.command === "checkoutTag") {
            const tagName = typeof p.tagName === "string" ? p.tagName.trim() : "";
            if (!tagName) {return;}
            try {
              execSync(`git checkout ${JSON.stringify(tagName)}`, {
                cwd: repoRoot,
                encoding: "utf8",
              });
              this.notifyGitStateChanged();
            } catch (err) {
              log.errorException(err, "checkoutTag");
              void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
            }
          } else if (msg.command === "mergeTagIntoCurrent") {
            const tagName = typeof p.tagName === "string" ? p.tagName.trim() : "";
            if (!tagName) {return;}
            const head = repo.state.HEAD?.name;
            if (!head) {
              void vscode.window.showErrorMessage(vscode.l10n.t("tagContext.noHead"));
              return;
            }
            try {
              execSync(`git merge ${JSON.stringify(tagName)}`, {
                cwd: repoRoot,
                encoding: "utf8",
              });
              this.notifyGitStateChanged();
            } catch (err) {
              log.errorException(err, "mergeTagIntoCurrent");
              void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
            }
          } else if (msg.command === "pushTag") {
            const tagName = typeof p.tagName === "string" ? p.tagName.trim() : "";
            if (!tagName) {return;}
            const term = vscode.window.createTerminal({ cwd: repoRoot, name: "Git Push" });
            term.show();
            term.sendText(`git push origin ${JSON.stringify(tagName)}`);
          } else if (msg.command === "checkoutAndRebase") {
            const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
            const ontoRef = typeof p.ontoBranchRef === "string" ? p.ontoBranchRef : "";
            if (!branchRef || !ontoRef) {return;}
            const branchName = branchRef.includes("/") ? branchRef.replace(/^[^/]+\//, "") : branchRef;
            const ontoName = ontoRef.includes("/") ? ontoRef.replace(/^[^/]+\//, "") : ontoRef;
            try {
              execSync(`git checkout ${JSON.stringify(branchName)}`, { cwd: repoRoot, encoding: "utf8" });
              execSync(`git rebase ${JSON.stringify(ontoName)}`, { cwd: repoRoot, encoding: "utf8" });
              this.notifyGitStateChanged();
            } catch (err) {
              log.errorException(err, "checkoutAndRebase");
              void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
            }
          } else if (msg.command === "compareBranches") {
            const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
            const otherRef = typeof p.otherBranchRef === "string" ? p.otherBranchRef : "";
            if (!branchRef || !otherRef) {return;}
            const term = vscode.window.createTerminal({ cwd: repoRoot, name: "Git Diff" });
            term.show();
            term.sendText(`git diff ${JSON.stringify(branchRef)} ${JSON.stringify(otherRef)}`);
          } else if (msg.command === "showDiffWithWorkingTree") {
            const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
            if (!branchRef) {return;}
            const term = vscode.window.createTerminal({ cwd: repoRoot, name: "Git Diff" });
            term.show();
            term.sendText(`git diff ${JSON.stringify(branchRef)}`);
          } else if (msg.command === "rebaseOnto") {
            const toRebaseRef = typeof p.branchToRebaseRef === "string" ? p.branchToRebaseRef : "";
            const ontoRef = typeof p.ontoBranchRef === "string" ? p.ontoBranchRef : "";
            if (!toRebaseRef || !ontoRef) {return;}
            const toRebaseName = toRebaseRef.includes("/") ? toRebaseRef.replace(/^[^/]+\//, "") : toRebaseRef;
            const ontoName = ontoRef.includes("/") ? ontoRef.replace(/^[^/]+\//, "") : ontoRef;
            try {
              execSync(`git checkout ${JSON.stringify(toRebaseName)}`, { cwd: repoRoot, encoding: "utf8" });
              execSync(`git rebase ${JSON.stringify(ontoName)}`, { cwd: repoRoot, encoding: "utf8" });
              this.notifyGitStateChanged();
            } catch (err) {
              log.errorException(err, "rebaseOnto");
              void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
            }
          } else if (msg.command === "mergeInto") {
            const sourceRef = typeof p.sourceBranchRef === "string" ? p.sourceBranchRef : "";
            const targetRef = typeof p.targetBranchRef === "string" ? p.targetBranchRef : "";
            if (!sourceRef || !targetRef) {return;}
            const sourceName = sourceRef.includes("/") ? sourceRef.replace(/^[^/]+\//, "") : sourceRef;
            const targetName = targetRef.includes("/") ? targetRef.replace(/^[^/]+\//, "") : targetRef;
            try {
              execSync(`git checkout ${JSON.stringify(targetName)}`, { cwd: repoRoot, encoding: "utf8" });
              execSync(`git merge ${JSON.stringify(sourceName)}`, { cwd: repoRoot, encoding: "utf8" });
              this.notifyGitStateChanged();
            } catch (err) {
              log.errorException(err, "mergeInto");
              void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
            }
          } else if (msg.command === "pushBranch") {
            const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
            if (!branchRef) {return;}
            const branchName = branchRef.includes("/") ? branchRef.replace(/^[^/]+\//, "") : branchRef;
            const term = vscode.window.createTerminal({ cwd: repoRoot, name: "Git Push" });
            term.show();
            term.sendText(`git push origin ${JSON.stringify(branchName)}`);
          } else if (msg.command === "renameBranch") {
            const branchRef = typeof p.branchRef === "string" ? p.branchRef : "";
            if (!branchRef) {return;}
            const oldName = branchRef.includes("/") ? branchRef.replace(/^[^/]+\//, "") : branchRef;
            const newName = await vscode.window.showInputBox({
              title: vscode.l10n.t("renameBranch.title"),
              prompt: vscode.l10n.t("renameBranch.prompt"),
              value: oldName,
              validateInput(value) {
                if (!value?.trim()) {return vscode.l10n.t("renameBranch.nameEmpty");}
                return null;
              },
            });
            if (newName === null || newName === undefined || newName.trim() === "" || newName.trim() === oldName) {return;}
            try {
              execSync(`git branch -m ${JSON.stringify(oldName)} ${JSON.stringify(newName.trim())}`, {
                cwd: repoRoot,
                encoding: "utf8",
              });
              this.notifyGitStateChanged();
              void vscode.window.showInformationMessage(
                vscode.l10n.t("renameBranch.renamed", newName.trim()),
              );
            } catch (err) {
              log.errorException(err, "renameBranch");
              void vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
            }
          } else if (msg.command === "editCommitMessage") {
            const commitHash = typeof p.commitHash === "string" ? p.commitHash.trim() : "";
            const message = typeof p.message === "string" ? p.message : "";
            if (!commitHash) {
              return;
            }
            const headCommit = repo.state.HEAD?.commit;
            if (headCommit !== commitHash) {
              void vscode.window.showWarningMessage(
                vscode.l10n.t("editCommit.onlyHead"),
              );
              return;
            }
            const newMessage = await vscode.window.showInputBox({
              title: vscode.l10n.t("editCommit.title"),
              prompt: vscode.l10n.t("editCommit.prompt"),
              value: message,
              validateInput(value) {
                if (!value?.trim()) {
                  return vscode.l10n.t("editCommit.messageEmpty");
                }
                return null;
              },
            });
            if (newMessage === null || newMessage === undefined || newMessage.trim() === "") {
              return;
            }
            try {
              execSync(`git commit --amend -m ${JSON.stringify(newMessage.trim())}`, {
                cwd: repoRoot,
                encoding: "utf8",
              });
              this.notifyGitStateChanged();
              void vscode.window.showInformationMessage(
                vscode.l10n.t("editCommit.done"),
              );
            } catch (err) {
              log.errorException(err, "editCommitMessage");
              const errMsg = err instanceof Error ? err.message : String(err);
              void vscode.window.showErrorMessage(errMsg);
            }
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

/**
 * Найти путь файла в указанной ревизии, если он был переименован.
 * Возвращает старый путь (в котором файл существовал в commit) или null.
 */
function findFilePathInRevision(
  repo: string,
  commit: string,
  currentPath: string,
): string | null {
  const pathNorm = currentPath.replace(/\\/g, "/");
  const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  let parent: string;
  try {
    parent = execSync(`git rev-parse ${JSON.stringify(commit + "^")}`, {
      cwd: repo,
      encoding: "utf8",
    }).trim();
  } catch {
    parent = emptyTree;
  }
  try {
    const out = execSync(
      `git diff --name-status --find-renames --diff-filter=AMDR -z ${JSON.stringify(parent)} ${JSON.stringify(commit)}`,
      { cwd: repo, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
    );
    const parts = out.split("\0").filter((s) => s.length > 0);
    for (let i = 0; i < parts.length; ) {
      const statusToken = parts[i];
      if (!statusToken) {
        i += 1;
        continue;
      }
      const statusChar = statusToken.slice(0, 1).toUpperCase();
      const isRename = statusChar === "R";
      if (isRename && i + 2 < parts.length) {
        const oldPath = parts[i + 1].replace(/\\/g, "/");
        const newPath = parts[i + 2].replace(/\\/g, "/");
        if (newPath === pathNorm) {return oldPath;}
        i += 3;
      } else if (i + 1 < parts.length) {
        i += 2;
      } else {
        i += 1;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/** Получить содержимое файла на указанной ревизии (для Diff View). */
const getCommitFile: GetCommitFileFn = async (
  repo,
  commit,
  filePath,
  partnerCommit,
) => {
  const pathNorm = filePath.replace(/\\/g, "/");
  const rev = `${commit}:${pathNorm}`;
  try {
    const out = execSync(`git show ${JSON.stringify(rev)}`, {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /exists on disk, but not in|did not exist in|path .* does not exist/i.test(
        msg,
      )
    ) {
      const pathInRev = findFilePathInRevision(repo, commit, pathNorm);
      if (pathInRev) {
        try {
          return execSync(`git show ${JSON.stringify(commit + ":" + pathInRev)}`, {
            cwd: repo,
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024,
          });
        } catch {
          // fall through
        }
      }
      if (partnerCommit) {
        try {
          return execSync(
            `git show ${JSON.stringify(partnerCommit + ":" + pathNorm)}`,
            { cwd: repo, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
          );
        } catch {
          // fall through
        }
      }
      return "";
    }
    throw err;
  }
};

export function activate(context: vscode.ExtensionContext): void {
  initLogger(context);
  log.info('Расширение "vs-git-forge" активировано.');

  try {
    runActivate(context);
  } catch (e) {
    log.errorException(e, "activate");
    throw e;
  }
}

function runActivate(context: vscode.ExtensionContext): void {
  const lifecycle = runStartupLifecycle(context, {
    skipInDevelopmentHost: true,
  });
  if (lifecycle.stage === "install") {
    void vscode.window.showInformationMessage(
      vscode.l10n.t("lifecycle.installed"),
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
    gitForgeProvider.notifyGitStateChanged();
  });
  gitHeadWatcher.onDidChange(async () => {
    if (!branchStatusBarSubscribed) {
      await refreshFromFile();
    }
    gitForgeProvider.notifyGitStateChanged();
  });
  context.subscriptions.push(gitHeadWatcher);

  const treeProvider = new GitForgeTreeProvider();
  const changedFilesDecorationProvider = new ChangedFilesDecorationProvider();
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(changedFilesDecorationProvider),
  );
  const changedFilesTreeProvider = new ChangedFilesTreeProvider(
    changedFilesDecorationProvider,
  );
  const gitForgeProvider = new GitForgePanelViewProvider(
    context,
    repoManager,
    changedFilesTreeProvider,
  );
  // Панель внизу (вкладка рядом с Терминалом) — webview с сайдбаром (300px, ресайз) + контент
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "vs-git-forge.gitForgeView",
      gitForgeProvider,
    ),
  );
  // Дерево «Changed Files» в том же контейнере — нативный вид как в проводнике
  const changedFilesTreeView = vscode.window.createTreeView(
    "vs-git-forge.changedFilesView",
    { treeDataProvider: changedFilesTreeProvider },
  );
  context.subscriptions.push(changedFilesTreeView);

  // Подписка на обновления Git: коммиты, ветки, checkout (как в vscode-git-graph)
  const setupGitStateWatchers = (): void => {
    gitForgeProvider.notifyGitStateChanged();
  };
  void repoManager.getGitApi().then((git) => {
    if (!git) {return;}
    for (const repo of git.repositories) {
      context.subscriptions.push(repo.state.onDidChange(setupGitStateWatchers));
    }
    context.subscriptions.push(
      git.onDidOpenRepository(
        (repo: { state: { onDidChange(fn: () => void): vscode.Disposable } }) => {
          context.subscriptions.push(
            repo.state.onDidChange(setupGitStateWatchers),
          );
        },
      ),
    );
  });
  // FileSystemWatcher: изменения в .git/refs (новые коммиты, ветки, теги) — срабатывает при git commit, branch, pull в терминале
  const gitRefsWatcher =
    vscode.workspace.createFileSystemWatcher("**/.git/refs/**");
  gitRefsWatcher.onDidChange(setupGitStateWatchers);
  gitRefsWatcher.onDidCreate(setupGitStateWatchers);
  gitRefsWatcher.onDidDelete(setupGitStateWatchers);
  context.subscriptions.push(gitRefsWatcher);
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

  // Команды из контекстного меню webview (правый клик по ветке)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vs-git-forge.createBranchFromContext",
      () => gitForgeProvider.runCreateBranchFromContext(),
    ),
    vscode.commands.registerCommand(
      "vs-git-forge.checkoutBranchFromContext",
      () => gitForgeProvider.runCheckoutFromContext(),
    ),
  );

  // Открыть diff по клику на файл в нативном дереве «Changed Files»
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
        if (!repo) {return;}
        const root = repo.rootUri.fsPath;
        let fromHash: string;
        let toHash: string;
        const emptyTree =
          "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
        if (commitHash === "UNCOMMITTED") {
          fromHash = "HEAD";
          toHash = DIFF_UNCOMMITTED;
        } else {
          try {
            fromHash = execSync(`git rev-parse ${JSON.stringify(commitHash + "^")}`, {
              cwd: root,
              encoding: "utf8",
            }).trim();
          } catch {
            fromHash = emptyTree;
          }
          toHash = commitHash;
        }
        const statusEnum =
          status === "added"
            ? GitFileStatus.Added
            : status === "deleted"
              ? GitFileStatus.Deleted
              : GitFileStatus.Modified;
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

  const cmdDisposable = vscode.commands.registerCommand(
    "vs-git-forge.helloWorld",
    () => {
      vscode.window.showInformationMessage(vscode.l10n.t("helloWorld"));
    },
  );
  context.subscriptions.push(cmdDisposable);
  log.debug("Регистрация команд и провайдеров завершена.");
}

// This method is called when your extension is deactivated (в т.ч. при удалении расширения)
export function deactivate(): void {
  log.info("Расширение деактивировано.");
  void runUninstallLifecycle();
}
