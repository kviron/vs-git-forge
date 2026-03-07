import type { Branch, ChangedFile, Commit, Tag } from "../lib/types";
import type {
  ApiRequest,
  ApiResponse,
  BranchesPayload,
  ChangedFilesPayload,
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

function getVsCodeApi() {
  if (typeof window.acquireVsCodeApi === "undefined") {
    return null;
  }
  return window.acquireVsCodeApi();
}

let nextRequestId = 0;
const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

function genRequestId(): string {
  return `req_${++nextRequestId}_${Date.now()}`;
}

/** Слушатель ответов от extension (один раз на всё приложение) */
function initMessageListener() {
  window.addEventListener("message", (event: MessageEvent<ApiResponse>) => {
    const msg = event.data;
    if (!msg || msg.type !== "response" || !msg.requestId) {
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
   * История коммитов.
   * @param maxEntries — максимум записей (по умолчанию 50)
   * @param ref — ветка/ref (по умолчанию HEAD)
   */
  getCommits(params?: {
    maxEntries?: number;
    ref?: string;
  }): Promise<Commit[]> {
    return request<Commit[]>("getCommits", params);
  }

  /** Изменённые файлы (working tree + index) */
  getChangedFiles(): Promise<ChangedFile[]> {
    return request<ChangedFilesPayload>("getChangedFiles").then((p) => p.files);
  }

  /** Корень репозитория (путь) или null */
  getRepositoryRoot(): Promise<string | null> {
    return request<RepositoryRootPayload>("getRepositoryRoot").then(
      (p) => p.root,
    );
  }

  /** Инициализировать Git-репозиторий в текущей папке (или в rootUri, если передан) */
  initRepo(rootUri?: string): Promise<void> {
    return request<{ success: boolean }>(
      "initRepo",
      rootUri ? { rootUri } : undefined,
    ).then(() => undefined);
  }

  /**
   * Показать диалог создания новой ветки из выбранной.
   * @param sourceBranchName — имя/ref выделенной ветки для заголовка и как ref для git (например "main" или "origin/feature")
   * @returns имя созданной ветки или null при отмене
   */
  showCreateBranchDialog(sourceBranchName: string): Promise<string | null> {
    return request<string | null>("showCreateBranchDialog", {
      sourceBranchName,
    });
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
