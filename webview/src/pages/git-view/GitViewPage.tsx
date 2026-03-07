import { createSignal, onMount, useContext } from "solid-js";
import { vscodeGitApi, VscodeGitApi, postMessageToHost } from "../../shared/api";
import { SelectedBranchContext } from "../../shared/context/SelectedBranchContext";
import type { Branch, Commit, Tag } from "../../shared/lib/types";
import { UNCOMMITTED_HASH } from "../../shared/lib/types";
import { BranchesPane } from "../../widgets/branches-pane";
import { CommitDetailsPanel } from "../../widgets/commit-details-panel";
import { CommitHistory } from "../../widgets/commit-history";

const MIN_SIDEBAR = 180;
const MAX_LEFT = 500;
const MAX_RIGHT = 500;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const EMPTY_BRANCHES: Branch[] = [];
const EMPTY_TAGS: Tag[] = [];

const NO_REPO_MESSAGE = "Не инициализирован Git-репозиторий";

export function GitViewPage() {
  const refContext = useContext(SelectedBranchContext);
  const selectedBranch = refContext.selectedBranch;
  const setSelectedBranch = refContext.setSelectedBranch;
  const selectedTag = refContext.selectedTag;
  const setSelectedTag = refContext.setSelectedTag;

  const root = typeof document !== "undefined" ? document.getElementById("root") : null;
  let initialLeft = Number(root?.dataset?.sidebarWidth) || 280;
  if (Number.isNaN(initialLeft) || initialLeft <= 0) initialLeft = 280;
  const [leftWidth, setLeftWidth] = createSignal(
    clamp(initialLeft, MIN_SIDEBAR, MAX_LEFT),
  );
  const [rightWidth, setRightWidth] = createSignal(
    clamp(320, MIN_SIDEBAR, MAX_RIGHT),
  );
  const [commits, setCommits] = createSignal<Commit[]>([]);
  const [commitsLoading, setCommitsLoading] = createSignal(false);
  const [selectedCommit, setSelectedCommit] = createSignal<Commit | null>(null);

  const [currentBranch, setCurrentBranch] = createSignal<string>("");
  const [localBranches, setLocalBranches] =
    createSignal<Branch[]>(EMPTY_BRANCHES);
  const [remoteBranches, setRemoteBranches] =
    createSignal<Branch[]>(EMPTY_BRANCHES);
  const [tags, setTags] = createSignal<Tag[]>(EMPTY_TAGS);
  const [branchesLoading, setBranchesLoading] = createSignal(true);
  const [branchesError, setBranchesError] = createSignal<string | null>(null);

  const selectedHash = () => selectedCommit()?.hash ?? null;

  const loadCommits = () => {
    if (!VscodeGitApi.isAvailable()) return;
    setCommitsLoading(true);
    Promise.all([
      vscodeGitApi.getCommits({ maxEntries: 100 }),
      vscodeGitApi.getChangedFiles(),
    ])
      .then(([list, changedFiles]) => {
        const arr = Array.isArray(list) ? list : [];
        const uncommittedCount = Array.isArray(changedFiles) ? changedFiles.length : 0;
        let commitsToShow: Commit[] = arr;
        if (uncommittedCount > 0) {
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
      .finally(() => setCommitsLoading(false));
  };

  const loadBranches = () => {
    setBranchesLoading(true);
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
        setBranchesError(NO_REPO_MESSAGE);
        setCurrentBranch("");
        setLocalBranches(EMPTY_BRANCHES);
        setRemoteBranches(EMPTY_BRANCHES);
        setTags(EMPTY_TAGS);
      })
      .finally(() => setBranchesLoading(false));
  };

  onMount(() => {
    if (!VscodeGitApi.isAvailable()) {
      setBranchesError(NO_REPO_MESSAGE);
      setBranchesLoading(false);
      return;
    }
    loadBranches();
    loadCommits();
  });

  onMount(() => {
    const leftEl = document.getElementById("left-pane");
    const rightEl = document.getElementById("right-pane");
    const resizerLeft = document.getElementById("resizer-left");
    const resizerRight = document.getElementById("resizer-right");

    let dragging: "left" | "right" | null = null;
    let startX = 0;
    let startLeft = 0;
    let startRight = 0;

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging || !leftEl || !rightEl) return;
      const dx = e.clientX - startX;
      if (dragging === "left") {
        const w = clamp(startLeft + dx, MIN_SIDEBAR, MAX_LEFT);
        leftEl.style.width = `${w}px`;
        setLeftWidth(w);
      } else {
        const w = clamp(startRight - dx, MIN_SIDEBAR, MAX_RIGHT);
        rightEl.style.width = `${w}px`;
        setRightWidth(w);
      }
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (leftEl) {
        postMessageToHost({ type: "sidebarWidth", width: leftEl.offsetWidth });
      }
    };

    resizerLeft?.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault();
      dragging = "left";
      startX = e.clientX;
      startLeft = leftEl?.offsetWidth ?? leftWidth();
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });

    resizerRight?.addEventListener("mousedown", (e: MouseEvent) => {
      e.preventDefault();
      dragging = "right";
      startX = e.clientX;
      startRight = rightEl?.offsetWidth ?? rightWidth();
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
              Создать репозиторий
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
              selectedBranch={selectedBranch()}
              selectedTag={selectedTag()}
              onSelectBranch={setSelectedBranch}
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
            title="Изменить ширину левой панели"
          />
          <main class="git-view-page__center">
            <CommitHistory
              commits={commits() ?? []}
              selectedCommitHash={selectedHash()}
              onSelectCommit={setSelectedCommit}
              loading={commitsLoading()}
            />
          </main>
          <div
            id="resizer-right"
            class="git-view-page__resizer git-view-page__resizer--right"
            title="Изменить ширину правой панели"
          />
          <aside
            id="right-pane"
            class="git-view-page__right"
            style={{ width: `${rightWidth()}px` }}
          >
            <CommitDetailsPanel
              commit={selectedCommit()}
              changedFiles={
                selectedCommit()?.hash === UNCOMMITTED_HASH
                  ? (selectedCommit()?.uncommittedFiles ?? [])
                  : []
              }
              repoName="clubm8-web"
            />
          </aside>
        </>
      )}
    </div>
  );
}
