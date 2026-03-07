import { CommitListItem } from "../../entities/commit";
import { CommitSearchFilters } from "../../features/commit-search-filters";
import type { Commit } from "../../shared/lib/types";

interface CommitHistoryProps {
  commits: Commit[];
  selectedCommitHash: string | null;
  onSelectCommit?: (commit: Commit) => void;
}

export function CommitHistory(props: CommitHistoryProps) {
  return (
    <div class="commit-history">
      <CommitSearchFilters />
      <div class="commit-history__list" role="list">
        {props.commits.map((commit) => (
          <CommitListItem
            commit={commit}
            selected={props.selectedCommitHash === commit.hash}
            onSelect={() => props.onSelectCommit?.(commit)}
          />
        ))}
      </div>
    </div>
  );
}
