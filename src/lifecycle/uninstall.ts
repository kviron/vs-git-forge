/**
 * Обработка этапа uninstall жизненного цикла (вызов из deactivate).
 * По образцу vscode-git-graph life-cycle/uninstall.ts — без телеметрии, только локальная логика.
 */

import {
  getDataDirectory,
  getLifeCycleStateInDirectory,
} from "./utils";

/**
 * Вызвать при deactivate расширения (в т.ч. при удалении расширения).
 * Читает сохранённое состояние из директории расширения; при желании можно
 * выполнить очистку или показать сообщение (при обычном deactivate лучше не беспокоить).
 */
export async function runUninstallLifecycle(): Promise<void> {
  try {
    const dir = getDataDirectory();
    const state = await getLifeCycleStateInDirectory(dir);
    if (state?.currentVersion) {
      // При необходимости: логирование, очистка внешних данных и т.д.
      // Без телеметрии ничего не отправляем.
    }
  } catch {
    // Игнорируем ошибки при выгрузке
  }
}
