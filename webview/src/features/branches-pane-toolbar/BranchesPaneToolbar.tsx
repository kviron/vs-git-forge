import { For } from 'solid-js';
import {
  VsChevronLeft,
  VsAdd,
  VsRefresh,
  VsTrash,
  VsGitCompare,
  VsSearch,
  VsGitFetch,
  VsStarFull,
  VsCompass,
  VsGear,
  VsGroupByRefType,
  VsExpandAll,
  VsCollapseAll,
} from 'solid-icons/vs';
import { IconButton } from '../../shared/ui/IconButton';
import { useSelectedBranch } from '../../shared/context';
import { getBranchId } from '../../shared/lib/branch';
import { vscodeGitApi } from '../../shared/api';

const ICON_SIZE = 16;

const TOOLBAR_ITEMS = [
  { icon: VsChevronLeft, title: 'Скрыть панель' },
  { icon: VsAdd, title: 'New branch' },
  { icon: VsRefresh, title: 'Update selected' },
  { icon: VsTrash, title: 'Delete branch' },
  { icon: VsGitCompare, title: 'Compare with current' },
  { icon: VsSearch, title: 'Show my branches' },
  { icon: VsGitFetch, title: 'Fetch' },
  { icon: VsStarFull, title: 'Mark/unmark as favorite' },
  { icon: VsCompass, title: 'Navigate log to branch head' },
  { icon: VsGear, title: 'Branches pane settings' },
  { icon: VsGroupByRefType, title: 'Group by directory' },
  { icon: VsExpandAll, title: 'Expand all' },
  { icon: VsCollapseAll, title: 'Collapse all' },
] as const;

/** Индекс выделенной иконки (Group by directory) */
const ACTIVE_ICON_INDEX = 10;
/** Индекс кнопки New branch в TOOLBAR_ITEMS */
const NEW_BRANCH_ICON_INDEX = 1;

export function BranchesPaneToolbar() {
  const { selectedBranch } = useSelectedBranch();

  const handleNewBranch = () => {
    const ref = selectedBranch() ? getBranchId(selectedBranch()!) : '';
    vscodeGitApi.showCreateBranchDialog(ref).catch((err) => {
      console.error('showCreateBranchDialog:', err);
    });
  };

  return (
    <div class="branches-pane-toolbar" role="toolbar">
      <For each={[...TOOLBAR_ITEMS]}>
        {(item, index) => {
          const IconComponent = item.icon;
          const isNewBranch = index() === NEW_BRANCH_ICON_INDEX;
          return (
            <IconButton
              iconSlot={<IconComponent size={ICON_SIZE} />}
              title={item.title}
              active={index() === ACTIVE_ICON_INDEX}
              onClick={isNewBranch ? handleNewBranch : undefined}
            />
          );
        }}
      </For>
    </div>
  );
}
