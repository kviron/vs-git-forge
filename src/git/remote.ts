import { execFileSync, execSync } from "child_process";
import { log } from "../core/logger";

/** Короткое имя ветки из ref (origin/feature -> feature, main -> main). */
export function getShortBranchName(ref: string): string {
  if (typeof ref !== "string" || !ref.trim()) return "";
  const t = ref.trim();
  if (t.includes("/")) {
    return t.replace(/^[^/]+\//, "").trim();
  }
  return t.replace(/^refs\/heads\//, "").trim();
}

/** Список имён remotes из конфига (git remote). Пустой, если remotes нет или команда не сработала. */
export function getConfiguredRemotes(repoRoot: string): string[] {
  try {
    const out = execSync("git remote", {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (err) {
    log.debug("getConfiguredRemotes failed", err);
    return [];
  }
}

/** Значение из git config (user.email, user.avatarUrl и т.д.). undefined, если ключа нет. */
export function getGitConfigValue(repoRoot: string, key: string): string | undefined {
  try {
    const out = execSync(`git config --get ${JSON.stringify(key)}`, {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return out.trim() || undefined;
  } catch (err) {
    log.debug("getGitConfigValue failed", key, err);
    return undefined;
  }
}

/** URL remote origin. */
export function getRemoteOriginUrl(repoRoot: string): string | undefined {
  return getGitConfigValue(repoRoot, "remote.origin.url");
}

export type ParsedRemote =
  | { host: "github"; owner: string; repo: string }
  | { host: "gitlab"; baseUrl: string }
  | null;

export function parseRemoteUrl(url: string): ParsedRemote {
  try {
    let u = url.trim().replace(/\.git$/i, "");
    if (u.startsWith("git@")) {
      u = u.replace(/^git@([^:]+):/, "https://$1/");
    }
    const m = u.match(/^(?:https?:\/\/)?([^/]+)\/([^/]+)\/([^/]+?)(?:\/|$)/);
    if (!m) return null;
    const [, hostname, a, b] = m;
    const hostLower = hostname?.toLowerCase() ?? "";
    if (hostLower === "github.com") {
      return { host: "github", owner: a!, repo: b! };
    }
    if (hostLower === "gitlab.com" || hostLower.endsWith(".gitlab.com")) {
      const base = u.startsWith("http")
        ? u.split("/").slice(0, 3).join("/")
        : `https://${hostname}`;
      return { host: "gitlab", baseUrl: base };
    }
    return null;
  } catch (err) {
    log.debug("parseRemoteUrl failed", err);
    return null;
  }
}

/** Узнать upstream ветки (например "origin/main"), если настроен. */
export function getBranchUpstreamRef(
  cwd: string,
  branchShortName: string,
): string | undefined {
  try {
    const out = execFileSync(
      "git",
      ["rev-parse", "-q", "--abbrev-ref", `${branchShortName}@{upstream}`],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const ref = out.trim();
    return ref.length > 0 ? ref : undefined;
  } catch (err) {
    log.debug("getBranchUpstreamRef failed", err);
    return undefined;
  }
}

/** Сколько коммитов локальная ветка отстаёт от upstream. */
export function getBranchBehindCount(
  cwd: string,
  branchShortName: string,
  upstreamRef: string,
): number | undefined {
  try {
    const out = execFileSync(
      "git",
      ["rev-list", "--count", `${branchShortName}..${upstreamRef}`],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const n = parseInt(out.trim(), 10);
    return Number.isNaN(n) ? undefined : n;
  } catch (err) {
    log.debug("getBranchBehindCount failed", err);
    return undefined;
  }
}
