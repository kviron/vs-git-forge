# Custom Hooks

Custom hooks extract data fetching and complex logic from components.

## Folder Structure

```
hooks/
├── use-dashboard-stats.ts    # Data fetching hook
├── use-projects.ts           # Data fetching hook
├── use-project-stats.ts      # Data fetching hook
├── use-mobile.ts             # Utility hook
└── index.ts                  # Barrel export
```

## Data Fetching Hooks

### Basic Pattern

```typescript
// hooks/use-projects.ts
import { useQuery } from '@tanstack/react-query';
import { projectApi } from '@/lib/api';
import type { Project } from '@lingx/shared';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => projectApi.list(),
  });
}

// Usage in component
function ProjectsPage() {
  const { data, isLoading, error } = useProjects();
  // ...
}
```

### With Parameters

```typescript
// hooks/use-project.ts
import { useQuery } from '@tanstack/react-query';
import { projectApi } from '@/lib/api';

export function useProject(id: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => projectApi.get(id),
    enabled: !!id,
  });
}
```

### With Options

```typescript
// hooks/use-translation-keys.ts
import { useQuery } from '@tanstack/react-query';
import { translationApi } from '@/lib/api';

interface UseTranslationKeysOptions {
  search?: string;
  page?: number;
  limit?: number;
}

export function useTranslationKeys(branchId: string, options: UseTranslationKeysOptions = {}) {
  return useQuery({
    queryKey: ['keys', branchId, options],
    queryFn: () => translationApi.listKeys(branchId, options),
    enabled: !!branchId,
  });
}
```

### With Computed Data

```typescript
// hooks/use-dashboard-stats.ts
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import type { DashboardStats } from '@lingx/shared';

export function useDashboardStats() {
  const query = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => dashboardApi.getStats(),
  });

  // Compute derived data
  const formattedStats = query.data
    ? {
        ...query.data,
        completionPercentage: `${Math.round(query.data.completionRate * 100)}%`,
      }
    : null;

  return {
    ...query,
    formattedStats,
  };
}
```

## Mutation Hooks

### Basic Mutation

```typescript
// hooks/use-create-project.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectApi } from '@/lib/api';
import type { CreateProjectInput } from '@lingx/shared';

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectInput) => projectApi.create(input),
    onSuccess: () => {
      // Invalidate projects list
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

// Usage
function CreateProjectForm() {
  const { mutate, isPending } = useCreateProject();

  const handleSubmit = (data: CreateProjectInput) => {
    mutate(data, {
      onSuccess: () => {
        toast.success('Project created');
      },
    });
  };
}
```

### With Optimistic Updates

```typescript
// hooks/use-update-translation.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { translationApi } from '@/lib/api';

export function useUpdateTranslation(branchId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ keyId, language, value }: UpdateTranslationInput) =>
      translationApi.setTranslation(keyId, language, value),

    onMutate: async ({ keyId, language, value }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['keys', branchId] });

      // Snapshot previous value
      const previous = queryClient.getQueryData(['keys', branchId]);

      // Optimistically update
      queryClient.setQueryData(['keys', branchId], (old: any) => ({
        ...old,
        keys: old.keys.map((key: any) =>
          key.id === keyId
            ? {
                ...key,
                translations: {
                  ...key.translations,
                  [language]: { value },
                },
              }
            : key
        ),
      }));

      return { previous };
    },

    onError: (err, variables, context) => {
      // Rollback on error
      queryClient.setQueryData(['keys', branchId], context?.previous);
    },
  });
}
```

## Effect Event Hooks (React 19.2)

### useEffectEvent for External Callbacks

Use `useEffectEvent` when you have callbacks triggered by external systems that shouldn't cause Effect re-runs:

```typescript
// hooks/use-websocket.ts
import { useEffect, useEffectEvent } from 'react';

export function useWebSocket(roomId: string, theme: string) {
  // Effect Event - always sees latest props/state
  // Don't add to dependency array!
  const onMessage = useEffectEvent((message: Message) => {
    showNotification(message.text, theme); // Uses current theme
  });

  useEffect(() => {
    const ws = createWebSocket(roomId);

    ws.on('message', onMessage);

    return () => ws.disconnect();
  }, [roomId]); // ✅ Only roomId - no re-run on theme change
}
```

