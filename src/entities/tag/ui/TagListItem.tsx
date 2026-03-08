import { VsTag } from 'solid-icons/vs';
import type { Tag } from "@/shared/lib/types";
import { getContextMenu, postMessageToHost } from "@/shared/api";

const TAG_ICON_SIZE = 16;

interface TagListItemProps {
  tag: Tag;
  isSelected?: boolean;
  /** Имя текущей ветки (HEAD) для пункта «Merge into» */
  currentBranchName?: string | null;
  onSelect?: (tag: Tag) => void;
}

export function TagListItem(props: TagListItemProps) {
  const tagName = () => props.tag.name;
  const currentBranch = () => props.currentBranchName ?? null;
  const canMerge = () => {
    const cur = currentBranch();
    return Boolean(cur && cur !== '—');
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const menu = getContextMenu();
    menu.show(
      [
        // Группа 1: Checkout
        [
          {
            title: 'Checkout',
            visible: true,
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'checkoutTag',
                params: { tagName: tagName() },
              });
            },
          },
        ],
        // Группа 2: Show Diff with Working Tree
        [
          {
            title: 'Show Diff with Working Tree',
            visible: true,
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'showDiffWithWorkingTree',
                params: { branchRef: tagName() },
              });
            },
          },
        ],
        // Группа 3: Merge into current branch
        [
          {
            title: `Merge '${tagName()}' into '${currentBranch() ?? ''}'`,
            visible: canMerge(),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'mergeTagIntoCurrent',
                params: { tagName: tagName() },
              });
            },
          },
        ],
        // Группа 4: Push to origin
        [
          {
            title: 'Push to origin',
            visible: true,
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'pushTag',
                params: { tagName: tagName() },
              });
            },
          },
        ],
        // Группа 5: Delete
        [
          {
            title: 'Delete',
            visible: true,
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'deleteTag',
                params: { tagName: tagName() },
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
