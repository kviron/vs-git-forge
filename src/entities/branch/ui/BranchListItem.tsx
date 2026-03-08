import { createSignal } from 'solid-js';
import {
  VsChevronDown,
  VsChevronRight,
  VsGitBranch,
  VsStarFull,
  VsTag,
} from 'solid-icons/vs';
import type { Branch } from "@/shared/lib/types";
import { getBranchId, getBranchRef, isSameBranch } from "@/shared/lib/branch";
import { useSelectedBranch } from "@/shared/context";
import { getContextMenu, postMessageToHost } from "@/shared/api";
import { log } from "@/shared/logger";

const BRANCH_ICON_SIZE = 16;

interface BranchListItemProps {
  branch: Branch;
  /** Текущая ветка (HEAD) — используется как цель для Merge/Compare, если в списке ничего не выбрано */
  currentBranch?: Branch | null;
  level?: number;
  onSelect?: (branch: Branch) => void;
  /** Двойной клик по ветке — установить фильтр коммитов по этой ветке */
  onDoubleClick?: (branchRef: string) => void;
}

export function BranchListItem(props: BranchListItemProps) {
  const { selectedBranch } = useSelectedBranch();
  const level = () => props.level ?? 0;
  const hasChildren = () => (props.branch.children?.length ?? 0) > 0;
  const [expanded, setExpanded] = createSignal(true);

  const branchRef = () => getBranchId(props.branch);
  const isCurrent = () => props.branch.isCurrent;
  const isSelected = () => isSameBranch(props.branch, selectedBranch());

  const clickedName = () => props.branch.name;
  const selected = () => selectedBranch();
  const current = () => props.currentBranch ?? null;
  /** Ветка «другая» для Merge/Compare/Rebase: выбранная в списке, иначе текущая (HEAD), если клик не по ней */
  const otherBranch = () => {
    const sel = selected();
    if (sel != null && !isSameBranch(props.branch, sel)) return sel;
    const cur = current();
    if (cur != null && !isSameBranch(props.branch, cur)) return cur;
    return null;
  };
  const otherRef = () => (otherBranch() ? getBranchId(otherBranch()!) : null);
  const otherName = () => otherBranch()?.name ?? '';
  const hasOther = () => otherBranch() != null;
  const isLocal = () => !props.branch.remote;

  const onContextMenu = (e: MouseEvent) => {
    log.debug("BranchListItem: onContextMenu вызван, branchRef:", branchRef());
    e.preventDefault();
    e.stopPropagation(); // иначе contextmenu всплывает до document и ContextMenu сразу закрывает меню
    postMessageToHost({
      type: 'setContextMenuBranch',
      branchRef: branchRef(),
    });
    const menu = getContextMenu();
    menu.show(
      [
        // Группа 1: Checkout, New Branch, Checkout and Rebase onto selected
        [
          {
            title: 'Checkout',
            visible: !isCurrent(),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'checkoutBranch',
                params: { branchRef: branchRef() },
              });
            },
          },
          {
            title: `New Branch from '${clickedName()}'...`,
            visible: true,
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'createBranchFromContext',
              });
            },
          },
          {
            title: `Checkout and Rebase onto '${otherName()}'`,
            visible: hasOther() && !isCurrent(),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'checkoutAndRebase',
                params: { branchRef: branchRef(), ontoBranchRef: otherRef() },
              });
            },
          },
        ],
        // Группа 2: Compare, Show Diff with Working Tree
        [
          {
            title: `Compare with '${otherName()}'`,
            visible: hasOther(),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'compareBranches',
                params: { branchRef: branchRef(), otherBranchRef: otherRef() },
              });
            },
          },
          {
            title: 'Show Diff with Working Tree',
            visible: isLocal(),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'showDiffWithWorkingTree',
                params: { branchRef: branchRef() },
              });
            },
          },
        ],
        // Группа 3: Rebase other onto clicked, Merge clicked into other
        [
          {
            title: `Rebase '${otherName()}' onto '${clickedName()}'`,
            visible: hasOther(),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'rebaseOnto',
                params: { branchToRebaseRef: otherRef(), ontoBranchRef: branchRef() },
              });
            },
          },
          {
            title: `Merge '${clickedName()}' into '${otherName()}'`,
            visible: hasOther(),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'mergeInto',
                params: { sourceBranchRef: branchRef(), targetBranchRef: otherRef() },
              });
            },
          },
        ],
        // Группа 4: Push
        [
          {
            title: 'Push...',
            visible: isLocal(),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'pushBranch',
                params: { branchRef: branchRef() },
              });
            },
          },
        ],
        // Группа 5: Rename, Delete
        [
          {
            title: 'Rename...',
            visible: isLocal(),
            shortcut: 'F2',
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'renameBranch',
                params: { branchRef: branchRef() },
              });
            },
          },
          {
            title: 'Delete',
            visible: !isCurrent(),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: isLocal() ? 'deleteBranch' : 'deleteRemoteBranch',
                params: { branchRef: branchRef(), remote: props.branch.remote },
              });
            },
          },
        ],
      ],
      e,
      document.body
    );
  };

  const row = (
    <div
      class="branch-list-item"
      classList={{
        selected: isSelected(),
        current: props.branch.isCurrent,
        main: props.branch.isMain,
        favorite: props.branch.isFavorite,
      }}
      style={{ 'padding-left': `${12 + level() * 12}px` }}
      role="treeitem"
      tabIndex={0}
      onClick={() => props.onSelect?.(props.branch)}
      onDblClick={() => {
        if (props.onDoubleClick && (props.branch.remote || !props.branch.children?.length)) {
          props.onDoubleClick(getBranchRef(props.branch));
        }
      }}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSelect?.(props.branch);
        } else if (e.key === 'F2' && isLocal()) {
          e.preventDefault();
          postMessageToHost({
            type: 'command',
            command: 'renameBranch',
            params: { branchRef: branchRef() },
          });
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
        classList={{
          'branch-list-item__icon--current': props.branch.isCurrent,
          'branch-list-item__icon--main': props.branch.isMain && !props.branch.isCurrent,
        }}
        aria-hidden="true"
      >
        {props.branch.isCurrent ? (
          <VsTag size={BRANCH_ICON_SIZE} />
        ) : props.branch.isMain ? (
          <VsStarFull size={BRANCH_ICON_SIZE} />
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
              currentBranch={props.currentBranch ?? null}
              level={level() + 1}
              onSelect={props.onSelect}
              onDoubleClick={props.onDoubleClick}
            />
          ))}
        </div>
      </div>
    );
  }

  return row;
}
