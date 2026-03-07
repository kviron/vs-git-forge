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
/** Индекс кнопки Update selected в TOOLBAR_ITEMS */
const UPDATE_SELECTED_ICON_INDEX = 2;

interface BranchesPaneToolbarProps {
  onBranchesRefresh?: () => void;
}

export function BranchesPaneToolbar(props: BranchesPaneToolbarProps) {
  const { selectedBranch } = useSelectedBranch();

  /** Выбрана локальная ветка с upstream (можно pull); активна в первую очередь когда ветка отстаёт (behind > 0) */
  const canUpdateSelected = () => {
    const branch = selectedBranch();
    if (!branch || branch.remote) return false;
    return (branch.behind ?? 0) > 0 || branch.hasUpstream === true;
  };

  const handleNewBranch = () => {
    const ref = selectedBranch() ? getBranchId(selectedBranch()!) : '';
    vscodeGitApi.showCreateBranchDialog(ref).catch((err) => {
      console.error('showCreateBranchDialog:', err);
    });
  };

  const handleUpdateSelected = () => {
    const branch = selectedBranch();
    if (!branch || branch.remote) return;
    if (!branch.hasUpstream && (branch.behind ?? 0) <= 0) return;
    vscodeGitApi
      .pullBranch(branch.name)
      .then(() => {
        props.onBranchesRefresh?.();
      })
      .catch((err) => {
        console.error('pullBranch:', err);
      });
  };

  return (
    <div class="branches-pane-toolbar" role="toolbar">
      <For each={[...TOOLBAR_ITEMS]}>
        {(item, index) => {
          const IconComponent = item.icon;
          const isNewBranch = index() === NEW_BRANCH_ICON_INDEX;
          const isUpdateSelected = index() === UPDATE_SELECTED_ICON_INDEX;
          const updateEnabled = isUpdateSelected && canUpdateSelected();
          const onClick = isNewBranch
            ? handleNewBranch
            : isUpdateSelected
              ? updateEnabled
                ? handleUpdateSelected
                : undefined
              : undefined;
          return (
            <IconButton
              iconSlot={<IconComponent size={ICON_SIZE} />}
              title={item.title}
              active={index() === ACTIVE_ICON_INDEX}
              disabled={isUpdateSelected && !updateEnabled}
              onClick={onClick}
            />
          );
        }}
      </For>
    </div>
  );
}
