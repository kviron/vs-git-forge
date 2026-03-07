import { createSignal } from 'solid-js';
import { VsChevronDown, VsChevronRight } from 'solid-icons/vs';
import type { Branch } from '../../shared/lib/types';
import { BranchListItem } from '../../entities/branch';

interface BranchListProps {
  title: string;
  branches: Branch[];
  onSelectBranch?: (branch: Branch) => void;
  defaultExpanded?: boolean;
}

export function BranchList(props: BranchListProps) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? true);

  return (
    <div class="branch-list">
      <button
        type="button"
        class="branch-list__header"
        aria-expanded={expanded()}
        onClick={() => setExpanded((e) => !e)}
      >
        <span class="branch-list__header-icon" aria-hidden="true">
          {expanded() ? <VsChevronDown size={14} /> : <VsChevronRight size={14} />}
        </span>
        <span class="branch-list__title">{props.title}</span>
      </button>
      {expanded() && (
        <div class="branch-list__items" role="tree">
          {props.branches.map((branch) => (
            <BranchListItem
              branch={branch}
              onSelect={props.onSelectBranch}
            />
          ))}
        </div>
      )}
    </div>
  );
}
