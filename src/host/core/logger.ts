/**
 * Логгер расширения Git Forge.
 * Пишет в панель Output (View → Output → Git Forge) с уровнями и временными метками.
 * Все сообщения имеют префикс [git-forge].
 */

import * as vscode from "vscode";

const OUTPUT_CHANNEL_NAME = "Git Forge";
const LOG_PREFIX = "[git-forge]";

let channel: vscode.LogOutputChannel | undefined;
/** Включено только при extensionMode === Development (F5). */
let logToConsole = false;

/** Дублирует сообщение в Debug Console только в режиме разработки (F5). */
function toConsole(
  level: "log" | "warn" | "error" | "trace",
  message: string,
  ...args: unknown[]
): void {
  if (!logToConsole) {
    return;
  }
  const traceLabel = level === "trace" ? " [trace]" : "";
  const fn =
    level === "log" || level === "trace"
      ? console.log
      : level === "warn"
        ? console.warn
        : console.error;
  if (args.length > 0) {
    fn(`${LOG_PREFIX}${traceLabel}`, message, ...args);
  } else {
    fn(`${LOG_PREFIX}${traceLabel} ${message}`);
  }
}

/**
 * Инициализирует логгер. Вызывать в activate() расширения.
 * Создаёт канал вывода "Git Forge" в панели Output.
 * Дублирование в Debug Console включается только в режиме разработки (F5).
 */
export function initLogger(
  context: vscode.ExtensionContext,
): vscode.LogOutputChannel {
  if (channel) {
    return channel;
  }
  logToConsole =
    context.extensionMode === vscode.ExtensionMode.Development;
  channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME, {
    log: true,
  });
  context.subscriptions.push(channel);
  channel.info(`${LOG_PREFIX} Логгер инициализирован.`);
  return channel;
}

/**
 * Возвращает текущий канал логов или undefined, если логгер ещё не инициализирован.
 */
export function getLogger(): vscode.LogOutputChannel | undefined {
  return channel;
}

/**
 * Удобные методы логирования с префиксом [git-forge].
 * Безопасны при вызове до initLogger (сообщения игнорируются).
 */
export const log = {
  info(message: string, ...args: unknown[]): void {
    const text = `${LOG_PREFIX} ${message}`;
    channel?.info(text, ...args);
    toConsole("log", message, ...args);
  },

  warn(message: string, ...args: unknown[]): void {
    const text = `${LOG_PREFIX} ${message}`;
    channel?.warn(text, ...args);
    toConsole("warn", message, ...args);
  },

  error(message: string, ...args: unknown[]): void {
    const text = `${LOG_PREFIX} ${message}`;
    channel?.error(text, ...args);
    toConsole("error", message, ...args);
  },

  debug(message: string, ...args: unknown[]): void {
    const text = `${LOG_PREFIX} ${message}`;
    channel?.debug(text, ...args);
    toConsole("log", message, ...args);
  },

  trace(message: string, ...args: unknown[]): void {
    const text = `${LOG_PREFIX} ${message}`;
    channel?.trace(text, ...args);
    toConsole("trace", message, ...args);
  },

  /**
   * Логирует ошибку (сообщение + стек).
   * Панель Output показывается только в режиме разработки (F5), если не передан showPanel: true.
   */
  errorException(
    error: unknown,
    contextMessage?: string,
    options?: { showPanel?: boolean },
  ): void {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const full = contextMessage ? `${contextMessage}: ${msg}` : msg;
    channel?.error(`${LOG_PREFIX} ${full}`);
    if (stack) {
      channel?.error(stack);
    }
    if (logToConsole || options?.showPanel) {
      channel?.show(true);
    }
    toConsole("error", full);
    if (stack && logToConsole) {
      console.error(stack);
    }
  },
};
