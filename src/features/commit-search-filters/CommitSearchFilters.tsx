import { createSignal, onCleanup } from 'solid-js';
import {
  VsGoToSearch,
  VsRegex,
  VsArrowSwap,
  VsRefresh,
  VsGitMerge,
  VsEye,
  VsSearch,
} from 'solid-icons/vs';
import { t } from "@/shared/i18n";
import type { Branch } from "@/shared/lib/types";
import { getBranchId } from "@/shared/lib/branch";

const ICON_SIZE = 18;

const ACTION_ICONS = [
  { icon: VsArrowSwap, titleKey: 'toolbar.sortOptions' as const },
  { icon: VsRefresh, titleKey: 'toolbar.refresh' as const },
  { icon: VsGitMerge, titleKey: 'toolbar.cherryPick' as const },
  { icon: VsEye, titleKey: 'toolbar.visibility' as const },
  { icon: VsSearch, titleKey: 'toolbar.search' as const },
];

export interface CommitSearchFiltersProps {
  /** Все ветки для выпадающего списка (локальные + удалённые плоским списком) */
  branches?: Branch[];
  /** Имя текущей ветки для пункта "Текущая ветка" */
  currentBranchName?: string;
  /** Выбранный ref фильтра — только один ref или null (HEAD). Множественный выбор не поддерживается. */
  branchFilterRef?: string | null;
  /** Обработчик выбора ветки: передаётся ровно один ref или null. Выбор одной ветки снимает предыдущую. */
  onBranchFilterChange?: (ref: string | null) => void;
  /** Текст на кнопке фильтра по ветке */
  branchLabel?: string;
  /** Список авторов для фильтра User */
  authors?: string[];
  /** Выбранный автор (null = все) */
  userFilter?: string | null;
  /** Обработчик выбора автора в фильтре */
  onUserFilterChange?: (author: string | null) => void;
  /** Текст на кнопке фильтра User */
  userLabel?: string;
  /** Строка поиска по тексту коммита или hash */
  searchQuery?: string;
  /** Изменение строки поиска */
  onSearchChange?: (value: string) => void;
}

