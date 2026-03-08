/**
 * Типы групп ресурсов SCM.
 * ScmStatus — алиас Status из основного API git.
 */

export { Status as ScmStatus } from "./vscode-git";

export const enum ScmResourceGroupType {
	Merge,
	Index,
	WorkingTree,
}
