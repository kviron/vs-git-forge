import { createSignal } from 'solid-js';
import type { Branch, Tag } from "@/shared/lib/types";
import { t } from "@/shared/i18n";
import { BranchesPaneToolbar } from "@/features/branches-pane-toolbar";
import { BranchList } from "@/features/branch-list";
import { TagList } from "@/features/tag-list";

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
  selectedTag?: Tag | null;
  onSelectBranch?: (branch: Branch) => void;
  /** Двойной клик по ветке — установить фильтр коммитов по этой ветке (ref: refs/heads/… или refs/remotes/…) */
  onBranchDoubleClick?: (branchRef: string) => void;
  onSelectTag?: (tag: Tag) => void;
  onCollapse?: () => void;
  loading?: boolean;
  error?: string | null;
  onInitRepo?: () => void;
  /** Вызов после успешного pull ветки — обновить список веток */
  onBranchesRefresh?: () => void;
}

/** Текущая ветка (HEAD) как объект — для контекстного меню «Merge into / Compare with» когда в списке ничего не выбрано. */
function getCurrentBranchObject(localBranches: Branch[]): Branch | null {
  return localBranches.find((b) => b.isCurrent) ?? null;
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
                {t("repo.createRepo")}
              </button>
            )}
          </div>
        )}
        {!props.loading && (
          <>
            <BranchList
              title={t("branches.local")}
              branches={filteredLocal()}
              currentBranch={getCurrentBranchObject(props.localBranches)}
              onSelectBranch={props.onSelectBranch}
              onBranchDoubleClick={props.onBranchDoubleClick}
              onBranchesRefresh={props.onBranchesRefresh}
            />
            {props.remoteBranches.length > 0 && (
              <BranchList
                title={t("branches.remote")}
                branches={filteredRemote()}
                currentBranch={getCurrentBranchObject(props.localBranches)}
                onSelectBranch={props.onSelectBranch}
                onBranchDoubleClick={props.onBranchDoubleClick}
                onBranchesRefresh={props.onBranchesRefresh}
              />
            )}
            <TagList
              tags={filteredTags()}
              selectedTag={props.selectedTag ?? null}
              currentBranchName={props.currentBranch !== '—' ? props.currentBranch : null}
              onSelectTag={props.onSelectTag}
            />
          </>
        )}
      </div>
    </div>
  );
}
