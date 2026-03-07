import {
  createContext,
  createEffect,
  createSignal,
  useContext,
  type Context,
  type JSX,
  type Accessor,
  type Setter,
} from 'solid-js';
import type { Branch, Tag } from '../lib/types';
import { log } from '../logger';

/** Глобальный контекст: выбранная ветка/тег. Ветка — полный объект Branch (isCurrent, remote, name и т.д.) из списка. */
export type SelectedRefContextValue = {
  selectedBranch: Accessor<Branch | null>;
  setSelectedBranch: Setter<Branch | null>;
  selectedTag: Accessor<Tag | null>;
  setSelectedTag: Setter<Tag | null>;
};

const defaultValue: SelectedRefContextValue = {
  selectedBranch: () => null,
  setSelectedBranch: () => {},
  selectedTag: () => null,
  setSelectedTag: () => {},
};

export const SelectedBranchContext: Context<SelectedRefContextValue> =
  createContext<SelectedRefContextValue>(defaultValue);

/** Хук: выбранная ветка или тег (взаимоисключающие). */
export function useSelectedBranch(): SelectedRefContextValue {
  return useContext(SelectedBranchContext);
}

export function SelectedBranchProvider(props: { children: JSX.Element }) {
  const [selectedBranch, setSelectedBranchRaw] = createSignal<Branch | null>(null);
  const [selectedTag, setSelectedTagRaw] = createSignal<Tag | null>(null);

  createEffect(() => {
    const branch = selectedBranch();
    const tag = selectedTag();
    if (branch) {
      log.debug('SelectedBranchContext: выбранная ветка изменилась, полный объект:', JSON.stringify(branch));
    } else if (tag) {
      log.debug('SelectedBranchContext: выбранный тег изменился, полный объект:', JSON.stringify(tag));
    } else {
      log.debug('SelectedBranchContext: выбор сброшен (ветка и тег null)');
    }
  });

  const setSelectedBranch: Setter<Branch | null> = (value) => {
    setSelectedTagRaw(null);
    setSelectedBranchRaw(typeof value === 'function' ? value(selectedBranch()) : value);
  };
  const setSelectedTag: Setter<Tag | null> = (value) => {
    setSelectedBranchRaw(null);
    setSelectedTagRaw(typeof value === 'function' ? value(selectedTag()) : value);
  };
  return (
    <SelectedBranchContext.Provider
      value={{
        selectedBranch,
        setSelectedBranch,
        selectedTag,
        setSelectedTag,
      }}
    >
      {props.children}
    </SelectedBranchContext.Provider>
  );
}
