/** Статусы из vscode git (extensions/git/src/api/git.d.ts). */
export const GitStatus = {
  INDEX_ADDED: 1,
  INDEX_DELETED: 2,
  INDEX_MODIFIED: 0,
  MODIFIED: 5,
  DELETED: 6,
  UNTRACKED: 7,
  INTENT_TO_ADD: 9,
} as const;

/** Цвета статуса из темы Git: зелёный — создан, синий — изменён, красный — удалён */
export const GIT_STATUS_THEME_IDS = {
  added: "gitDecoration.addedResourceForeground",
  modified: "gitDecoration.modifiedResourceForeground",
  deleted: "gitDecoration.deletedResourceForeground",
} as const;

export function gitStatusToKind(
  status: number,
): "added" | "modified" | "deleted" {
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
