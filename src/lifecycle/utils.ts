/**
 * Утилиты жизненного цикла расширения (install / update / uninstall).
 * По образцу vscode-git-graph life-cycle/utils.ts — без телеметрии, только локальное состояние в файле.
 */

import * as fs from "fs";
import * as path from "path";

const LIFECYCLE_FILENAME = "life-cycle.json";

/** Состояние жизненного цикла для хранения в файле (и при необходимости в globalState). */
export interface LifeCycleState {
  /** Текущая версия расширения */
  currentVersion: string;
  /** Предыдущая версия (есть только после update) */
  previousVersion?: string | null;
}

/**
 * Директория для файла состояния внутри установки расширения.
 * Используется при uninstall (deactivate может прочитать состояние).
 */
export function getDataDirectory(): string {
  return path.join(__dirname, "data");
}

function getLifeCycleFilePathInDirectory(directory: string): string {
  return path.join(directory, LIFECYCLE_FILENAME);
}

/**
 * Прочитать состояние жизненного цикла из директории (файл life-cycle.json).
 */
export function getLifeCycleStateInDirectory(
  directory: string,
): Promise<LifeCycleState | null> {
  const filePath = getLifeCycleFilePathInDirectory(directory);
  return fs.promises
    .readFile(filePath, "utf8")
    .then((data) => {
      try {
        return JSON.parse(data) as LifeCycleState;
      } catch {
        return null;
      }
    })
    .catch(() => null);
}

/**
 * Сохранить состояние жизненного цикла в директорию.
 */
export function saveLifeCycleStateInDirectory(
  directory: string,
  state: LifeCycleState,
): Promise<void> {
  const filePath = getLifeCycleFilePathInDirectory(directory);
  return fs.promises
    .mkdir(directory, { recursive: true })
    .then(() =>
      fs.promises.writeFile(
        filePath,
        JSON.stringify(state, null, 0),
        "utf8",
      ),
    );
}
