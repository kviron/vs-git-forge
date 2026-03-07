import { log } from "../core/logger";

const FETCH_AVATAR_TIMEOUT_MS = 15000;

async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs = FETCH_AVATAR_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(id);
  }
}

/** Аватарки коммитов с GitHub API (sha -> avatar_url). */
export async function fetchGitHubCommitAvatars(
  owner: string,
  repo: string,
  ref: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const shaParam = ref && ref !== "HEAD" ? ref : undefined;
    const q = shaParam
      ? `?per_page=100&sha=${encodeURIComponent(shaParam)}`
      : "?per_page=100";
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits${q}`,
      { headers: { Accept: "application/vnd.github.v3+json" } },
    );
    if (!res.ok) return map;
    const data = (await res.json()) as Array<{
      sha?: string;
      author?: { avatar_url?: string };
    }>;
    if (!Array.isArray(data)) return map;
    for (const c of data) {
      const sha = c.sha;
      const avatar = c.author?.avatar_url;
      if (sha && avatar) {
        map.set(sha, avatar);
        if (sha.length >= 8) map.set(sha.slice(0, 8), avatar);
      }
    }
  } catch (err) {
    log.debug("fetchGitHubCommitAvatars failed", err);
  }
  return map;
}

/** Аватарки по email с GitLab Avatar API (email -> avatar_url). */
export async function fetchGitLabAvatarsByEmail(
  baseUrl: string,
  emails: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const apiBase = baseUrl.replace(/\/$/, "") + "/api/v4";
  await Promise.all(
    emails.map(async (email) => {
      try {
        const res = await fetchWithTimeout(
          `${apiBase}/avatar?email=${encodeURIComponent(email)}&size=64`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { avatar_url?: string };
        if (data?.avatar_url) map.set(email.toLowerCase().trim(), data.avatar_url);
      } catch (err) {
        log.debug("fetchGitLabAvatarsByEmail failed for", email, err);
      }
    }),
  );
  return map;
}
