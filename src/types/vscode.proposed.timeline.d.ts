/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Proposed Timeline API.
 * https://github.com/microsoft/vscode/issues/84297
 */

declare module "vscode" {
	export class TimelineItem {
		timestamp: number;
		label: string;
		id?: string;
		iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon;
		description?: string;
		detail?: string;
		command?: Command;
		contextValue?: string;
		accessibilityInformation?: AccessibilityInformation;
		constructor(label: string, timestamp: number);
	}

	export interface TimelineChangeEvent {
		uri: Uri;
		reset?: boolean;
	}

	export interface Timeline {
		readonly paging?: { readonly cursor: string | undefined };
		readonly items: readonly TimelineItem[];
	}

	export interface TimelineOptions {
		cursor?: string;
		limit?: number | { timestamp: number; id?: string };
	}

	export interface TimelineProvider {
		onDidChange?: Event<TimelineChangeEvent | undefined>;
		readonly id: string;
		readonly label: string;
		provideTimeline(
			uri: Uri,
			options: TimelineOptions,
			token: CancellationToken
		): ProviderResult<Timeline>;
	}

	export namespace workspace {
		export function registerTimelineProvider(
			scheme: string | string[],
			provider: TimelineProvider
		): Disposable;
	}
}
