import { CommitListItem } from "../../entities/commit";
import { CommitSearchFilters } from "../../features/commit-search-filters";
import type { Branch, Commit } from "../../shared/lib/types";
import { getBranchId } from "../../shared/lib/branch";
import { CommitGraph, ROW_HEIGHT } from "../commit-graph";

interface CommitHistoryProps {
  commits: Commit[];
  selectedCommitHash: string | null;
  onSelectCommit?: (commit: Commit) => void;
  loading?: boolean;
  /** Все ветки для фильтра (локальные + удалённые плоским списком) */
  branches?: Branch[];
  /** Текущая ветка (короткое имя) для подписи "Текущая ветка" */
  currentBranchName?: string;
  /** Выбранный ref фильтра (refs/heads/... или refs/remotes/...), null = HEAD */
  branchFilterRef?: string | null;
  /** Выбор ветки в фильтре: ref или null для HEAD */
  onBranchFilterChange?: (ref: string | null) => void;
  /** Список авторов для фильтра User (уникальные из коммитов) */
  authors?: string[];
  /** Выбранный автор в фильтре (null = все) */
  userFilter?: string | null;
  /** Выбор автора в фильтре */
  onUserFilterChange?: (author: string | null) => void;
  /** Текст на кнопке фильтра User */
  userLabel?: string;
  /** Строка поиска по тексту коммита или hash */
  searchQuery?: string;
  /** Изменение строки поиска */
  onSearchChange?: (value: string) => void;
}

export function CommitHistory(props: CommitHistoryProps) {
  const branchLabel = () => {
    if (props.branchFilterRef == null) {
      return props.currentBranchName ? `Ветка: ${props.currentBranchName}` : "Ветка: HEAD";
    }
    const list = props.branches ?? [];
    const branch = list.find((b) => b.refName === props.branchFilterRef);
    return branch ? `Ветка: ${getBranchId(branch)}` : "Ветка: …";
  };

  return (
    <div class="commit-history">
      <CommitSearchFilters
        branches={props.branches ?? []}
        currentBranchName={props.currentBranchName}
        branchFilterRef={props.branchFilterRef ?? null}
        onBranchFilterChange={props.onBranchFilterChange}
        branchLabel={branchLabel()}
        authors={props.authors ?? []}
        userFilter={props.userFilter ?? null}
        onUserFilterChange={props.onUserFilterChange}
        userLabel={props.userLabel ?? "User: Все авторы"}
        searchQuery={props.searchQuery ?? ""}
        onSearchChange={props.onSearchChange}
      />
      {props.loading ? (
        <div class="commit-history__loading">Загрузка коммитов…</div>
      ) : (
        <div class="commit-history__body">
          <div
            class="commit-history__graph-wrap"
            style={{
              height: `${((props.commits ?? []).length || 1) * ROW_HEIGHT}px`,
            }}
            aria-hidden="true"
          >
            <CommitGraph
              commits={props.commits ?? []}
              selectedCommitHash={props.selectedCommitHash}
            />
          </div>
          <div class="commit-history__list" role="list">
            {(props.commits ?? []).map((commit) => (
              <CommitListItem
                commit={commit}
                selected={props.selectedCommitHash === commit.hash}
                onSelect={() => props.onSelectCommit?.(commit)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
