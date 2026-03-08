import type { Branch, ChangedFile, Commit, Tag } from "../lib/types";
import type {
  ApiRequest,
  ApiResponse,
  BranchesPayload,
  ChangedFilesPayload,
  IdeContextPayload,
  RepositoryRootPayload,
} from "./types";

declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage(msg: unknown): void;
      getState(): unknown;
      setState(state: unknown): void;
    };
  }
}

let vsCodeApiInstance: ReturnType<NonNullable<Window["acquireVsCodeApi"]>> | null = null;

/** Получить API VS Code. Вызывать acquireVsCodeApi() можно только один раз за время жизни webview. */
function getVsCodeApi() {
  if (typeof window.acquireVsCodeApi === "undefined") {
    return null;
  }
  if (vsCodeApiInstance !== null) {
    return vsCodeApiInstance;
  }
  try {
    vsCodeApiInstance = window.acquireVsCodeApi();
    return vsCodeApiInstance;
  } catch {
    return null;
  }
}

let nextRequestId = 0;
const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

function genRequestId(): string {
  return `req_${++nextRequestId}_${Date.now()}`;
}

const gitStateChangedListeners = new Set<() => void>();

/** Слушатель ответов от extension (один раз на всё приложение) */
function initMessageListener() {
  window.addEventListener("message", async (event: MessageEvent<ApiResponse | { type: "gitStateChanged" }>) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === "gitStateChanged") {
      const { log } = await import("../logger");
      log.debug("vscodeApi: gitStateChanged получен, вызов listeners:", gitStateChangedListeners.size);
      gitStateChangedListeners.forEach((cb) => cb());
      return;
    }
    if (msg.type !== "response" || !("requestId" in msg) || !msg.requestId) {
      return;
    }
    const entry = pending.get(msg.requestId);
    if (!entry) {
      return;
    }
    pending.delete(msg.requestId);
    if (msg.error) {
      entry.reject(new Error(msg.error));
    } else {
      entry.resolve(msg.data);
    }
  });
}

/**
 * Подписаться на уведомления об изменении состояния Git (новый коммит, смена ветки и т.д.).
 * @returns функция отписки
 */
export function onGitStateChanged(callback: () => void): () => void {
  ensureListener();
  gitStateChangedListeners.add(callback);
  return () => {
    gitStateChangedListeners.delete(callback);
  };
}

let listenerInited = false;

function ensureListener() {
  if (!listenerInited) {
    listenerInited = true;
    initMessageListener();
  }
}

/**
 * Отправить запрос в extension и дождаться ответа.
 */
function request<T>(
  method: ApiRequest["method"],
  params?: Record<string, unknown>,
): Promise<T> {
  const api = getVsCodeApi();
  if (!api) {
    return Promise.reject(new Error("VS Code API недоступен (не в webview)"));
  }
  ensureListener();
  const requestId = genRequestId();
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    const req: ApiRequest = { type: "request", requestId, method, params };
    api.postMessage(req);
  });
}

/**
 * API для взаимодействия с VS Code/Cursor extension.
 * Работает только внутри webview панели расширения.
 */
export class VscodeGitApi {
  /** Текущая ветка (имя или null) */
  getCurrentBranch(): Promise<string | null> {
    return request<string | null>("getCurrentBranch");
  }

  /** Локальные ветки в формате UI */
  getLocalBranches(): Promise<Branch[]> {
    return request<Branch[]>("getLocalBranches");
  }

  /** Удалённые ветки (дерево по remote) */
  getRemoteBranches(): Promise<Branch[]> {
    return request<Branch[]>("getRemoteBranches");
  }

  /** Список тегов */
  getTags(): Promise<Tag[]> {
    return request<Tag[]>("getTags");
  }

  /** Всё сразу: текущая ветка + локальные + удалённые + теги */
  getBranches(): Promise<BranchesPayload> {
    return request<BranchesPayload>("getBranches");
  }

  /**
   * История коммитов для указанной ветки или HEAD.
   * @param maxEntries — максимум записей (по умолчанию 100)
   * @param ref — ref ветки (refs/heads/name или refs/remotes/origin/name), по умолчанию HEAD
   */
  getCommits(params?: { maxEntries?: number; ref?: string }): Promise<Commit[]> {
    return request<Commit[]>("getCommits", params);
  }

