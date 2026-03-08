/**
 * Жизненный цикл расширения при старте: первый запуск (install), обновление (update), обычный запуск.
 * По образцу vscode-git-graph startup.ts — без телеметрии; состояние сохраняется в globalState и в файл (для uninstall).
 */

import * as vscode from "vscode";
import {
  getDataDirectory,
  saveLifeCycleStateInDirectory,
  type LifeCycleState as FileLifeCycleState,
} from "./utils";

const GLOBAL_STATE_KEY = "vs-git-forge.lifecycle";

export type LifeCycleStage = "install" | "update" | "startup";

export interface LifeCycleState {
  /** Текущая версия расширения после этого запуска */
  currentVersion: string;
  /** Предыдущая версия (есть только после update) */
  previousVersion?: string | null;
}

export interface StartupResult {
  stage: LifeCycleStage;
  /** Версия до обновления (только при stage === "update") */
  previousVersion?: string;
  currentVersion: string;
}

function getExtensionVersion(context: vscode.ExtensionContext): string {
  const pkg = context.extension.packageJSON as { version?: string };
  return pkg?.version ?? "0.0.0";
}

function getStoredState(
  context: vscode.ExtensionContext,
): LifeCycleState | undefined {
  const raw = context.globalState.get<LifeCycleState>(GLOBAL_STATE_KEY);
  if (raw && typeof raw.currentVersion === "string") {
    return raw;
  }
  return undefined;
}

function saveState(
  context: vscode.ExtensionContext,
  state: LifeCycleState,
): void {
  context.globalState.update(GLOBAL_STATE_KEY, state);
}

/** Сохранить состояние в globalState и в файлы (globalStorage + директория расширения), как в vscode-git-graph. */
async function persistLifeCycleState(
  context: vscode.ExtensionContext,
  state: FileLifeCycleState,
): Promise<void> {
  saveState(context, state);
  await Promise.all([
    saveLifeCycleStateInDirectory(context.globalStoragePath, state),
    saveLifeCycleStateInDirectory(getDataDirectory(), state),
  ]);
}

/**
 * Запускать при activate. Определяет: первый запуск (install), обновление (update) или обычный старт (startup),
 * сохраняет текущую версию в globalState и в файлы (для uninstall).
 *
 * @param context контекст расширения
 * @param options.skipInDevelopmentHost если true, в Extension Development Host всегда возвращаем startup (без install/update)
 */
export function runStartupLifecycle(
  context: vscode.ExtensionContext,
  options?: { skipInDevelopmentHost?: boolean },
): StartupResult {
  const currentVersion = getExtensionVersion(context);
  const stored = getStoredState(context);

  if (options?.skipInDevelopmentHost && isExtensionDevelopmentHost()) {
    const state = stored
      ? { ...stored, currentVersion }
      : { currentVersion };
    void persistLifeCycleState(context, state);
    return { stage: "startup", currentVersion };
  }

  if (stored === undefined) {
    const state = { currentVersion };
    void persistLifeCycleState(context, state);
    return { stage: "install", currentVersion };
  }

  if (stored.currentVersion !== currentVersion) {
    const state = {
      currentVersion,
      previousVersion: stored.currentVersion,
    };
    void persistLifeCycleState(context, state);
    return {
      stage: "update",
      previousVersion: stored.currentVersion,
      currentVersion,
    };
  }

  return { stage: "startup", currentVersion };
}

/**
 * Проверка, что расширение запущено в Extension Development Host (F5 / Run Extension).
 * Эвристика: в тестовом окружении sessionId может быть заглушкой.
 */
function isExtensionDevelopmentHost(): boolean {
  try {
    return vscode.env.sessionId === "someValue.sessionId";
  } catch {
    return false;
  }
}
