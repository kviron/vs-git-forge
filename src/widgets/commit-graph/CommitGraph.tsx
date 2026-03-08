import { createEffect, onCleanup, onMount } from "solid-js";
import type { Commit } from "@/shared/lib/types";
import { UNCOMMITTED_HASH } from "@/shared/lib/types";
import { buildGraph, renderGraphToSvg } from "./graphLayout";

const ROW_HEIGHT = 28;

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

interface CommitGraphProps {
  commits: Commit[];
  selectedCommitHash: string | null;
  class?: string;
}

export function CommitGraph(props: CommitGraphProps) {
  let graphWrapEl: HTMLDivElement | undefined;
  let containerEl: HTMLDivElement | undefined;
  let tooltipEl: HTMLDivElement | undefined;
  let tooltipTimeout: ReturnType<typeof setTimeout> | null = null;

  function showTooltip(commitIndex: number, circleEl: SVGElement) {
    const commits = props.commits ?? [];
    const commit = commits[commitIndex];
    if (!commit || !tooltipEl || !graphWrapEl) return;

    const rect = circleEl.getBoundingClientRect();
    const wrapRect = graphWrapEl.getBoundingClientRect();

    const isUncommitted = commit.hash === UNCOMMITTED_HASH;
    const isHead = !isUncommitted && commitIndex === 0;
    const branches = commit.branches ?? [];

    const branchPills = branches
      .map((b) => `<span class="commit-graph-tooltip__pill">${escapeHtml(b)}</span>`)
      .join("");

    const pointColour = circleEl.getAttribute("data-commit-colour") ?? "#4ec9b0";

    if (isUncommitted) {
      const count = commit.uncommittedFiles?.length ?? 0;
      tooltipEl.innerHTML = `
        <div class="commit-graph-tooltip__title">Uncommitted Changes</div>
        <div class="commit-graph-tooltip__row">${count} ${count === 1 ? "file" : "files"}</div>
      `;
    } else {
      tooltipEl.innerHTML = `
        <div class="commit-graph-tooltip__title">Commit ${escapeHtml(commit.shortHash)}</div>
        ${isHead ? '<div class="commit-graph-tooltip__row">This commit is included in <span class="commit-graph-tooltip__pill">HEAD</span></div>' : ""}
        ${branchPills ? `<div class="commit-graph-tooltip__row"><span class="commit-graph-tooltip__label">Branches:</span> ${branchPills}</div>` : ""}
      `;
    }
    tooltipEl.style.display = "block";
    tooltipEl.style.borderColor = pointColour;
    tooltipEl.style.left = `${rect.left - wrapRect.left + rect.width / 2 + 8}px`;
    tooltipEl.style.top = `${rect.top - wrapRect.top + rect.height / 2}px`;
  }

  function hideTooltip() {
    if (tooltipTimeout) {
      clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    }
    if (tooltipEl) {
      tooltipEl.style.display = "none";
      tooltipEl.style.borderColor = "";
    }
  }

  onMount(() => {
    if (!containerEl) return;
    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const circle = target.closest?.("[data-commit-index]");
      if (!circle) {
        hideTooltip();
        return;
      }
      const idx = circle.getAttribute("data-commit-index");
      if (idx === null) return;
      const index = parseInt(idx, 10);
      if (Number.isNaN(index)) return;
      tooltipTimeout = setTimeout(() => showTooltip(index, circle as SVGElement), 150);
    };
    const onMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as Node | null;
      if (related && (containerEl?.contains(related) || tooltipEl?.contains(related))) return;
      hideTooltip();
    };
    containerEl.addEventListener("mouseover", onMouseOver);
    containerEl.addEventListener("mouseout", onMouseOut);
    tooltipEl?.addEventListener("mouseenter", () => {
      if (tooltipTimeout) clearTimeout(tooltipTimeout);
      tooltipTimeout = null;
    });
    tooltipEl?.addEventListener("mouseleave", hideTooltip);
    onCleanup(() => {
      containerEl?.removeEventListener("mouseover", onMouseOver);
      containerEl?.removeEventListener("mouseout", onMouseOut);
      if (tooltipTimeout) clearTimeout(tooltipTimeout);
    });
  });

  createEffect(() => {
    const commits = props.commits ?? [];
    if (!containerEl) return;
    if (commits.length === 0) {
      containerEl.innerHTML = "";
      return;
    }

    const commitLookup: Record<string, number> = {};
    for (let i = 0; i < commits.length; i++) {
      commitLookup[commits[i].hash] = i;
      commitLookup[commits[i].shortHash] = i;
    }

    const { vertices, branches, config } = buildGraph(
      commits.map((c) => ({
        hash: c.hash,
        shortHash: c.shortHash,
        parents: c.parents,
      })),
      commitLookup,
      props.selectedCommitHash,
      false
    );

    const uncommittedIndex =
      commits[0]?.hash === UNCOMMITTED_HASH ? 0 : undefined;
    const svg = renderGraphToSvg(vertices, branches, config, {
      uncommittedVertexIndex: uncommittedIndex,
    });
    containerEl.innerHTML = "";
    containerEl.appendChild(svg);
  });

  return (
    <div
      class={`commit-graph ${props.class ?? ""}`.trim()}
      ref={(el) => {
        graphWrapEl = el;
      }}
    >
      <div
        class="commit-graph__container"
        ref={(el) => {
          containerEl = el;
        }}
      />
      <div
        class="commit-graph-tooltip"
        ref={(el) => {
          tooltipEl = el;
        }}
        aria-hidden="true"
      />
    </div>
  );
}

export { ROW_HEIGHT };