  /** Изменённые файлы (working tree + index) */
  getChangedFiles(): Promise<ChangedFile[]> {
    return request<ChangedFilesPayload>("getChangedFiles").then((p) => p.files);
  }

  /** Изменённые файлы в указанном коммите */
  getCommitChangedFiles(commitHash: string): Promise<ChangedFile[]> {
    return request<ChangedFilesPayload>("getCommitChangedFiles", {
      commitHash,
    }).then((p) => p.files);
  }

  /** Корень репозитория (путь) или null */
  getRepositoryRoot(): Promise<string | null> {
    return request<RepositoryRootPayload>("getRepositoryRoot").then(
      (p) => p.root,
    );
  }

  /** Контекст IDE: язык, тема, appName, appHost, uiKind (для локализации и темизации) */
  getIdeContext(): Promise<IdeContextPayload> {
    return request<IdeContextPayload>("getIdeContext");
  }

  /** Инициализировать Git-репозиторий в текущей папке (или в rootUri, если передан) */
  initRepo(rootUri?: string): Promise<void> {
    return request<{ success: boolean }>(
      "initRepo",
      rootUri ? { rootUri } : undefined,
    ).then(() => undefined);
  }

  /**
   * Показать диалог создания новой ветки из выбранной ветки.
   * @param sourceBranchName — имя/ref выделенной ветки для заголовка и как ref для git (например "main" или "origin/feature")
   * @returns имя созданной ветки или null при отмене
   */
  showCreateBranchDialog(sourceBranchName: string): Promise<string | null> {
    return request<string | null>("showCreateBranchDialog", {
      sourceBranchName,
    });
  }

  /**
   * Показать диалог создания новой ветки из указанного коммита (по hash).
   * @param commitHash — полный hash коммита
   * @returns имя созданной ветки или null при отмене
   */
  showCreateBranchFromCommit(commitHash: string): Promise<string | null> {
    return request<string | null>("showCreateBranchDialog", {
      sourceCommitHash: commitHash,
    });
  }

  /**
   * Показать диалог создания тега на указанном коммите (revision).
   * @param commitHash — полный hash коммита
   * @returns имя созданного тега или null при отмене
   */
  showCreateTagDialog(commitHash: string): Promise<string | null> {
    return request<string | null>("showCreateTagDialog", {
      commitHash,
    });
  }

  /** Обновить выбранную локальную ветку (git pull). Ветка должна отставать от remote. */
  pullBranch(branchName: string): Promise<{ success: boolean }> {
    return request<{ success: boolean }>("pullBranch", { branchName });
  }

  /** Есть ли доступ к VS Code API (мы в webview) */
  static isAvailable(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.acquireVsCodeApi !== "undefined"
    );
  }
}

/** Единственный экземпляр API для webview */
export const vscodeGitApi = new VscodeGitApi();

/** Отправить сообщение в extension (использует кэшированный API, не вызывает acquireVsCodeApi повторно). */
export function postMessageToHost(message: unknown): void {
  const api = getVsCodeApi();
  api?.postMessage(message);
}

/** Параметры для открытия Diff (две ревизии файла). */
export interface ViewDiffParams {
  fromHash: string;
  toHash: string;
  oldFilePath: string;
  newFilePath: string;
  type: "added" | "modified" | "deleted";
}

/** Параметры для открытия файла в ревизии. */
export interface ViewFileAtRevisionParams {
  hash: string;
  filePath: string;
  type?: "added" | "modified" | "deleted";
}

/**
 * Открыть встроенный Diff View: сравнение двух ревизий файла.
 * По образцу vscode-git-graph (viewDiff).
 */
export function sendViewDiff(params: ViewDiffParams): void {
  postMessageToHost({ type: "command", command: "viewDiff", params });
}

/**
 * Открыть файл в указанной ревизии в редакторе.
 * По образцу vscode-git-graph (viewFileAtRevision).
 */
export function sendViewFileAtRevision(params: ViewFileAtRevisionParams): void {
  postMessageToHost({ type: "command", command: "viewFileAtRevision", params });
}
