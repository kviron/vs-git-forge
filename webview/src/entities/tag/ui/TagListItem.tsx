import { VsTag } from 'solid-icons/vs';
import type { Tag } from '../../../shared/lib/types';

const TAG_ICON_SIZE = 16;

interface TagListItemProps {
  tag: Tag;
  isSelected?: boolean;
  onSelect?: (tag: Tag) => void;
}

export function TagListItem(props: TagListItemProps) {
  return (
    <div
      class="tag-list-item"
      classList={{ selected: props.isSelected }}
      role="treeitem"
      tabIndex={0}
      onClick={() => props.onSelect?.(props.tag)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSelect?.(props.tag);
        }
      }}
    >
      <span class="tag-list-item__icon" aria-hidden="true">
        <VsTag size={TAG_ICON_SIZE} />
      </span>
      <span class="tag-list-item__name">{props.tag.name}</span>
    </div>
  );
}
