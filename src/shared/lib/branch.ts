import type { Branch } from './types';

/**
 * Уникальный идентификатор ветки (локальная: имя, удалённая: remote/имя).
 */
export function getBranchId(branch: Branch): string {
  return branch.remote ? `${branch.remote}/${branch.name}` : branch.name;
}

/**
 * Полный ref ветки для Git API (refs/heads/name или refs/remotes/origin/name).
 */
export function getBranchRef(branch: Branch): string {
  return (
    branch.refName ??
    (branch.remote ? `refs/remotes/${branch.remote}/${branch.name}` : `refs/heads/${branch.name}`)
  );
}

/**
 * Проверка равенства двух веток по id.
 */
export function isSameBranch(a: Branch | null | undefined, b: Branch | null | undefined): boolean {
  if (a == null || b == null) return a === b;
  return getBranchId(a) === getBranchId(b);
}
