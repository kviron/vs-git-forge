/** Хеш пустого дерева Git (git hash-object -t tree /dev/null). */
export const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Ключ глобального состояния для ширины сайдбара панели. */
export const SIDEBAR_WIDTH_KEY = "vs-git-forge.sidebarWidth";

/** ~20% от типичной ширины панели (1200px). */
export const DEFAULT_SIDEBAR_WIDTH = 240;

export const MIN_SIDEBAR_WIDTH = 150;
export const MAX_SIDEBAR_WIDTH = 600;

/** Максимальный размер буфера для git diff (2 MiB). */
export const GIT_DIFF_MAX_BUFFER = 2 * 1024 * 1024;

/** Максимальный размер буфера для git show (10 MiB). */
export const GIT_SHOW_MAX_BUFFER = 10 * 1024 * 1024;

/** Дебаунс (мс) перед отправкой gitStateChanged в webview. */
export const GIT_STATE_CHANGE_DEBOUNCE_MS = 150;

/** Порог (мс) для определения двойного клика в деревьях и списках. */
export const DOUBLE_CLICK_THRESHOLD_MS = 400;

/** Задержка (мс) перед первым шагом увеличения размера панели при открытии. */
export const PANEL_VIEW_SIZE_INITIAL_DELAY_MS = 100;

/** Задержка (мс) между шагами увеличения размера панели. */
export const PANEL_VIEW_SIZE_STEP_DELAY_MS = 50;

/** Префикс заголовка вкладки diff при сравнении веток. */
export const BRANCH_DIFF_TAB_TITLE_PREFIX = "\u21C4 Changes: ";
