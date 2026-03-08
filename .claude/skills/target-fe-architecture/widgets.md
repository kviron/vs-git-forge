# Widgets

Complex UI blocks that combine multiple features with internal state.

## When to Create Widget

- Combines 2+ features
- Has complex internal state
- Manages coordination between sub-components
- Real-time or collaborative features
- Would be 300+ lines as single component

## Widget Structure

```
widgets/widget-name/
├── index.ts              # Public API
├── ui/
│   ├── widget-name.tsx   # Main composition component
│   ├── sub-component.tsx
│   └── another-part.tsx
├── model/
│   ├── use-widget-state.ts     # Main state hook
│   ├── widget-context.tsx      # Shared context (if needed)
│   └── types.ts
└── lib/
    └── helpers.ts              # Widget-specific utilities
```

## Translation Editor Widget

Real-time collaborative translation editor:

```
widgets/translation-editor/
├── index.ts
├── ui/
│   ├── translation-editor.tsx  # Main composition
│   ├── presence-bar.tsx        # Who's online
│   ├── key-list.tsx            # Virtualized key list
│   ├── key-row.tsx             # Single key row
│   ├── translation-cell.tsx    # Editable cell
│   └── conflict-dialog.tsx     # Conflict resolution
├── model/
│   ├── use-realtime-sync.ts    # WebSocket sync
│   ├── use-presence.ts         # Presence tracking
│   ├── use-optimistic-update.ts
│   ├── editor-context.tsx      # Shared state
│   └── types.ts
└── lib/
    ├── conflict-resolver.ts    # OT/CRDT logic
    └── selection-manager.ts
```

### Main Widget Component

```tsx
// widgets/translation-editor/ui/translation-editor.tsx
'use client';

import { EditorProvider } from '../model/editor-context';
import { useRealtimeSync } from '../model/use-realtime-sync';
import { usePresence } from '../model/use-presence';
import { PresenceBar } from './presence-bar';
import { KeyList } from './key-list';
import { ConflictDialog } from './conflict-dialog';

interface TranslationEditorProps {
  branchId: string;
  languages: string[];
}

export function TranslationEditor({ branchId, languages }: TranslationEditorProps) {
  const { keys, updateTranslation, conflict, resolveConflict } = useRealtimeSync(branchId);

  const { users, focusKey, blurKey } = usePresence(branchId);

  return (
    <EditorProvider branchId={branchId} languages={languages}>
      <div className="island space-y-4">
        <PresenceBar users={users} />

        <KeyList
          keys={keys}
          languages={languages}
          onUpdate={updateTranslation}
          onFocus={focusKey}
          onBlur={blurKey}
          activeUsers={users}
        />

        <ConflictDialog conflict={conflict} onResolve={resolveConflict} />
      </div>
    </EditorProvider>
  );
}
```

### Shared Context

```tsx
// widgets/translation-editor/model/editor-context.tsx
'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface EditorState {
  branchId: string;
  languages: string[];
  selectedKeys: Set<string>;
  selectKey: (keyId: string) => void;
  deselectKey: (keyId: string) => void;
  clearSelection: () => void;
}

const EditorContext = createContext<EditorState | null>(null);

export function EditorProvider({
  branchId,
  languages,
  children,
}: {
  branchId: string;
  languages: string[];
  children: ReactNode;
}) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const selectKey = (keyId: string) => {
    setSelectedKeys((prev) => new Set(prev).add(keyId));
  };

  const deselectKey = (keyId: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      next.delete(keyId);
      return next;
    });
  };

  const clearSelection = () => setSelectedKeys(new Set());

  return (
    <EditorContext.Provider
      value={{
        branchId,
        languages,
        selectedKeys,
        selectKey,
        deselectKey,
        clearSelection,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor() {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error('useEditor must be used within EditorProvider');
  }
  return context;
}
```

### Real-time Sync Hook

```tsx
// widgets/translation-editor/model/use-realtime-sync.ts
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface Conflict {
  keyId: string;
  language: string;
  localValue: string;
  remoteValue: string;
}

export function useRealtimeSync(branchId: string) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<Conflict | null>(null);

  // Get initial data from React Query cache
  const keys = useKeys(branchId);

  useEffect(() => {
    const ws = new WebSocket(`/ws/branches/${branchId}`);

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'translation:updated':
          // Optimistic update in cache
          queryClient.setQueryData(['keys', branchId], (old) =>
            updateKeyInCache(old, message.payload)
          );
          break;

        case 'conflict':
          setConflict(message.payload);
          break;
      }
    };

    return () => ws.close();
  }, [branchId, queryClient]);

  const updateTranslation = useCallback(
    async (keyId: string, language: string, value: string) => {
      // Optimistic update
      queryClient.setQueryData(['keys', branchId], (old) =>
        updateKeyInCache(old, { keyId, language, value })
      );

      // Send to server
      await fetch(`/api/translations/${keyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ language, value }),
      });
    },
    [branchId, queryClient]
  );

  const resolveConflict = useCallback(
    (resolution: 'local' | 'remote') => {
      if (!conflict) return;

      const value = resolution === 'local' ? conflict.localValue : conflict.remoteValue;

      updateTranslation(conflict.keyId, conflict.language, value);
      setConflict(null);
    },
    [conflict, updateTranslation]
  );

  return {
    keys: keys.data ?? [],
    isLoading: keys.isLoading,
    updateTranslation,
    conflict,
    resolveConflict,
  };
}
```

### Public API

```typescript
// widgets/translation-editor/index.ts
export { TranslationEditor } from './ui/translation-editor';
export type { TranslationEditorProps } from './ui/translation-editor';
```

## Import Wizard Widget

Multi-step import flow:

```
widgets/import-wizard/
├── index.ts
├── ui/
│   ├── import-wizard.tsx       # Main wizard
│   ├── file-upload-step.tsx
│   ├── mapping-step.tsx
│   ├── preview-step.tsx
│   └── progress-step.tsx
├── model/
│   ├── use-import-wizard.ts    # Wizard state machine
│   ├── wizard-context.tsx
│   └── types.ts
└── lib/
    ├── parse-import-file.ts
    └── validate-mappings.ts
```

## Widget Composition

Widgets can use features and entities:

```tsx
// widgets/translation-editor/ui/key-row.tsx
import { KeyRow as BaseKeyRow } from '@/entities/key';
import { AITranslateButton } from '@/features/ai-translate';
import { DeleteKeyButton } from '@/features/delete-key';

export function KeyRow({ keyData, languages }: Props) {
  return (
    <BaseKeyRow key={keyData}>
      {languages.map((lang) => (
        <TranslationCell key={lang} keyId={keyData.id} language={lang} />
      ))}
      <div className="flex gap-2">
        <AITranslateButton keyId={keyData.id} />
        <DeleteKeyButton keyId={keyData.id} />
      </div>
    </BaseKeyRow>
  );
}
```

## Best Practices

### DO

- Create widget when combining 2+ features
- Use context for shared state
- Keep sub-components in widget's ui/ folder
- Export only the main widget component

### DON'T

- Create widget for simple UI
- Put mutations directly in widget (use features/)
- Export internal components
- Make widgets depend on other widgets
