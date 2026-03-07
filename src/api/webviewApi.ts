import * as vscode from "vscode";
import type { GitRef, GitRepository } from "../core/repoManager";
import { getGitApi } from "../core/repoManager";
import { log } from "../core/logger";
import { getParentCommit, parseDiffNameStatus } from "../git/shell";
import { getRemoteOriginUrl, parseRemoteUrl } from "../git/remote";
import { fetchGitHubCommitAvatars, fetchGitLabAvatarsByEmail } from "../git/avatars";
import { gitStatusToKind } from "../types/git";
import type { WebviewChangedFile, WebviewCommit } from "../types/webview";
import {
  getTagRefs,
  mapTagRefsToWebview,
  mapLocalBranchesToWebview,
  mapRemoteBranchesToWebview,
} from "./branchMapping";
import { formatDate, formatDateRelative } from "./dateFormat";
import {
  handleInitRepo,
  handleShowCreateBranchDialog,
  handleShowCreateTagDialog,
  handlePullBranch,
} from "./handlers";

export type ApiResult = { data?: unknown; error?: string };

/** Читает имя ветки из .git/HEAD (без встроенного Git-расширения). */
export async function getBranchFromGitHead(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;
  for (const folder of folders) {
    const headPath = vscode.Uri.joinPath(folder.uri, ".git", "HEAD");
    try {
      const data = await vscode.workspace.fs.readFile(headPath);
      const content = new TextDecoder().decode(data).trim();
      const match = /^ref: refs\/heads\/(.+)$/.exec(content);
      if (match) return match[1];
    } catch (err) {
      log.debug("getBranchFromGitHead failed", err);
    }
  }
  return undefined;
}

/**
 * Единая точка входа для запросов API из webview.
 * method + params + repo -> { data?, error? }.
 */
