import * as vscode from "vscode";
import { MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH } from "../constants";

export const DEFAULT_WEBVIEW_VIEW_ID = "git-forge";

export interface PanelHtmlOptions {
  /** Идентификатор представления (data-view). Какой webview показывать. */
  viewId?: string;
}

export function getGitForgePanelHtml(
  webview: vscode.Webview,
  sidebarWidthPx: number,
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri,
  codiconsCssUri: vscode.Uri,
  options?: PanelHtmlOptions,
): string {
  const safeWidth = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, sidebarWidthPx),
  );
  const lang = vscode.env.language;
  const viewId = options?.viewId ?? DEFAULT_WEBVIEW_VIEW_ID;
  const cspSource = webview.cspSource;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; script-src ${cspSource}; style-src ${cspSource}; font-src ${cspSource}; connect-src ${cspSource} https:;">
	<link rel="stylesheet" href="${styleUri.toString()}">
	<link rel="stylesheet" href="${codiconsCssUri.toString()}">
</head>
<body>
	<div id="root" data-view="${viewId}" data-sidebar-width="${safeWidth}" data-lang="${lang}"></div>
	<script src="${scriptUri.toString()}"></script>
</body>
</html>`;
}
