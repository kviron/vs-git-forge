/**
 * Расширение SourceControlResourceState для Git.
 */

import type { SourceControlResourceState } from "vscode";
import type { Status as ScmStatus } from "./vscode-git";
import type { ScmResourceGroupType } from "./vscode-git.resources.enums";

export interface ScmResource extends SourceControlResourceState {
	readonly resourceGroupType?: ScmResourceGroupType;
	readonly type?: ScmStatus;
}