export async function handleApiRequest(
  method: string,
  params: Record<string, unknown> | undefined,
  repo: GitRepository | null,
): Promise<ApiResult> {
  if (method === "initRepo") return handleInitRepo(params);
  if (method === "showCreateBranchDialog") {
    return handleShowCreateBranchDialog(params, repo);
  }
  if (method === "showCreateTagDialog") {
    return handleShowCreateTagDialog(params, repo);
  }
  if (method === "pullBranch") return handlePullBranch(params, repo);

  if (!repo) {
    const branch = await getBranchFromGitHead();
    if (method === "getCurrentBranch") return { data: branch ?? null };
    if (method === "getRepositoryRoot") {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? null;
      return { data: { root } };
    }
    if (method === "getTags") return { data: [] };
    return { error: vscode.l10n.t("api.repoNotFound") };
  }

  try {
    switch (method) {
      case "getCurrentBranch": {
        const name = repo.state.HEAD?.name ?? null;
        const short = (name ?? "").replace(/^refs\/heads\//, "").trim() || null;
        return { data: short };
      }
      case "getLocalBranches": {
        const branches = await repo.getBranches({ remote: false });
        const local = mapLocalBranchesToWebview(repo, branches);
        return { data: local };
      }
      case "getRemoteBranches": {
        const branches = await repo.getBranches({ remote: true });
        const remoteList = mapRemoteBranchesToWebview(repo, branches);
        return { data: remoteList };
      }
      case "getTags": {
        const tagRefs = await getTagRefs(repo);
        return { data: mapTagRefsToWebview(tagRefs) };
      }
      case "getBranches": {
        const [localBranches, remoteBranches] = await Promise.all([
          repo.getBranches({ remote: false }),
          repo.getBranches({ remote: true }),
        ]);
        const remoteList = mapRemoteBranchesToWebview(repo, remoteBranches);
        const tagRefs = await getTagRefs(repo);
        const tags = mapTagRefsToWebview(tagRefs);
        const headName = repo.state.HEAD?.name ?? null;
        const currentShort =
          (headName ?? "").replace(/^refs\/heads\//, "").trim() || null;
        const local = mapLocalBranchesToWebview(repo, localBranches);
        return {
          data: {
            currentBranch: currentShort ?? headName,
            local,
            remote: remoteList,
            tags,
          },
        };
      }
      case "getCommits": {
        const maxEntries = (params?.maxEntries as number) ?? 100;
        const ref = (params?.ref as string) ?? "HEAD";
        const commits = await repo.log({
          maxEntries,
          refNames: [ref],
          shortStats: true,
        });
        let allRefs: GitRef[] = [];
        if (typeof repo.getRefs === "function") {
          try {
            allRefs = (await repo.getRefs({})) ?? [];
          } catch (err) {
            log.debug("getRefs failed", err);
          }
        }
        const refsByCommit = new Map<string, string[]>();
        for (const r of allRefs) {
          if (r.commit && r.name) {
            const short = r.name
              .replace(/^refs\/heads\//, "")
              .replace(/^refs\/remotes\//, "")
              .trim();
            if (!short) continue;
            let list = refsByCommit.get(r.commit);
            if (!list) {
              list = [];
              refsByCommit.set(r.commit, list);
            }
            if (!list.includes(short)) list.push(short);
          }
        }
        const cwd = repo.rootUri.fsPath;
        const originUrl = getRemoteOriginUrl(cwd);
        const parsed = originUrl ? parseRemoteUrl(originUrl) : null;
        let avatarByHash = new Map<string, string>();
        let avatarByEmail = new Map<string, string>();
        if (parsed?.host === "github") {
          avatarByHash = await fetchGitHubCommitAvatars(
            parsed.owner,
            parsed.repo,
            ref,
          );
        } else if (parsed?.host === "gitlab") {
          const emails = [
            ...new Set(
              commits
                .map((c) => c.authorEmail?.trim().toLowerCase())
                .filter((e): e is string => Boolean(e)),
            ),
          ];
          avatarByEmail = await fetchGitLabAvatarsByEmail(parsed.baseUrl, emails);
        }
        const webviewCommits: WebviewCommit[] = commits.map((c) => {
          const fromHost =
            avatarByHash.get(c.hash) ??
            avatarByHash.get(c.hash.slice(0, 8)) ??
            (c.authorEmail
              ? avatarByEmail.get(c.authorEmail.trim().toLowerCase())
              : undefined);
          return {
            hash: c.hash,
            shortHash: c.hash.slice(0, 8),
            message: c.message,
            author: c.authorName ?? "",
            authorEmail: c.authorEmail,
            authorAvatarUrl: fromHost,
            date: formatDate(c.authorDate),
            dateRelative: formatDateRelative(c.authorDate),
            ...(c.commitDate != null
              ? {
                  commitDate: formatDate(c.commitDate),
                  commitDateRelative: formatDateRelative(c.commitDate),
                }
              : {}),
            branches: refsByCommit.get(c.hash) ?? undefined,
            isMerge: (c.parents?.length ?? 0) > 1,
            parents: c.parents?.map((p) => p.slice(0, 8)),
            ...(c.shortStat != null
              ? {
                  shortStat: {
                    files: c.shortStat.files,
                    insertions: c.shortStat.insertions,
                    deletions: c.shortStat.deletions,
                  },
                }
              : {}),
          };
        });
        return { data: webviewCommits };
      }
      case "getChangedFiles": {
        const all = [
          ...repo.state.indexChanges,
          ...repo.state.workingTreeChanges,
        ];
        const root = repo.rootUri.fsPath;
        const toRel = (uri: { fsPath: string }) =>
          root
            ? uri.fsPath.replace(root, "").replace(/^[/\\]/, "")
            : uri.fsPath;
        const files: WebviewChangedFile[] = all.map((ch) => {
          const relPath = toRel(ch.uri);
          const name = relPath.split(/[/\\]/).pop() ?? relPath;
          return {
            path: relPath,
            name,
            status: gitStatusToKind(ch.status),
            ...(ch.originalUri && ch.originalUri.fsPath !== ch.uri.fsPath
              ? { originalPath: toRel(ch.originalUri) }
              : {}),
            ...(ch.renameUri ? { renamePath: toRel(ch.renameUri) } : {}),
          };
        });
        return { data: { files } };
      }
      case "getCommitChangedFiles": {
        const commitHash =
          typeof params?.commitHash === "string" ? params.commitHash.trim() : "";
        if (!commitHash) return { data: { files: [] } };
        try {
          const cwd = repo.rootUri.fsPath;
          const parent = getParentCommit(cwd, commitHash);
          const files = parseDiffNameStatus(cwd, parent, commitHash);
          return { data: { files } };
        } catch (err) {
          log.errorException(err, "getCommitChangedFiles");
          return { data: { files: [] } };
        }
      }
      case "getRepositoryRoot":
        return { data: { root: repo.rootUri.fsPath } };
      default:
        return { error: vscode.l10n.t("api.unknownMethod", method) };
    }
  } catch (e) {
    log.errorException(e, `handleApiRequest(${method})`);
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}
