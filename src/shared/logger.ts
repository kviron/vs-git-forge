/**
 * Логгер для webview. Отправляет сообщения в extension, где они пишутся
 * в Output (View → Output → Git Forge) с префиксом [git-forge].
 */

import { postMessageToHost } from "./api/vscodeApi";

type LogLevel = "debug" | "info" | "warn" | "error";

function send(level: LogLevel, message: string, ...args: unknown[]): void {
  try {
    postMessageToHost({
      type: "webviewLog",
      level,
      message,
      args: args.length > 0 ? args : undefined,
    });
  } catch {
    // В среде без host (например тесты) игнорируем
  }
}

export const log = {
  debug(message: string, ...args: unknown[]): void {
    send("debug", message, ...args);
  },

  info(message: string, ...args: unknown[]): void {
    send("info", message, ...args);
  },

  warn(message: string, ...args: unknown[]): void {
    send("warn", message, ...args);
  },

  error(message: string, ...args: unknown[]): void {
    send("error", message, ...args);
  },
};
