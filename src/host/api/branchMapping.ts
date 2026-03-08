import type { GitBranch, GitRef, GitRepository } from "../core/repoManager";
import {
  getBranchBehindCount,
  getBranchUpstreamRef,
  getConfiguredRemotes,
  getShortBranchName,
} from "../git/remote";
import { log } from "../core/logger";
import type {
  WebviewBranch,
  WebviewRemoteBranchGroup,
  WebviewTag,
} from "../../types/webview";

/** Короткое имя ветки из полного ref (refs/heads/feature → feature). */
export function toShortBranchName(fullRef: string | undefined): string {
  if (!fullRef) return "";
  return (
    getShortBranchName(fullRef) ||
    fullRef.replace(/^refs\/heads\//, "").trim()
  );
}

/** Получить теги через ApiRepository.getRefs(). */
export async function getTagRefs(repo: GitRepository): Promise<GitRef[]> {
  if (typeof repo.getRefs !== "function") return [];
  try {
    const refs = await repo.getRefs({ pattern: "refs/tags/*" });
    return refs ?? [];
  } catch (err) {
    log.debug("getTagRefs failed", repo.rootUri.fsPath, err);
    return [];
  }
}

export function mapTagRefsToWebview(refs: GitRef[]): WebviewTag[] {
  const list = refs
    .filter((r) => (r.name ?? "").length > 0)
    .map((r) => {
      const name = r.name ?? "";
      const shortName = name.startsWith("refs/tags/")
        ? name.replace(/^refs\/tags\//, "")
        : name;
      return { name: shortName, commit: r.commit };
    });
  list.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return list;
}

/** Маппинг локальных веток в WebviewBranch[]. */
export function mapLocalBranchesToWebview(
  repo: GitRepository,
  branches: GitBranch[],
): WebviewBranch[] {
  const headName = repo.state.HEAD?.name ?? null;
  const currentShort = headName ? toShortBranchName(headName) : null;
  const cwd = repo.rootUri.fsPath;
  const local: WebviewBranch[] = branches.map((b) => {
    const shortName = toShortBranchName(b.name);
    const displayName = shortName || (b.name ?? "");
    const isCurrent =
      currentShort != null &&
      (shortName === currentShort || (b.name ?? "") === headName);
    const isMain = displayName === "master" || displayName === "main";
    let behind: number | undefined =
      b.behind != null && b.behind > 0 ? b.behind : undefined;
    let hasUpstream = false;
    const upstreamRef =
      b.upstream?.remote != null && b.upstream?.name != null
        ? `${b.upstream.remote}/${b.upstream.name}`
        : getBranchUpstreamRef(cwd, displayName);
    if (upstreamRef) {
      hasUpstream = true;
      if (behind === undefined) {
        const count = getBranchBehindCount(cwd, displayName, upstreamRef);
        if (count != null && count > 0) behind = count;
      }
    }
    return {
      name: displayName,
      refName: b.name,
      type: b.type,
      commit: b.commit,
      isCurrent,
      isMain,
      ...(behind != null ? { behind } : {}),
      ...(b.ahead != null && b.ahead > 0 ? { ahead: b.ahead } : {}),
      ...(hasUpstream ? { hasUpstream: true } : {}),
      ...(b.upstream
        ? {
            upstream: {
              remote: b.upstream.remote,
              name: b.upstream.name,
              ...(b.upstream.commit != null ? { commit: b.upstream.commit } : {}),
            },
          }
        : {}),
    };
  });
  local.sort((a, b) => {
    if (a.isCurrent) return -1;
    if (b.isCurrent) return 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });
  return local;
}

/** Маппинг remote-веток в дерево по remote (группы с children). */
export function mapRemoteBranchesToWebview(
  repo: GitRepository,
  branches: GitBranch[],
): WebviewRemoteBranchGroup[] {
  const byRemote = new Map<string, WebviewBranch[]>();
  const seenPerRemote = new Map<string, Set<string>>();
  for (const b of branches) {
    const remote = b.remote ?? "origin";
    const shortName = (b.name ?? "").startsWith(remote + "/")
      ? (b.name ?? "").slice(remote.length + 1)
      : (b.name ?? "");
    if (shortName === "HEAD") continue;
    if (!seenPerRemote.has(remote)) seenPerRemote.set(remote, new Set());
    if (seenPerRemote.get(remote)!.has(shortName)) continue;
    seenPerRemote.get(remote)!.add(shortName);
    if (!byRemote.has(remote)) byRemote.set(remote, []);
    byRemote.get(remote)!.push({
      name: shortName,
      remote,
      type: b.type,
      refName: b.name,
      commit: b.commit,
    });
  }
  const configuredRemotes = getConfiguredRemotes(repo.rootUri.fsPath);
  return Array.from(byRemote.entries())
    .filter(([remote]) => configuredRemotes.includes(remote))
    .map(([remote, children]) => ({ name: remote, children }));
}
