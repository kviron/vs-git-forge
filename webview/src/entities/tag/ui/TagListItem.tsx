import { VsTag } from 'solid-icons/vs';
import type { Tag } from '../../../shared/lib/types';
import { getContextMenu, postMessageToHost } from '../../../shared/api';

const TAG_ICON_SIZE = 16;

interface TagListItemProps {
  tag: Tag;
  isSelected?: boolean;
  onSelect?: (tag: Tag) => void;
}

export function TagListItem(props: TagListItemProps) {
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const menu = getContextMenu();
    menu.show(
      [
        [
          {
            title: 'Delete',
            visible: true,
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'deleteTag',
                params: { tagName: props.tag.name },
              });
            },
          },
        ],
      ],
      e,
      document.body
    );
  };

  return (
    <div
      class="tag-list-item"
      classList={{ selected: props.isSelected }}
      role="treeitem"
      tabIndex={0}
      onClick={() => props.onSelect?.(props.tag)}
      onContextMenu={onContextMenu}
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
