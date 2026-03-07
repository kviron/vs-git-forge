import type { Commit, ChangedFile } from '../../shared/lib/types';
import { ChangedFiles } from '../../features/changed-files';
import { CommitDetailsCard } from '../../features/commit-details-card';

interface CommitDetailsPanelProps {
  commit: Commit | null;
  changedFiles: ChangedFile[];
  repoName?: string;
}

export function CommitDetailsPanel(props: CommitDetailsPanelProps) {
  return (
    <div class="commit-details-panel">
      <div class="commit-details-panel__files">
        <ChangedFiles
          repoName={props.repoName}
          files={props.changedFiles}
        />
      </div>
      <div class="commit-details-panel__details">
        {props.commit ? (
          <CommitDetailsCard commit={props.commit} />
        ) : (
          <div class="commit-details-panel__empty">
            Выберите коммит для просмотра деталей
          </div>
        )}
      </div>
    </div>
  );
}
