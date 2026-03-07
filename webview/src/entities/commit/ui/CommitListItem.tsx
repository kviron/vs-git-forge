import type { Commit } from '../../../shared/lib/types';

interface CommitListItemProps {
  commit: Commit;
  selected?: boolean;
  onSelect?: () => void;
}

/** Визуализация одной колонки графа (линия + точка) */
function GraphCell(props: { row: number[]; isSelected?: boolean }) {
  const row = () => props.row;
  return (
    <div class="commit-graph-cell" classList={{ selected: props.isSelected }}>
      {row().map((r, i) => (
        <div
          class="commit-graph-cell__line"
          classList={{
            dot: r === 1,
            merge: r === 2,
            line: r === 0,
          }}
          style={{ '--lane': i }}
        />
      ))}
    </div>
  );
}

export function CommitListItem(props: CommitListItemProps) {
  const graphRow = () => props.commit.graphRow ?? [1];

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
      <div class="commit-list-item__graph">
        <GraphCell row={graphRow()} isSelected={props.selected} />
      </div>
      <div class="commit-list-item__message">{props.commit.message}</div>
      <div class="commit-list-item__author">{props.commit.author}</div>
      <div class="commit-list-item__date">
        {props.commit.dateRelative ?? props.commit.date}
      </div>
    </div>
  );
}
