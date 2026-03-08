/**
 * Реестр представлений webview.
 * Каждый viewId соответствует одному месту подключения в VS Code (панель, сайдбар и т.д.).
 *
 * Как добавить новый webview:
 * 1. Создать views/<name>/ с view.tsx (обёртка с провайдерами при необходимости) и ui/.
 * 2. Добавить VIEW_IDS.<NAME> = "<id>" и запись в VIEW_REGISTRY.
 * 3. На хосте: при создании HTML вызывать getGitForgePanelHtml(..., { viewId: "<id>" }).
 */
import type { Component } from "solid-js";
import { lazy } from "solid-js";
import { GitForgeView } from "@/views/git-view/view";

export const DEFAULT_VIEW_ID = "git-forge";

/** Идентификаторы представлений (совпадают с data-view в HTML и с вызовами с хоста). */
export const VIEW_IDS = {
  GIT_FORGE: "git-forge",
} as const;

export type ViewId = (typeof VIEW_IDS)[keyof typeof VIEW_IDS];

/**
 * Реестр: viewId → компонент.
 * Для новых webview добавить запись и при необходимости lazy()-обёртку для код-сплита.
 */
export const VIEW_REGISTRY: Record<string, Component> = {
  [VIEW_IDS.GIT_FORGE]: GitForgeView,
  // Пример для будущего представления:
  // [VIEW_IDS.OTHER]: lazy(() => import("@/views/other-view/view").then(m => ({ default: m.OtherView }))),
};

export function getViewComponent(viewId: string): Component | undefined {
  return VIEW_REGISTRY[viewId];
}
