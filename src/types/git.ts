/**
 * Хелперы для статусов Git. Числовые значения — enum Status из vscode-git.d.ts.
 */

import { Status } from "./vscode-git";

/** Цвета статуса из темы Git: зелёный — создан, синий — изменён, красный — удалён */
export const GIT_STATUS_THEME_IDS = {
  added: "gitDecoration.addedResourceForeground",
  modified: "gitDecoration.modifiedResourceForeground",
  deleted: "gitDecoration.deletedResourceForeground",
} as const;

/** Сводит Status (vscode.git) к виду для webview: added | modified | deleted */
export function gitStatusToKind(
  status: number,
): "added" | "modified" | "deleted" {
  if (
    status === Status.INDEX_ADDED ||
    status === Status.UNTRACKED ||
    status === Status.INTENT_TO_ADD
  ) {
    return "added";
  }
  if (status === Status.INDEX_DELETED || status === Status.DELETED) {
    return "deleted";
  }
  return "modified";
}
