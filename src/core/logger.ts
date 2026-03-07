/**
 * Логгер расширения Git Forge.
 * Пишет в панель Output (View → Output → Git Forge) с уровнями и временными метками.
 * Все сообщения имеют префикс [git-forge].
 */

import * as vscode from "vscode";

const OUTPUT_CHANNEL_NAME = "Git Forge";
const LOG_PREFIX = "[git-forge]";

let channel: vscode.LogOutputChannel | undefined;

/** Дублирует сообщение в Debug Console при отладке расширения (F5). */
function toConsole(
  level: "log" | "warn" | "error",
  message: string,
  ...args: unknown[]
): void {
  const fn =
    level === "log" ? console.log : level === "warn" ? console.warn : console.error;
  if (args.length > 0) {
    fn(LOG_PREFIX, message, ...args);
  } else {
    fn(`${LOG_PREFIX} ${message}`);
  }
}

/**
 * Инициализирует логгер. Вызывать в activate() расширения.
 * Создаёт канал вывода "Git Forge" в панели Output.
 */
export function initLogger(
  context: vscode.ExtensionContext,
): vscode.LogOutputChannel {
  if (channel) {
    return channel;
  }
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
    toConsole("log", message, ...args);
  },

  /**
   * Логирует ошибку (сообщение + стек) и при необходимости показывает канал Output.
   */
  errorException(error: unknown, contextMessage?: string): void {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const full = contextMessage ? `${contextMessage}: ${msg}` : msg;
    channel?.error(`${LOG_PREFIX} ${full}`);
    if (stack) {
      channel?.error(stack);
    }
    channel?.show(true);
    toConsole("error", full);
    if (stack) {
      console.error(stack);
    }
  },
};
