/**
 * Host API: фасад для webview, маппинг веток/тегов, форматирование дат, контекст IDE.
 * Единая точка входа — GitForgeApi.request().
 */

export type { ApiResult } from "../../types/api";
export { GitForgeApi } from "./webviewApi";
export { getIdeContext } from "./ideContext";
export type { IdeContext, IdeFlavor } from "./ideContext";
export {
  getTagRefs,
  mapTagRefsToWebview,
  mapLocalBranchesToWebview,
  mapRemoteBranchesToWebview,
  toShortBranchName,
} from "./branchMapping";
export { formatDate, formatDateRelative } from "./dateFormat";
export {
  handleInitRepo,
  handleShowCreateBranchDialog,
  handleShowCreateTagDialog,
  handlePullBranch,
} from "./handlers";
