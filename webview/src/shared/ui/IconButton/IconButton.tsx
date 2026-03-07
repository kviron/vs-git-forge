import type { JSX } from 'solid-js';

interface IconButtonProps {
  /** Текст/символ иконки (если не задан iconSlot) */
  icon?: string;
  /** SVG или элемент иконки (приоритет над icon) */
  iconSlot?: JSX.Element;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  class?: string;
  children?: JSX.Element;
}

export function IconButton(props: IconButtonProps) {
  return (
    <button
      type="button"
      class={`icon-btn ${props.active ? 'active' : ''} ${props.class ?? ''}`}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props.title}
    >
      {props.iconSlot ?? (
        <span class="icon-btn__symbol" aria-hidden="true">
          {props.icon}
        </span>
      )}
      {props.children}
    </button>
  );
}
