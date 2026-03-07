import {
  VsGoToSearch,
  VsRegex,
  VsArrowSwap,
  VsRefresh,
  VsGitMerge,
  VsEye,
  VsSearch,
} from 'solid-icons/vs';
const ICON_SIZE = 18;

const ACTION_ICONS = [
  { icon: VsArrowSwap, title: 'Сортировка и опции' },
  { icon: VsRefresh, title: 'Refresh' },
  { icon: VsGitMerge, title: 'Cherry-pick' },
  { icon: VsEye, title: 'Видимость' },
  { icon: VsSearch, title: 'Поиск' },
];

export function CommitSearchFilters() {
  return (
    <div class="commit-search-filters">
      <div class="commit-search-filters__search">
        <button type="button" class="commit-search-filters__search-btn" title="Тип поиска">
          <VsGoToSearch size={14} />
        </button>
        <input
          type="text"
          class="commit-search-filters__input"
          placeholder="Text or hash"
          aria-label="Поиск по тексту или хешу"
        />
        <button type="button" class="commit-search-filters__btn" title="Регулярные выражения">
          <VsRegex size={14} />
        </button>
        <button type="button" class="commit-search-filters__btn" title="Committer/Changes">
          Cc
        </button>
      </div>
      <div class="commit-search-filters__dropdowns">
        <button type="button" class="commit-search-filters__dropdown">
          Branch: master ▼
        </button>
        <button type="button" class="commit-search-filters__dropdown">
          User ▼
        </button>
        <button type="button" class="commit-search-filters__dropdown">
          Date ▼
        </button>
        <button type="button" class="commit-search-filters__dropdown">
          Paths ▼
        </button>
      </div>
      <div class="commit-search-filters__actions">
        {ACTION_ICONS.map(({ icon: Icon, title }) => (
          <button
            type="button"
            class="icon-btn commit-search-filters__action-btn"
            title={title}
            aria-label={title}
          >
            <Icon size={ICON_SIZE} />
          </button>
        ))}
      </div>
    </div>
  );
}