**Key Rules:**

- Effect Events see latest props/state automatically
- Do NOT add Effect Events to dependency arrays
- Only for "event-like" callbacks from external systems
- Requires `eslint-plugin-react-hooks@latest`

### When to Use useEffectEvent

```typescript
// ✅ GOOD - External system callback
const onConnected = useEffectEvent(() => {
  logAnalytics('connected', { theme, userId });
});

useEffect(() => {
  socket.on('connected', onConnected);
}, []);

// ❌ BAD - Regular event handler (just use normal function)
const onClick = useEffectEvent(() => {});
<button onClick={onClick} />
```

## Logic Hooks

### Complex State Logic

```typescript
// hooks/use-translation-filter.ts
import { useState, useMemo } from 'react';
import type { TranslationKey, ProjectLanguage } from '@lingx/shared';

type FilterType = 'all' | 'missing' | 'complete';

export function useTranslationFilter(keys: TranslationKey[], languages: ProjectLanguage[]) {
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');

  const filteredKeys = useMemo(() => {
    let result = keys;

    // Apply search
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter((key) => key.name.toLowerCase().includes(searchLower));
    }

    // Apply filter
    if (filter === 'missing') {
      result = result.filter((key) => {
        return languages.some((lang) => !key.translations[lang.code]?.value);
      });
    } else if (filter === 'complete') {
      result = result.filter((key) => {
        return languages.every((lang) => key.translations[lang.code]?.value);
      });
    }

    return result;
  }, [keys, languages, filter, search]);

  return {
    filter,
    setFilter,
    search,
    setSearch,
    filteredKeys,
    totalCount: keys.length,
    filteredCount: filteredKeys.length,
  };
}
```

### Auto-save Logic

```typescript
// hooks/use-auto-save.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';

interface UseAutoSaveOptions<T> {
  saveFn: (value: T) => Promise<void>;
  debounceMs?: number;
}

export function useAutoSave<T>({ saveFn, debounceMs = 1000 }: UseAutoSaveOptions<T>) {
  const [pendingValue, setPendingValue] = useState<T | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();

  const mutation = useMutation({
    mutationFn: saveFn,
    onSuccess: () => {
      setLastSaved(new Date());
    },
  });

  const save = useCallback(
    (value: T) => {
      // Clear existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      setPendingValue(value);

      // Set new timeout
      timeoutRef.current = setTimeout(async () => {
        setIsSaving(true);
        await mutation.mutateAsync(value);
        setIsSaving(false);
        setPendingValue(null);
      }, debounceMs);
    },
    [debounceMs, mutation]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    save,
    isSaving,
    hasPending: pendingValue !== null,
    lastSaved,
    error: mutation.error,
  };
}
```

## Naming Conventions

| Type                   | Prefix                | Example                  |
| ---------------------- | --------------------- | ------------------------ |
| Data fetching (single) | `use{Entity}`         | `useProject(id)`         |
| Data fetching (list)   | `use{Entities}`       | `useProjects()`          |
| Data fetching (stats)  | `use{Entity}Stats`    | `useProjectStats(id)`    |
| Mutation               | `use{Action}{Entity}` | `useCreateProject()`     |
| Logic                  | `use{Purpose}`        | `useTranslationFilter()` |
| Utility                | `use{Utility}`        | `useDebounce()`          |

## Barrel Export

```typescript
// hooks/index.ts
export * from './use-dashboard-stats';
export * from './use-projects';
export * from './use-project';
export * from './use-project-stats';
export * from './use-translation-keys';
export * from './use-mobile';
```

## Best Practices

### 1. One hook per file

```
hooks/
├── use-projects.ts       # useProjects()
├── use-project.ts        # useProject(id)
└── use-create-project.ts # useCreateProject()
```

### 2. Always export types

```typescript
export interface UseProjectsResult {
  projects: Project[];
  isLoading: boolean;
  error: Error | null;
}

export function useProjects(): UseProjectsResult {
  // ...
}
```

### 3. Handle loading and error states

```typescript
export function useProject(id: string) {
  const query = useQuery({...});

  return {
    project: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
```

### 4. Use shared types

```typescript
import type { Project, DashboardStats } from '@lingx/shared';

export function useProjects(): { projects: Project[] | undefined } {
  // ...
}
```
