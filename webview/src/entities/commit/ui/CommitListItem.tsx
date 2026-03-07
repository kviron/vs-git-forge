import { HoverCard } from '@ark-ui/solid/hover-card';
import md5 from 'md5';
import { Portal } from 'solid-js/web';
import type { Commit } from '../../../shared/lib/types';
import { getContextMenu, postMessageToHost, vscodeGitApi } from '../../../shared/api';
import { UNCOMMITTED_HASH } from '../../../shared/lib/types';
import { getContextMenuIconHtml } from '../../../shared/lib/contextMenuIcons';

/** URL Gravatar по email (как в Git-экосистеме); d=404 — без дефолтной картинки при отсутствии */
function getGravatarUrl(email: string): string {
  const hash = (md5 as (s: string) => string)(email.toLowerCase().trim());
  return `https://www.gravatar.com/avatar/${hash}?s=96&d=404`;
}

/** Запасной URL аватарки по имени (инициалы) */
function getInitialsAvatarUrl(name: string): string {
  const encoded = encodeURIComponent(name.trim() || '?');
  return `https://ui-avatars.com/api/?name=${encoded}&size=64&background=random`;
}

/** Приоритет: 1) хост (GitHub/GitLab), 2) Gravatar, 3) инициалы */
function getPrimaryAvatarUrl(commit: {
  author: string;
  authorEmail?: string;
  authorAvatarUrl?: string;
}): string {
  if (commit.authorAvatarUrl) return commit.authorAvatarUrl;
  if (commit.authorEmail) return getGravatarUrl(commit.authorEmail);
  return getInitialsAvatarUrl(commit.author);
}

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
      <div class="commit-list-item__author">
        {props.commit.hash === UNCOMMITTED_HASH ? (
          props.commit.author || '—'
        ) : (
          <HoverCard.Root openDelay={400} closeDelay={200}>
            <HoverCard.Trigger
              asChild={(triggerProps) => (
                <span
                  class="commit-list-item__author-trigger"
                  {...(typeof triggerProps === 'function' ? triggerProps() : triggerProps)}
                >
                  {props.commit.author}
                </span>
              )}
            />
            <Portal>
              <HoverCard.Positioner>
                <HoverCard.Content class="commit-author-hover-card__content">
                  <HoverCard.Arrow>
                    <HoverCard.ArrowTip />
                  </HoverCard.Arrow>
                  <div class="commit-author-hover-card__body">
                    <div class="commit-author-hover-card__top">
                      <img
                        class="commit-author-hover-card__avatar"
                        src={getPrimaryAvatarUrl(props.commit)}
                        alt=""
                        onError={(e) => {
                          const el = e.currentTarget;
                          const initials = getInitialsAvatarUrl(props.commit.author);
                          if (el.src.includes('gravatar.com')) {
                            el.src = initials;
                          } else if (props.commit.authorAvatarUrl && el.src === props.commit.authorAvatarUrl) {
                            el.src = props.commit.authorEmail
                              ? getGravatarUrl(props.commit.authorEmail)
                              : initials;
                          }
                        }}
                      />
                      <div class="commit-author-hover-card__info">
                      <p class="commit-author-hover-card__name">{props.commit.author}</p>
                      {props.commit.authorEmail && (
                        <p class="commit-author-hover-card__email">{props.commit.authorEmail}</p>
                      )}
                      </div>
                    </div>
                    <p class="commit-author-hover-card__meta">
                      Author of this commit
                      {props.commit.date ? ` · ${props.commit.date}` : ''}
                    </p>
                  </div>
                </HoverCard.Content>
              </HoverCard.Positioner>
            </Portal>
          </HoverCard.Root>
        )}
      </div>
      <div class="commit-list-item__date">
        {props.commit.dateRelative ?? props.commit.date}
      </div>
    </div>
  );
}
