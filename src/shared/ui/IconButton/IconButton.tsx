import { createEffect } from 'solid-js';
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

/** В HTML наличие атрибута disabled (в т.ч. disabled="false") отключает кнопку. Управляем им через effect. */
export function IconButton(props: IconButtonProps) {
  let ref: HTMLButtonElement | undefined;
  createEffect(() => {
    if (ref) {
      if (props.disabled) ref.setAttribute('disabled', '');
      else ref.removeAttribute('disabled');
    }
  });
  return (
    <button
      ref={(el) => { ref = el; }}
      type="button"
      class={`icon-btn ${props.active ? 'active' : ''} ${props.class ?? ''}`}
      title={props.title}
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
