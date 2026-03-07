import { CommitListItem } from "../../entities/commit";
import { CommitSearchFilters } from "../../features/commit-search-filters";
import type { Commit } from "../../shared/lib/types";
import { CommitGraph, ROW_HEIGHT } from "../commit-graph";

interface CommitHistoryProps {
  commits: Commit[];
  selectedCommitHash: string | null;
  onSelectCommit?: (commit: Commit) => void;
  loading?: boolean;
}

export function CommitHistory(props: CommitHistoryProps) {
  return (
    <div class="commit-history">
      <CommitSearchFilters />
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
