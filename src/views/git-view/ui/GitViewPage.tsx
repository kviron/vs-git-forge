import { createSignal, createMemo, createEffect, onMount, useContext } from "solid-js";
import { vscodeGitApi, VscodeGitApi, onGitStateChanged, postMessageToHost } from "@/shared/api";
import { log } from "@/shared/logger";
import { t } from "@/shared/i18n";
import { SelectedBranchContext } from "@/shared/context/SelectedBranchContext";
import type { Branch, Commit, ChangedFile, Tag } from "@/shared/lib/types";
import { UNCOMMITTED_HASH } from "@/shared/lib/types";
import { BranchesPane } from "@/widgets/branches-pane";
import { CommitHistory } from "@/widgets/commit-history";

const MIN_SIDEBAR = 180;
const MAX_LEFT = 500;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const EMPTY_BRANCHES: Branch[] = [];
const EMPTY_TAGS: Tag[] = [];


export function GitViewPage() {
  const refContext = useContext(SelectedBranchContext);
  const selectedBranch = refContext.selectedBranch;
  const setSelectedBranch = refContext.setSelectedBranch;
  const selectedTag = refContext.selectedTag;
  const setSelectedTag = refContext.setSelectedTag;

  const root = typeof document !== "undefined" ? document.getElementById("root") : null;
  const savedWidth = Number(root?.dataset?.sidebarWidth);
  const defaultWidth =
    typeof window !== "undefined" && window.innerWidth > 0
      ? Math.round(window.innerWidth * 0.2)
      : 240;
  let initialLeft = Number.isNaN(savedWidth) || savedWidth <= 0 ? defaultWidth : savedWidth;
  initialLeft = clamp(initialLeft, MIN_SIDEBAR, MAX_LEFT);
  const [leftWidth, setLeftWidth] = createSignal(initialLeft);
  const [commits, setCommits] = createSignal<Commit[]>([]);
  const [commitsLoading, setCommitsLoading] = createSignal(false);
  const [selectedCommit, setSelectedCommit] = createSignal<Commit | null>(null);
  /** Ref выбранной ветки в фильтре коммитов (null = HEAD) */
  const [branchFilterRef, setBranchFilterRef] = createSignal<string | null>(null);
  /** Автор для фильтра коммитов (null = все авторы) */
  const [userFilter, setUserFilter] = createSignal<string | null>(null);
  /** Поиск по тексту коммита или hash */
  const [searchQuery, setSearchQuery] = createSignal("");

  const [currentBranch, setCurrentBranch] = createSignal<string>("");
  const [localBranches, setLocalBranches] =
    createSignal<Branch[]>(EMPTY_BRANCHES);
  const [remoteBranches, setRemoteBranches] =
    createSignal<Branch[]>(EMPTY_BRANCHES);
  const [tags, setTags] = createSignal<Tag[]>(EMPTY_TAGS);
  const [branchesLoading, setBranchesLoading] = createSignal(true);
  const [branchesError, setBranchesError] = createSignal<string | null>(null);
  /** Изменённые файлы выбранного коммита (для обычных коммитов; для UNCOMMITTED не используется) */
  const [commitChangedFiles, setCommitChangedFiles] = createSignal<ChangedFile[]>([]);

  const selectedHash = () => selectedCommit()?.hash ?? null;

  /** При выборе коммита загружаем список изменённых файлов (для отображения справа) */
  createEffect(() => {
    const c = selectedCommit();
    if (!c || c.hash === UNCOMMITTED_HASH) {
      setCommitChangedFiles([]);
      return;
    }
    vscodeGitApi
      .getCommitChangedFiles(c.hash)
      .then(setCommitChangedFiles)
      .catch(() => setCommitChangedFiles([]));
  });

  /** Синхронизация с нативной вкладкой «Changed Files»: коммит, файлы и текст (message, author, date) */
  createEffect(() => {
    const c = selectedCommit();
    const hash = c?.hash ?? null;
    const files =
      c?.hash === UNCOMMITTED_HASH
        ? (c.uncommittedFiles ?? [])
        : commitChangedFiles();
    postMessageToHost({
      type: "selectedCommitChanged",
      commitHash: hash,
      files: files.map((f) => ({
        path: f.path,
        name: f.name,
        status: f.status,
      })),
      commitMessage: c?.message,
      commitAuthor: c?.author,
      commitAuthorEmail: c?.authorEmail,
      commitDate: c?.date,
      commitShortHash: c?.shortHash,
      commitBranches: c?.branches,
    });
  });

  /** Все ветки плоским списком для фильтра (локальные + удалённые) */
  const branchesForFilter = createMemo(() => {
    const local = localBranches();
    const remote = remoteBranches();
    const remoteFlat = remote.flatMap((r) => (r.children ?? [r]));
    return [...local, ...remoteFlat];
  });

  /** Уникальные авторы из текущего списка коммитов (для фильтра User) */
  const authorsFromCommits = createMemo(() => {
    const list = commits();
    const set = new Set<string>();
    for (const c of list) {
      const a = c.author?.trim();
      if (a) set.add(a);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  });

  /** Коммиты с учётом фильтра по автору и поиску по тексту/hash */
  const displayCommits = createMemo(() => {
    let list = commits();
    const user = userFilter();
    if (user) {
      list = list.filter((c) => (c.author?.trim() ?? "") === user);
    }
    const q = searchQuery().trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const msg = (c.message ?? "").toLowerCase();
      const hash = (c.hash ?? "").toLowerCase();
      const shortHash = (c.shortHash ?? "").toLowerCase();
      return msg.includes(q) || hash.includes(q) || shortHash.includes(q);
    });
  });

  /** @param showLoading — при обновлении по gitStateChanged не показываем лоадер */
  /** @param refOverride — при смене фильтра по ветке передаём ref явно, чтобы не зависеть от обновления сигнала */
  const loadCommits = (showLoading = true, refOverride?: string | null) => {
    if (!VscodeGitApi.isAvailable()) return;
    if (showLoading) setCommitsLoading(true);
    const ref = refOverride !== undefined ? (refOverride ?? undefined) : (branchFilterRef() ?? undefined);
    Promise.all([
      vscodeGitApi.getCommits({ maxEntries: 100, ref }),
      vscodeGitApi.getChangedFiles(),
    ])
      .then(([list, changedFiles]) => {
        const arr = Array.isArray(list) ? list : [];
        const uncommittedCount = Array.isArray(changedFiles) ? changedFiles.length : 0;
        const isViewingHead = ref == null;
        let commitsToShow: Commit[] = arr;
        if (uncommittedCount > 0 && isViewingHead) {
          const firstHash = arr[0]?.shortHash ?? arr[0]?.hash ?? "";
          const uncommitted: Commit = {
            hash: UNCOMMITTED_HASH,
            shortHash: "",
            message: `Uncommitted Changes (${uncommittedCount})`,
            author: "",
            date: "",
            dateRelative: "",
            branches: [],
            isMerge: false,
            parents: firstHash ? [firstHash] : [],
            uncommittedFiles: changedFiles,
          };
          commitsToShow = [uncommitted, ...arr];
        }
        setCommits(commitsToShow);
        setSelectedCommit(commitsToShow[0] ?? null);
      })
      .catch(() => {
        setCommits([]);
      })
      .finally(() => {
        if (showLoading) setCommitsLoading(false);
      });
  };

  /** @param showLoading — при обновлении по gitStateChanged не показываем лоадер, чтобы не было двух перерисовок */
  const loadBranches = (showLoading = true) => {
    if (showLoading) {
      log.debug("GitViewPage: loadBranches начало, setBranchesLoading(true)");
      setBranchesLoading(true);
    }
    setBranchesError(null);
    vscodeGitApi
      .getBranches()
      .then((p) => {
        setCurrentBranch(p?.currentBranch ?? "");
        setLocalBranches(Array.isArray(p?.local) ? p.local : EMPTY_BRANCHES);
        setRemoteBranches(Array.isArray(p?.remote) ? p.remote : EMPTY_BRANCHES);
        setTags(Array.isArray(p?.tags) ? p.tags : EMPTY_TAGS);
      })
      .catch(() => {
        setBranchesError(t("repo.notInitialized"));
        setCurrentBranch("");
        setLocalBranches(EMPTY_BRANCHES);
        setRemoteBranches(EMPTY_BRANCHES);
        setTags(EMPTY_TAGS);
      })
      .finally(() => {
        if (showLoading) {
          log.debug("GitViewPage: loadBranches конец, setBranchesLoading(false)");
          setBranchesLoading(false);
        }
      });
  };

  onMount(() => {
    if (!VscodeGitApi.isAvailable()) {
      setBranchesError(t("repo.notInitialized"));
      setBranchesLoading(false);
      return;
    }
    loadBranches();
    loadCommits();
    const unsubscribe = onGitStateChanged(() => {
      loadBranches(false); // без лоадера — одна перерисовка когда данные пришли
      loadCommits(false);
    });
    return unsubscribe;
  });

  /** Фильтр по ветке: только одна ветка (ref или null = HEAD). Выбор новой ветки заменяет предыдущую. */
  const handleBranchFilterChange = (ref: string | null) => {
    setBranchFilterRef(ref);
    loadCommits(false, ref);
  };

  const handleUserFilterChange = (author: string | null) => {
    setUserFilter(author);
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  onMount(() => {
    const leftEl = document.getElementById("left-pane");
    const resizerLeft = document.getElementById("resizer-left");

    let dragging = false;
    let startX = 0;
    let startLeft = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging || !leftEl) return;
      const dx = e.clientX - startX;
      const w = clamp(startLeft + dx, MIN_SIDEBAR, MAX_LEFT);
      leftEl.style.width = `${w}px`;
      setLeftWidth(w);
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (leftEl) {
        postMessageToHost({ type: "sidebarWidth", width: leftEl.offsetWidth });
      }
    };

    resizerLeft?.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startLeft = leftEl?.offsetWidth ?? leftWidth();
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  });

  const handleInitRepo = () => {
    vscodeGitApi
      .initRepo()
      .then(() => {
        setBranchesError(null);
        loadBranches();
        loadCommits();
      });
  };

  const showEmptyState = () => branchesError() != null;

  return (
    <div
      class="git-view-page"
      classList={{ "git-view-page--empty": showEmptyState() }}
    >
      {showEmptyState() ? (
        <div class="git-view-page__empty-state">
          <p class="git-view-page__empty-text">{branchesError()}</p>
          {VscodeGitApi.isAvailable() && (
            <button
              type="button"
              class="git-view-page__empty-btn"
              onClick={handleInitRepo}
            >
              {t("repo.createRepo")}
            </button>
          )}
        </div>
      ) : (
        <>
          <aside
            id="left-pane"
            class="git-view-page__left"
            style={{ width: `${leftWidth()}px` }}
          >
            <BranchesPane
              currentBranch={currentBranch() || "—"}
              localBranches={localBranches()}
              remoteBranches={remoteBranches()}
              tags={tags()}
              selectedTag={selectedTag()}
              onSelectBranch={setSelectedBranch}
              onBranchDoubleClick={handleBranchFilterChange}
              onSelectTag={setSelectedTag}
              loading={branchesLoading()}
              error={null}
              onInitRepo={undefined}
              onBranchesRefresh={loadBranches}
            />
          </aside>
          <div
            id="resizer-left"
            class="git-view-page__resizer git-view-page__resizer--left"
            title={t("panel.resizeTitle")}
          />
          <main class="git-view-page__center">
            <CommitHistory
              commits={displayCommits() ?? []}
              selectedCommitHash={selectedHash()}
              onSelectCommit={setSelectedCommit}
              loading={commitsLoading()}
              branches={branchesForFilter()}
              currentBranchName={currentBranch() || undefined}
              branchFilterRef={branchFilterRef()}
              onBranchFilterChange={handleBranchFilterChange}
              authors={authorsFromCommits()}
              userFilter={userFilter()}
              onUserFilterChange={handleUserFilterChange}
              userLabel={userFilter() ? t("user.label", userFilter()!) : t("user.allAuthors")}
              searchQuery={searchQuery()}
              onSearchChange={handleSearchChange}
            />
          </main>
        </>
      )}
    </div>
  );
}
