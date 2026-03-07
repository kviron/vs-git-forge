import type { Commit } from '../../../shared/lib/types';

interface CommitListItemProps {
  commit: Commit;
  selected?: boolean;
  onSelect?: () => void;
}

export function CommitListItem(props: CommitListItemProps) {
  return (
    <div
      class="commit-list-item"
      classList={{
        selected: props.selected,
        merge: props.commit.isMerge,
      }}
      role="button"
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSelect?.();
        }
      }}
    >
      <div class="commit-list-item__message">{props.commit.message}</div>
      <div class="commit-list-item__author">{props.commit.author}</div>
      <div class="commit-list-item__date">
        {props.commit.dateRelative ?? props.commit.date}
      </div>
    </div>
  );
}
