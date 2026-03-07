import type { Commit } from '../../../shared/lib/types';
import { getContextMenu, postMessageToHost, vscodeGitApi } from '../../../shared/api';
import { UNCOMMITTED_HASH } from '../../../shared/lib/types';
import { getContextMenuIconHtml } from '../../../shared/lib/contextMenuIcons';

interface CommitListItemProps {
  commit: Commit;
  selected?: boolean;
  onSelect?: () => void;
}

export function CommitListItem(props: CommitListItemProps) {
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (props.commit.hash === UNCOMMITTED_HASH) return;
    const menu = getContextMenu();
    menu.show(
      [
        [
          {
            title: 'Copy revision number',
            visible: true,
            onClick: () => {
              void navigator.clipboard.writeText(props.commit.hash);
            },
            icon: getContextMenuIconHtml('copy'),
          },
          {
            title: 'Edit commit message',
            visible: true,
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'editCommitMessage',
                params: {
                  commitHash: props.commit.hash,
                  message: props.commit.message ?? '',
                },
              });
            },
            icon: getContextMenuIconHtml('edit'),
          },
          {
            title: 'New branch',
            visible: true,
            onClick: () => {
              vscodeGitApi.showCreateBranchFromCommit(props.commit.hash).catch((err) => {
                console.error('showCreateBranchFromCommit:', err);
              });
            },
            icon: getContextMenuIconHtml('branch'),
          },
          {
            title: 'New tag',
            visible: true,
            onClick: () => {
              vscodeGitApi.showCreateTagDialog(props.commit.hash).catch((err) => {
                console.error('showCreateTagDialog:', err);
              });
            },
            icon: getContextMenuIconHtml('tag'),
          },
        ],
      ],
      e,
      document.body,
    );
  };

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
      onContextMenu={onContextMenu}
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
