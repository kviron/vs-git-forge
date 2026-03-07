import { log } from "../core/logger";
import {
  getCommitFileContent,
  findFilePathInRevision,
} from "../git/shell";
import { GIT_SHOW_MAX_BUFFER } from "../constants";
import type { GetCommitFileFn } from "../diffDocProvider";

export const getCommitFile: GetCommitFileFn = async (
  repo,
  commit,
  filePath,
  partnerCommit,
) => {
  const pathNorm = filePath.replace(/\\/g, "/");
  try {
    return Promise.resolve(
      getCommitFileContent(repo, commit, pathNorm, {
        maxBuffer: GIT_SHOW_MAX_BUFFER,
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /exists on disk, but not in|did not exist in|path .* does not exist/i.test(
        msg,
      )
    ) {
      const pathInRev = findFilePathInRevision(repo, commit, pathNorm);
      if (pathInRev) {
        try {
          return Promise.resolve(
            getCommitFileContent(repo, commit, pathInRev, {
              maxBuffer: GIT_SHOW_MAX_BUFFER,
            }),
          );
        } catch {
          // fall through
        }
      }
      if (partnerCommit) {
        try {
          return Promise.resolve(
            getCommitFileContent(repo, partnerCommit, pathNorm, {
              maxBuffer: GIT_SHOW_MAX_BUFFER,
            }),
          );
        } catch {
          // fall through
        }
      }
      return "";
    }
    throw err;
  }
};
