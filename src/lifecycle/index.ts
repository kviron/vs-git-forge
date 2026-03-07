/**
 * Жизненный цикл расширения (по образцу vscode-git-graph life-cycle):
 * startup — при активации (install / update / startup),
 * uninstall — при деактивации (в т.ч. удаление расширения),
 * utils — общие типы и работа с файлом состояния.
 */

export {
  runStartupLifecycle,
  type LifeCycleStage,
  type LifeCycleState,
  type StartupResult,
} from "./startup";
export { runUninstallLifecycle } from "./uninstall";
export {
  getDataDirectory,
  getLifeCycleStateInDirectory,
  saveLifeCycleStateInDirectory,
  type LifeCycleState as FileLifeCycleState,
} from "./utils";
