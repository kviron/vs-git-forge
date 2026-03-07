import { createSignal } from 'solid-js';
import type { Branch, Tag } from '../../shared/lib/types';
import { withSelectedBranches } from '../../shared/lib/branch';
import { BranchesPaneToolbar } from '../../features/branches-pane-toolbar';
import { BranchList } from '../../features/branch-list';
import { TagList } from '../../features/tag-list';

function filterBranches(branches: Branch[], query: string): Branch[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return branches;
  }
  return branches
    .map((b) => {
      if (b.children?.length) {
        const filteredChildren = filterBranches(b.children, q);
        const parentMatches = b.name.toLowerCase().includes(q);
        if (parentMatches) {
          return { ...b, children: b.children };
        }
        if (filteredChildren.length === 0) {
          return null;
        }
        return { ...b, children: filteredChildren };
      }
      return b.name.toLowerCase().includes(q) ? b : null;
    })
    .filter((b): b is Branch => b !== null);
}

function filterTags(tags: Tag[], query: string): Tag[] {
  const q = query.trim().toLowerCase();
  if (!q) return tags;
  return tags.filter((t) => t.name.toLowerCase().includes(q));
}

interface BranchesPaneProps {
  currentBranch: string;
  localBranches: Branch[];
  remoteBranches: Branch[];
  tags: Tag[];
  selectedBranch?: Branch | null;
  selectedTag?: Tag | null;
  onSelectBranch?: (branch: Branch) => void;
  onSelectTag?: (tag: Tag) => void;
  onCollapse?: () => void;
  loading?: boolean;
  error?: string | null;
  onInitRepo?: () => void;
  /** Вызов после успешного pull ветки — обновить список веток */
  onBranchesRefresh?: () => void;
}

export function BranchesPane(props: BranchesPaneProps) {
  const [searchQuery, setSearchQuery] = createSignal('');
  const filteredLocal = () => filterBranches(props.localBranches, searchQuery());
  const filteredRemote = () => filterBranches(props.remoteBranches, searchQuery());
  const filteredTags = () => filterTags(props.tags, searchQuery());

  return (
    <div class="branches-pane">
      <BranchesPaneToolbar onBranchesRefresh={props.onBranchesRefresh} />
      <div class="branches-pane__content">
        <div class="branches-pane__search">
          <input
            type="search"
            class="branches-pane__search-input"
            placeholder="Фильтр веток и тегов…"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            aria-label="Фильтр веток"
          />
        </div>
        {props.error && (
          <div class="branches-pane__error" role="alert">
            <p class="branches-pane__error-text">{props.error}</p>
            {props.onInitRepo && (
              <button
                type="button"
                class="branches-pane__error-btn"
                onClick={props.onInitRepo}
              >
                Создать репозиторий
              </button>
            )}
          </div>
        )}
        {!props.loading && (
          <>
            <BranchList
              title="Local"
              branches={withSelectedBranches(filteredLocal(), props.selectedBranch ?? null)}
              onSelectBranch={props.onSelectBranch}
            />
            <BranchList
              title="Remote"
              branches={withSelectedBranches(filteredRemote(), props.selectedBranch ?? null)}
              onSelectBranch={props.onSelectBranch}
            />
            <TagList
              tags={filteredTags()}
              selectedTag={props.selectedTag ?? null}
              onSelectTag={props.onSelectTag}
            />
          </>
        )}
      </div>
    </div>
  );
}
