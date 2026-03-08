import * as vscode from "vscode";
import { getGitApi } from "../core/repoManager";
import { log } from "../core/logger";
import { runGitSync } from "../git/shell";
import type { GitRepository } from "../core/repoManager";
import type { ApiResult } from "../../types/api";

/** Параметры initRepo. */
interface InitRepoParams {
  rootUri?: string;
}

/** Задержка перед открытием диалога (мс), чтобы успел закрыться предыдущий UI. */
const UI_DIALOG_DELAY_MS = 100;

/** Инициализировать Git-репозиторий в папке. */
export async function handleInitRepo(
  params: Record<string, unknown> | undefined,
): Promise<ApiResult> {
  const { rootUri } = (params ?? {}) as InitRepoParams;
  const rootUriStr = typeof rootUri === "string" ? rootUri : undefined;
  const folder = rootUriStr
    ? vscode.Uri.file(rootUriStr)
    : vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder) {
    return { error: vscode.l10n.t("initRepo.noFolder") };
  }
  const api = await getGitApi();
  if (!api) {
    return { error: vscode.l10n.t("initRepo.gitNotAvailable") };
  }
  try {
    await api.init(folder);
    return { data: { success: true } };
  } catch (e) {
    log.errorException(e, "handleInitRepo");
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}

