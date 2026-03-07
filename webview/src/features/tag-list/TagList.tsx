import { createSignal } from 'solid-js';
import { VsChevronDown, VsChevronRight } from 'solid-icons/vs';
import type { Tag } from '../../shared/lib/types';
import { TagListItem } from '../../entities/tag';

interface TagListProps {
  tags: Tag[];
  selectedTag: Tag | null;
  /** Имя текущей ветки (HEAD) для контекстного меню «Merge into» */
  currentBranchName?: string | null;
  onSelectTag?: (tag: Tag) => void;
  defaultExpanded?: boolean;
}

export function TagList(props: TagListProps) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? true);

  return (
    <div class="tag-list">
      <button
        type="button"
        class="tag-list__header"
        aria-expanded={expanded()}
        onClick={() => setExpanded((e) => !e)}
      >
        <span class="tag-list__header-icon" aria-hidden="true">
          {expanded() ? <VsChevronDown size={14} /> : <VsChevronRight size={14} />}
        </span>
        <span class="tag-list__title">Tags</span>
      </button>
      {expanded() && (
        <div class="tag-list__items" role="tree">
          {props.tags.map((tag) => (
            <TagListItem
              tag={tag}
              isSelected={props.selectedTag != null && props.selectedTag.name === tag.name}
              currentBranchName={props.currentBranchName}
              onSelect={props.onSelectTag}
            />
          ))}
        </div>
      )}
    </div>
  );
}
