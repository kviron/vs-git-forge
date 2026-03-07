/**
 * Иконки для контекстного меню — рендер из solid-icons/vs в HTML-строку.
 */
import { renderToString } from 'solid-js/web';
import { VsCopy, VsEdit, VsGitBranch, VsTag } from 'solid-icons/vs';

const ICON_SIZE = 16;

const cache: Record<string, string> = {};

function renderIcon(id: string, Component: (props: { size: number }) => unknown): string {
  if (cache[id]) return cache[id];
  cache[id] = renderToString(() => <Component size={ICON_SIZE} />);
  return cache[id];
}

export type ContextMenuIconId = 'copy' | 'edit' | 'branch' | 'tag';

const iconMap = {
  copy: VsCopy,
  edit: VsEdit,
  branch: VsGitBranch,
  tag: VsTag,
} as const;

export function getContextMenuIconHtml(id: ContextMenuIconId): string {
  const Component = iconMap[id];
  return Component ? renderIcon(id, Component as (props: { size: number }) => unknown) : '';
}