/** Показать диалог создания новой ветки и выполнить git branch. */
export async function handleShowCreateBranchDialog(
  params: Record<string, unknown> | undefined,
  repo: GitRepository | null,
): Promise<{ data?: string | null; error?: string }> {
  if (!repo) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("createBranch.repoNotFound"),
    );
    return { error: vscode.l10n.t("createBranch.repoNotFoundShort") };
  }
  const sourceCommitHash =
    typeof params?.sourceCommitHash === "string"
      ? params.sourceCommitHash.trim()
      : "";
  const sourceBranchName =
    typeof params?.sourceBranchName === "string"
      ? params.sourceBranchName.trim()
      : "";
  const sourceRef = sourceCommitHash
    ? sourceCommitHash
    : sourceBranchName || repo.state.HEAD?.name || "HEAD";
  const shortRef = sourceCommitHash
    ? sourceCommitHash.slice(0, 7)
    : sourceRef.replace(/^refs\/heads\//, "").trim() || sourceRef;
  const title = sourceCommitHash
    ? vscode.l10n.t("createBranch.titleFromCommit", shortRef)
    : vscode.l10n.t("createBranch.titleFromBranch", shortRef);

  await new Promise((r) => setTimeout(r, UI_DIALOG_DELAY_MS));

  const newName = await vscode.window.showInputBox({
    title,
    prompt: vscode.l10n.t("createBranch.prompt"),
    placeHolder: vscode.l10n.t("createBranch.placeHolder"),
    validateInput(value) {
      const trimmed = value?.trim() ?? "";
      if (!trimmed) return vscode.l10n.t("createBranch.validateEmpty");
      if (!/^[a-zA-Z0-9/_.-]+$/.test(trimmed)) {
        return vscode.l10n.t("createBranch.validateInvalid");
      }
      return null;
    },
  });

  if (newName === undefined) return { data: null };
  const trimmedName = newName.trim();
  if (!trimmedName) return { data: null };

  const checkoutChoice = await vscode.window.showQuickPick(
    [
      {
        label: vscode.l10n.t("createBranch.choiceCreate"),
        description: vscode.l10n.t("createBranch.choiceCreateDesc"),
        checkout: false,
      },
      {
        label: `$(git-branch) ${vscode.l10n.t("createBranch.choiceCheckout")}`,
        description: vscode.l10n.t("createBranch.choiceCheckoutDesc"),
        checkout: true,
      },
    ],
    {
      title: vscode.l10n.t("createBranch.branchTitle", trimmedName),
      placeHolder: vscode.l10n.t("createBranch.placeHolderChoice"),
      ignoreFocusOut: true,
    },
  );

  if (checkoutChoice === undefined) return { data: null };
  const checkout = checkoutChoice.checkout;
  const cwd = repo.rootUri.fsPath;

  try {
    runGitSync(cwd, ["branch", trimmedName, sourceRef]);
    if (checkout) {
      runGitSync(cwd, ["checkout", trimmedName]);
    }
    void vscode.window.showInformationMessage(
      checkout
        ? vscode.l10n.t("createBranch.branchCreatedActive", trimmedName)
        : vscode.l10n.t("createBranch.branchCreatedFrom", trimmedName, shortRef),
    );
    return { data: trimmedName };
  } catch (e) {
    log.errorException(e, "handleShowCreateBranchDialog");
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}

/** Параметры pullBranch. */
interface PullBranchParams {
  branchName?: string;
}

/** Обновить локальную ветку (git pull). Без терминала. При ошибке pull восстанавливаем исходную ветку. */
export async function handlePullBranch(
  params: Record<string, unknown> | undefined,
  repo: GitRepository | null,
): Promise<ApiResult> {
  if (!repo) return { error: vscode.l10n.t("pullBranch.repoNotFound") };
  const branchName =
    typeof (params as PullBranchParams)?.branchName === "string"
      ? (params as PullBranchParams).branchName?.trim() ?? ""
      : "";
  if (!branchName) return { error: vscode.l10n.t("pullBranch.noBranch") };
  const cwd = repo.rootUri.fsPath;
  const headName = repo.state.HEAD?.name ?? "";
  const currentShort = headName.replace(/^refs\/heads\//, "").trim();
  try {
    if (currentShort !== branchName) {
      runGitSync(cwd, ["checkout", branchName]);
    }
    runGitSync(cwd, ["pull"]);
    if (currentShort !== branchName) {
      runGitSync(cwd, ["checkout", currentShort]);
    }
    return { data: { success: true } };
  } catch (e) {
    log.errorException(e, "handlePullBranch");
    if (currentShort !== branchName) {
      try {
        runGitSync(cwd, ["checkout", currentShort]);
      } catch (restoreErr) {
        log.errorException(restoreErr, "handlePullBranch: restore branch");
      }
    }
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}

/** Показать диалог создания тега на указанном коммите и выполнить git tag. */
export async function handleShowCreateTagDialog(
  params: Record<string, unknown> | undefined,
  repo: GitRepository | null,
): Promise<{ data?: string | null; error?: string }> {
  if (!repo) {
    void vscode.window.showErrorMessage(
      vscode.l10n.t("createTag.repoNotFound"),
    );
    return { error: vscode.l10n.t("createTag.repoNotFoundShort") };
  }
  const commitHash =
    typeof params?.commitHash === "string" ? params.commitHash.trim() : "";
  if (!commitHash) return { error: vscode.l10n.t("createTag.noCommit") };
  const shortHash = commitHash.slice(0, 7);
  const title = vscode.l10n.t("createTag.title", shortHash);

  await new Promise((r) => setTimeout(r, UI_DIALOG_DELAY_MS));

  const tagName = await vscode.window.showInputBox({
    title,
    prompt: vscode.l10n.t("createTag.prompt"),
    placeHolder: vscode.l10n.t("createTag.placeHolder"),
    validateInput(value) {
      const trimmed = value?.trim() ?? "";
      if (!trimmed) return vscode.l10n.t("createTag.validateEmpty");
      if (!/^[a-zA-Z0-9/_.-]+$/.test(trimmed)) {
        return vscode.l10n.t("createTag.validateInvalid");
      }
      return null;
    },
  });

  if (tagName === undefined || !tagName.trim()) return { data: null };
  const trimmedName = tagName.trim();
  const cwd = repo.rootUri.fsPath;
  try {
    runGitSync(cwd, ["tag", trimmedName, commitHash]);
    void vscode.window.showInformationMessage(
      vscode.l10n.t("createTag.created", trimmedName, shortHash),
    );
    return { data: trimmedName };
  } catch (e) {
    log.errorException(e, "handleShowCreateTagDialog");
    const message = e instanceof Error ? e.message : String(e);
    return { error: message };
  }
}
