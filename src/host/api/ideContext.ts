/**
 * Контекст IDE для передачи в webview: язык, тема, приложение и т.д.
 * Единый слой сбора параметров окружения VS Code/Cursor и других форков.
 */

import * as vscode from "vscode";

/**
 * Распознанный форк IDE по vscode.env.appName.
 * "other" — запасной вариант для неизвестных форков (VSCodium, Code - OSS и т.д.).
 */
export type IdeFlavor = "cursor" | "vscode" | "other";

export interface IdeContext {
  /** Язык интерфейса (например "en", "ru", "en-US") */
  language: string;
  /** Имя приложения ("Visual Studio Code", "Cursor", …) */
  appName: string;
  /** Распознанная среда: Cursor, VS Code или другой форк */
  ideFlavor: IdeFlavor;
  /** Среда: "desktop" | "web" | "github.dev" | "codespaces" */
  appHost: string;
  /** Тема: 1 = light, 2 = dark, 3 = high contrast */
  colorThemeKind: number;
  /** UI: desktop или web */
  uiKind: "desktop" | "web";
}

function detectIdeFlavor(appName: string): IdeFlavor {
  const name = appName.toLowerCase();
  if (name.includes("cursor")) return "cursor";
  if (
    name.includes("visual studio code") ||
    name.includes("vscode") ||
    name.includes("code - ")
  ) {
    return "vscode";
  }
  return "other";
}

/**
 * Собрать текущий контекст IDE из vscode.env и vscode.window.
 * Вызывается при запросе getIdeContext из webview или при инициализации панели.
 */
export function getIdeContext(): IdeContext {
  const language = vscode.env.language ?? "en";
  const appName = vscode.env.appName ?? "Visual Studio Code";
  const appHost = vscode.env.appHost ?? "desktop";
  const defaultThemeKind = vscode.ColorThemeKind.Dark;
  const colorThemeKind =
    vscode.window.activeColorTheme?.kind ?? defaultThemeKind;
  const uiKind = vscode.env.uiKind === vscode.UIKind.Web ? "web" : "desktop";

  return {
    language,
    appName,
    ideFlavor: detectIdeFlavor(appName),
    appHost,
    colorThemeKind,
    uiKind,
  };
}