export function CommitSearchFilters(props: CommitSearchFiltersProps) {
  const [branchDropdownOpen, setBranchDropdownOpen] = createSignal(false);
  const [userDropdownOpen, setUserDropdownOpen] = createSignal(false);
  let branchButtonEl: HTMLButtonElement | undefined;
  let userButtonEl: HTMLButtonElement | undefined;

  const setBranchButtonRef = (el: HTMLButtonElement) => {
    branchButtonEl = el;
  };
  const setUserButtonRef = (el: HTMLButtonElement) => {
    userButtonEl = el;
  };

  const handleBranchButtonClick = () => {
    if (!props.onBranchFilterChange) return;
    setBranchDropdownOpen((v) => !v);
    setUserDropdownOpen(false);
  };

  /** Выбрать одну ветку (или HEAD). Всегда передаём одно значение — предыдущий выбор заменяется. */
  const selectBranchFilter = (ref: string | null) => {
    props.onBranchFilterChange?.(ref);
    setBranchDropdownOpen(false);
  };

  const handleUserButtonClick = () => {
    if (!props.onUserFilterChange) return;
    setUserDropdownOpen((v) => !v);
    setBranchDropdownOpen(false);
  };

  const selectUserFilter = (author: string | null) => {
    props.onUserFilterChange?.(author);
    setUserDropdownOpen(false);
  };

  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as Node;
    if (branchButtonEl?.contains(target)) return;
    if (userButtonEl?.contains(target)) return;
    const branchPanel = document.getElementById('commit-search-filters-branch-dropdown');
    if (branchPanel?.contains(target)) return;
    const userPanel = document.getElementById('commit-search-filters-user-dropdown');
    if (userPanel?.contains(target)) return;
    setBranchDropdownOpen(false);
    setUserDropdownOpen(false);
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('click', handleClickOutside);
    onCleanup(() => document.removeEventListener('click', handleClickOutside));
  }

  const showBranchDropdown = () =>
    props.onBranchFilterChange && props.branchLabel != null && branchDropdownOpen();

  const showUserDropdown = () =>
    props.onUserFilterChange && props.userLabel != null && userDropdownOpen();

  return (
    <div class="commit-search-filters">
      <div class="commit-search-filters__search">
        <button type="button" class="commit-search-filters__search-btn" title="Тип поиска">
          <VsGoToSearch size={14} />
        </button>
        <input
          type="text"
          class="commit-search-filters__input"
          placeholder="Текст коммита или hash"
          aria-label="Поиск по тексту коммита или хешу"
          value={props.searchQuery ?? ""}
          onInput={(e) => props.onSearchChange?.((e.target as HTMLInputElement).value)}
        />
        <button type="button" class="commit-search-filters__btn" title="Регулярные выражения">
          <VsRegex size={14} />
        </button>
        <button type="button" class="commit-search-filters__btn" title="Committer/Changes">
          Cc
        </button>
      </div>
      <div class="commit-search-filters__dropdowns">
        <div class="commit-search-filters__branch-dropdown-wrap">
          <button
            ref={setBranchButtonRef}
            type="button"
            class="commit-search-filters__dropdown"
            aria-haspopup="listbox"
            aria-expanded={branchDropdownOpen()}
            aria-label={t("branch.filterDropdown")}
            title={props.branchLabel ?? t("branch.label")}
            onClick={handleBranchButtonClick}
            disabled={!props.onBranchFilterChange}
          >
            {props.branchLabel ?? t("branch.ellipsis")} ▼
          </button>
          {props.branchFilterRef != null && props.onBranchFilterChange && (
            <button
              type="button"
              class="commit-search-filters__clear-btn"
              title={t("branch.clearFilter")}
              aria-label={t("branch.clearFilter")}
              onClick={() => selectBranchFilter(null)}
            >
              ×
            </button>
          )}
          {showBranchDropdown() && (
            <ul
              id="commit-search-filters-branch-dropdown"
              class="commit-search-filters__branch-list"
              role="radiogroup"
              aria-label={t("branch.ariaOne")}
            >
              <li class="commit-search-filters__branch-item commit-search-filters__branch-item--current">
                <button
                  type="button"
                  role="radio"
                  aria-checked={props.branchFilterRef == null}
                  class="commit-search-filters__branch-item-btn"
                  onClick={() => selectBranchFilter(null)}
                >
                  {t("branch.currentHead")}
                  {props.branchFilterRef == null ? ' ✓' : ''}
                </button>
              </li>
              {(() => {
                const seen = new Set<string>();
                return (props.branches ?? []).filter((branch) => {
                  const ref = branch.refName ?? (branch.remote ? `refs/remotes/${branch.remote}/${branch.name}` : `refs/heads/${branch.name}`);
                  if (seen.has(ref)) return false;
                  seen.add(ref);
                  return true;
                }).map((branch) => {
                  const ref = branch.refName ?? (branch.remote ? `refs/remotes/${branch.remote}/${branch.name}` : `refs/heads/${branch.name}`);
                  const id = getBranchId(branch);
                  const isSelected = props.branchFilterRef === ref;
                  return (
                    <li class="commit-search-filters__branch-item">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        class="commit-search-filters__branch-item-btn"
                        onClick={() => selectBranchFilter(ref)}
                      >
                        {id}
                        {isSelected ? ' ✓' : ''}
                      </button>
                    </li>
                  );
                });
              })()}
            </ul>
          )}
        </div>
        <div class="commit-search-filters__branch-dropdown-wrap">
          <button
            ref={setUserButtonRef}
            type="button"
            class="commit-search-filters__dropdown"
            aria-haspopup="listbox"
            aria-expanded={userDropdownOpen()}
            aria-label="Фильтр по автору"
            title={props.userLabel ?? 'User'}
            onClick={handleUserButtonClick}
            disabled={!props.onUserFilterChange}
          >
            {props.userLabel ?? 'User: …'} ▼
          </button>
          {props.userFilter != null && props.onUserFilterChange && (
            <button
              type="button"
              class="commit-search-filters__clear-btn"
              title="Сбросить фильтр по автору"
              aria-label="Сбросить фильтр по автору"
              onClick={() => selectUserFilter(null)}
            >
              ×
            </button>
          )}
          {showUserDropdown() && (
            <ul
              id="commit-search-filters-user-dropdown"
              class="commit-search-filters__branch-list"
              role="listbox"
              aria-label="Выберите автора"
              aria-multiselectable="false"
            >
              <li role="option" class="commit-search-filters__branch-item commit-search-filters__branch-item--current">
                <button
                  type="button"
                  class="commit-search-filters__branch-item-btn"
                  onClick={() => selectUserFilter(null)}
                >
                  Все авторы
                  {props.userFilter == null ? ' ✓' : ''}
                </button>
              </li>
              {(props.authors ?? []).map((author) => {
                const isSelected = props.userFilter === author;
                return (
                  <li role="option" class="commit-search-filters__branch-item" aria-selected={isSelected}>
                    <button
                      type="button"
                      class="commit-search-filters__branch-item-btn"
                      onClick={() => selectUserFilter(author)}
                    >
                      {author}
                      {isSelected ? ' ✓' : ''}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button type="button" class="commit-search-filters__dropdown">
          Date ▼
        </button>
        <button type="button" class="commit-search-filters__dropdown">
          Paths ▼
        </button>
      </div>
      <div class="commit-search-filters__actions">
        {ACTION_ICONS.map(({ icon: Icon, titleKey }) => (
          <button
            type="button"
            class="icon-btn commit-search-filters__action-btn"
            title={t(titleKey)}
            aria-label={t(titleKey)}
          >
            <Icon size={ICON_SIZE} />
          </button>
        ))}
      </div>
    </div>
  );
}
