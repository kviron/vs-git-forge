/**
 * Провайдер содержимого файла из конкретной ревизии Git для Diff View.
 * По образцу vscode-git-graph DiffDocProvider.
 */

import * as path from "path";
import * as vscode from "vscode";
import { log } from "./logger";

/** Сторона в сравнении: старая (до) или новая (после). */
export const enum DiffSide {
  Old,
  New,
}

/** Статус файла в изменении (для выбора URI: реальный файл или git-forge://). */
export const enum GitFileStatus {
  Added = "added",
  Modified = "modified",
  Deleted = "deleted",
}

/** Хеш «незакоммиченные изменения» — показываем файл с диска. */
export const UNCOMMITTED = "UNCOMMITTED";

export type GetCommitFileFn = (
  repo: string,
  commit: string,
  filePath: string,
  partnerCommit?: string,
) => Promise<string>;

/**
 * Предоставляет содержимое файла на указанной ревизии для встроенного Diff View.
 */
export class DiffDocProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = "git-forge";

  private readonly getCommitFile: GetCommitFileFn;
  private readonly docs = new Map<string, string>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

  readonly onDidChange: vscode.Event<vscode.Uri> = this.onDidChangeEmitter.event;

  constructor(getCommitFile: GetCommitFileFn) {
    this.getCommitFile = getCommitFile;

    // Очищаем кэш при закрытии документа
    const sub = vscode.workspace.onDidCloseTextDocument((doc) => {
      this.docs.delete(doc.uri.toString());
    });
    // Dispose не храним — провайдер живёт до выгрузки расширения
  }

  provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
    const cached = this.docs.get(uri.toString());
    if (cached !== undefined) {
      return cached;
    }

    const request = decodeDiffDocUri(uri);
    if (!request.exists) {
      return "";
    }

    return this.getCommitFile(
      request.repo,
      request.commit,
      request.filePath,
      request.partnerCommit,
    )
      .then((contents) => {
        this.docs.set(uri.toString(), contents);
        return contents;
      })
      .catch((err: unknown) => {
        log.errorException(err, "DiffDocProvider: загрузка файла для сравнения");
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(
          "Не удалось загрузить файл для сравнения: " + msg,
        );
        return "";
      });
  }
}

/** Данные, закодированные в URI git-forge://... */
export interface DiffDocUriData {
  filePath: string;
  commit: string;
  repo: string;
  exists: boolean;
  /** Коммит второй стороны (для левой — правый), чтобы при «файл добавлен» подставить его содержимое. */
  partnerCommit?: string;
}

/**
 * Строит URI файла для одной стороны Diff View.
 * Для UNCOMMITTED и не-Deleted возвращает file:// (реальный путь).
 * Иначе — git-forge://...?base64(data).
 */
export function encodeDiffDocUri(
  repo: string,
  filePath: string,
  commit: string,
  type: GitFileStatus,
  diffSide: DiffSide,
  partnerCommit?: string,
): vscode.Uri {
  if (commit === UNCOMMITTED && type !== GitFileStatus.Deleted) {
    return vscode.Uri.file(path.join(repo, filePath));
  }

  const fileDoesNotExist =
    (diffSide === DiffSide.Old && type === GitFileStatus.Added) ||
    (diffSide === DiffSide.New && type === GitFileStatus.Deleted);

  const filePathNorm = path.sep === "\\" ? filePath.replace(/\\/g, "/") : filePath;
  const data: DiffDocUriData = {
    filePath: filePathNorm,
    commit,
    repo,
    exists: !fileDoesNotExist,
    ...(partnerCommit ? { partnerCommit } : {}),
  };

  let extension = "";
  if (!fileDoesNotExist) {
    const lastSlash = data.filePath.lastIndexOf("/");
    const dot = data.filePath.indexOf(".", lastSlash + 1);
    extension = dot > -1 ? data.filePath.substring(dot) : "";
  }

  const query = Buffer.from(JSON.stringify(data)).toString("base64");
  return vscode.Uri.file("file" + extension).with({
    scheme: DiffDocProvider.scheme,
    query,
  });
}

export function decodeDiffDocUri(uri: vscode.Uri): DiffDocUriData {
  return JSON.parse(
    Buffer.from(uri.query, "base64").toString("utf8"),
  ) as DiffDocUriData;
}
