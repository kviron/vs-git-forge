/**
 * URI и парсинг git:-схемы.
 */

import { Uri } from "vscode";

/** Схема URI для ресурсов Git в SCM (vscode.git). */
export const GIT_URI_SCHEME = "git";

export interface GitUriQuery {
	path: string;
	ref: string;
	decoration?: string;
}

/**
 * Извлекает данные запроса из URI со схемой git (например, из Source Control).
 */
export function getQueryDataFromScmGitUri(uri: Uri): GitUriQuery | undefined {
	if (uri.scheme === GIT_URI_SCHEME) {
		try {
			return JSON.parse(uri.query) as GitUriQuery;
		} catch {
			// ignore
		}
	}
	return undefined;
}
