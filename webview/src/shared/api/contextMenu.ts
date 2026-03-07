/**
 * Контекстное меню внутри webview (по образцу vscode-git-graph).
 * Показывает список действий по правому клику и позиционирует меню у курсора.
 */

export interface ContextMenuAction {
  readonly title: string;
  readonly visible: boolean;
  readonly onClick: () => void;
  /** Иконка (код иконки VS Code или HTML). Пока оставь пустым — место под иконку зарезервировано. */
  readonly icon?: string;
  /** Горячая клавиша (например "Ctrl+Alt+C"). Пока оставь пустым — место под shortcut зарезервировано. */
  readonly shortcut?: string;
}

export type ContextMenuActions = ReadonlyArray<ReadonlyArray<ContextMenuAction>>;

import { log } from "../logger";

const CLASS_CONTEXT_MENU_ACTIVE = "contextMenuActive";

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Класс для отображения контекстного меню в webview.
 * Закрывается по клику вне меню или по contextmenu.
 */
export class ContextMenu {
  private elem: HTMLElement | null = null;
  private onClose: (() => void) | null = null;

  constructor() {
    log.debug("ContextMenu: создан экземпляр, подписка на document click/contextmenu");
    const listener = (e: Event) => {
      const target = e.target as HTMLElement;
      log.debug("ContextMenu: document listener вызван", e.type, "target:", target?.className);
      // Не закрывать по contextmenu, если клик по элементу, из которого открывается меню
      // (событие может всплыть до document до/после show(), из-за чего меню сразу закрывалось)
      if (
        e.type === "contextmenu" &&
        (target?.closest?.(".branch-list-item") ||
          target?.closest?.(".commit-list-item") ||
          target?.closest?.(".tag-list-item"))
      ) {
        return;
      }
      this.close();
    };
    document.addEventListener("click", listener);
    document.addEventListener("contextmenu", listener);
  }

  /**
   * Показать контекстное меню.
   * @param actions — группы действий (каждая группа может быть разделена разделителем).
   * @param event — событие мыши для позиционирования.
   * @param container — элемент, в который вставляется меню (например document.body).
   * @param onClose — вызывается при закрытии меню.
   */
  show(
    actions: ContextMenuActions,
    event: MouseEvent,
    container: HTMLElement,
    onClose?: () => void
  ): void {
    log.debug("ContextMenu: show() вызван, visible actions:", actions.flat().filter((a) => a.visible).length);
    let html = "";
    const handlers: Array<() => void> = [];
    let handlerId = 0;
    this.close();

    for (let i = 0; i < actions.length; i++) {
      let groupHtml = "";
      for (let j = 0; j < actions[i].length; j++) {
        const action = actions[i][j];
        if (action.visible) {
          const iconContent = action.icon ?? "";
          const shortcutContent = escapeHtml(action.shortcut ?? "");
          groupHtml += `<li class="contextMenuItem" data-index="${handlerId++}"><span class="contextMenuItem__icon">${iconContent}</span><span class="contextMenuItem__label">${escapeHtml(action.title)}</span><span class="contextMenuItem__shortcut">${shortcutContent}</span></li>`;
          handlers.push(action.onClick);
        }
      }
      if (groupHtml !== "") {
        if (html !== "") html += '<li class="contextMenuDivider"></li>';
        html += groupHtml;
      }
    }

    if (handlers.length === 0) {
      log.debug("ContextMenu: show() выход: нет видимых действий");
      return;
    }

    const menu = document.createElement("ul");
    menu.className = "contextMenu";
    menu.style.opacity = "0";
    menu.innerHTML = html;
    container.appendChild(menu);

    const menuBounds = menu.getBoundingClientRect();
    const padding = 2;
    let left = event.clientX;
    let top = event.clientY;
    const viewportW = document.documentElement.clientWidth;
    const viewportH = document.documentElement.clientHeight;
    if (left + menuBounds.width + padding > viewportW) {
      left = viewportW - menuBounds.width - padding;
    }
    if (top + menuBounds.height + padding > viewportH) {
      top = viewportH - menuBounds.height - padding;
    }
    if (left < padding) left = padding;
    if (top < padding) top = padding;

    menu.style.position = "fixed";
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.opacity = "1";

    this.elem = menu;
    this.onClose = onClose ?? null;
    log.debug("ContextMenu: show() меню добавлено в DOM");

    menu.addEventListener("click", (e) => {
      const item = (e.target as HTMLElement).closest(".contextMenuItem");
      if (item instanceof HTMLElement) {
        const index = item.dataset.index;
        if (index !== undefined) {
          e.stopPropagation();
          this.close();
          const id = parseInt(index, 10);
          if (id >= 0 && id < handlers.length) handlers[id]();
        }
      }
      e.stopPropagation();
    });
  }

  /** Закрыть меню, если открыто. */
  close(): void {
    if (this.elem !== null) {
      log.debug("ContextMenu: close() удаление меню из DOM");
      this.elem.remove();
      this.elem = null;
    }
    const active = document.getElementsByClassName(CLASS_CONTEXT_MENU_ACTIVE);
    for (let i = 0; i < active.length; i++) {
      (active[i] as HTMLElement).classList.remove(CLASS_CONTEXT_MENU_ACTIVE);
    }
    if (this.onClose !== null) {
      this.onClose();
      this.onClose = null;
    }
  }

  /** Открыто ли меню. */
  isOpen(): boolean {
    return this.elem !== null;
  }
}

/** Глобальный экземпляр контекстного меню для webview. */
let contextMenuInstance: ContextMenu | null = null;

/** Получить единственный экземпляр контекстного меню. */
export function getContextMenu(): ContextMenu {
  if (contextMenuInstance === null) {
    log.debug("ContextMenu: getContextMenu — создаём новый экземпляр");
    contextMenuInstance = new ContextMenu();
  }
  return contextMenuInstance;
}
