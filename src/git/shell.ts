/**
 * Безопасное выполнение Git-команд: только аргументы, без конкатенации строк от пользователя.
 */

import { execFileSync } from "child_process";
import * as path from "path";
import {
  EMPTY_TREE_HASH,
  GIT_DIFF_MAX_BUFFER,
  GIT_SHOW_MAX_BUFFER,
} from "../constants";
import type { WebviewChangedFile } from "../types/webview";
import { log } from "../core/logger";

export { EMPTY_TREE_HASH as emptyTreeHash };

const COMMIT_HASH_REGEX = /^[a-f0-9]{7,40}$/i;

/** Валидация commit hash (7–40 hex). */
export function isValidCommitHash(rev: string): boolean {
  const t = rev?.trim();
  return typeof t === "string" && COMMIT_HASH_REGEX.test(t);
}

/** Нормализация пути: относительный, без .. и без выхода за корень репо. */
export function normalizeRepoPath(repoRoot: string, filePath: string): string | null {
  if (typeof filePath !== "string" || !filePath.trim()) return null;
  const joined = path.join(repoRoot, filePath.replace(/\\/g, "/"));
  const relative = path.relative(repoRoot, joined);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, "/");
}

/** Выполнить git с аргументами (без подстановки произвольных строк). */
export function runGitSync(
  cwd: string,
  args: string[],
  options?: { maxBuffer?: number; encoding?: BufferEncoding },
): string {
  const encoding = options?.encoding ?? "utf8";
  const maxBuffer = options?.maxBuffer ?? 1024 * 1024;
  return execFileSync("git", [...args], {
    cwd,
    encoding,
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  }) as string;
}

/** Получить parent коммита; при ошибке (например, первый коммит) — empty tree. */
export function getParentCommit(cwd: string, commit: string): string {
  if (!isValidCommitHash(commit)) {
    return EMPTY_TREE_HASH;
  }
  try {
    const out = runGitSync(cwd, ["rev-parse", "-q", `${commit}^`], {
      encoding: "utf8",
    });
    return out.trim();
  } catch {
    return EMPTY_TREE_HASH;
  }
}

/** Парсинг вывода git diff --name-status -z в список WebviewChangedFile. */
export function parseDiffNameStatus(
  cwd: string,
  fromRev: string,
  toRev: string,
): WebviewChangedFile[] {
  const args = [
    "diff",
    "--name-status",
    "--find-renames",
    "--diff-filter=AMDR",
    "-z",
    fromRev,
    toRev,
  ];
  const out = runGitSync(cwd, args, {
    encoding: "utf8",
    maxBuffer: GIT_DIFF_MAX_BUFFER,
  });
  const parts = out.split("\0").filter((s) => s.length > 0);
  const files: WebviewChangedFile[] = [];
  for (let i = 0; i < parts.length; ) {
    const statusToken = parts[i];
    if (!statusToken) {
      i += 1;
      continue;
    }
    const statusChar = statusToken.slice(0, 1).toUpperCase();
    const isRename = statusChar === "R";
    if (isRename && i + 2 < parts.length) {
      const path1 = parts[i + 1].replace(/\\/g, "/");
      const path2 = parts[i + 2].replace(/\\/g, "/");
      i += 3;
      const pathNorm = path2;
      const name = pathNorm.split("/").pop() ?? pathNorm;
      files.push({
        path: pathNorm,
        name,
        status: "modified",
        oldPath: path1 !== path2 ? path1 : undefined,
      });
    } else if (i + 1 < parts.length) {
      const path1 = parts[i + 1].replace(/\\/g, "/");
      i += 2;
      const pathNorm = path1;
      const name = pathNorm.split("/").pop() ?? pathNorm;
      const status: "added" | "modified" | "deleted" =
        statusChar === "A" ? "added" : statusChar === "D" ? "deleted" : "modified";
      files.push({ path: pathNorm, name, status });
    } else {
      i += 1;
    }
  }
  return files;
}

/** Содержимое файла на ревизии (git show rev:path). */
export function getCommitFileContent(
  cwd: string,
  rev: string,
  filePathInRev: string,
  options?: { maxBuffer?: number },
): string {
  const maxBuffer = options?.maxBuffer ?? GIT_SHOW_MAX_BUFFER;
  return runGitSync(cwd, ["show", `${rev}:${filePathInRev}`], {
    encoding: "utf8",
    maxBuffer,
  });
}

/**
 * Найти путь файла в указанной ревизии, если он был переименован.
 * Возвращает старый путь (в котором файл существовал в commit) или null.
 */
export function findFilePathInRevision(
  cwd: string,
  commit: string,
  currentPath: string,
): string | null {
  const pathNorm = currentPath.replace(/\\/g, "/");
  const parent = getParentCommit(cwd, commit);
  try {
    const files = parseDiffNameStatus(cwd, parent, commit);
    for (const f of files) {
      if (f.path === pathNorm && f.oldPath) {
        return f.oldPath;
      }
    }
  } catch (err) {
    log.debug("findFilePathInRevision failed", err);
  }
  return null;
}
