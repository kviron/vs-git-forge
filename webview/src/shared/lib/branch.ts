import type { Branch } from './types';

/**
 * Уникальный идентификатор ветки (локальная: имя, удалённая: remote/имя).
 */
export function getBranchId(branch: Branch): string {
  return branch.remote ? `${branch.remote}/${branch.name}` : branch.name;
}

/**
 * Проверка равенства двух веток по id.
 */
export function isSameBranch(a: Branch | null | undefined, b: Branch | null | undefined): boolean {
  if (a == null || b == null) return a === b;
  return getBranchId(a) === getBranchId(b);
}

/**
 * Возвращает копии веток с проставленным isSelected по выбранной ветке.
 */
export function withSelectedBranches(
  branches: Branch[],
  selected: Branch | null
): Branch[] {
  return branches.map((b) => ({
    ...b,
    isSelected: isSameBranch(b, selected),
    children: b.children
      ? withSelectedBranches(b.children, selected)
      : undefined,
  }));
}
