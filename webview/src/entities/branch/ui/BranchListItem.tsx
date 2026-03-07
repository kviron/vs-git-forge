import { createSignal } from 'solid-js';
import {
  VsChevronDown,
  VsChevronRight,
  VsGitBranch,
  VsStarFull,
  VsTag,
} from 'solid-icons/vs';
import type { Branch } from '../../../shared/lib/types';

const BRANCH_ICON_SIZE = 16;

interface BranchListItemProps {
  branch: Branch;
  level?: number;
  onSelect?: (branch: Branch) => void;
}

export function BranchListItem(props: BranchListItemProps) {
  const level = () => props.level ?? 0;
  const hasChildren = () => (props.branch.children?.length ?? 0) > 0;
  const [expanded, setExpanded] = createSignal(true);

  const row = (
    <div
      class="branch-list-item"
      classList={{
        selected: props.branch.isSelected,
        current: props.branch.isCurrent,
        favorite: props.branch.isFavorite,
      }}
      style={{ 'padding-left': `${12 + level() * 12}px` }}
      role="treeitem"
      tabIndex={0}
      onClick={() => props.onSelect?.(props.branch)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSelect?.(props.branch);
        }
      }}
    >
      {hasChildren() ? (
        <button
          type="button"
          class="branch-list-item__expand"
          aria-expanded={expanded()}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
        >
          {expanded() ? <VsChevronDown size={12} /> : <VsChevronRight size={12} />}
        </button>
      ) : (
        <span class="branch-list-item__expand-placeholder" />
      )}
      <span
        class="branch-list-item__icon"
        classList={{ 'branch-list-item__icon--current': props.branch.isCurrent }}
        aria-hidden="true"
      >
        {props.branch.isCurrent ? (
          <VsTag size={BRANCH_ICON_SIZE} />
        ) : (
          <VsGitBranch size={BRANCH_ICON_SIZE} />
        )}
      </span>
      <span class="branch-list-item__name">{props.branch.name}</span>
      {props.branch.isFavorite && (
        <span class="branch-list-item__star" aria-label="Избранная ветка">
          <VsStarFull size={12} />
        </span>
      )}
    </div>
  );

  if (hasChildren() && expanded()) {
    return (
      <div class="branch-list-item-group">
        {row}
        <div class="branch-list-item__children">
          {props.branch.children!.map((child) => (
            <BranchListItem
              branch={child}
              level={level() + 1}
              onSelect={props.onSelect}
            />
          ))}
        </div>
      </div>
    );
  }

  return row;
}
