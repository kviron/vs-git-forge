# Data Fetching Patterns

Hybrid approach: Server Components for initial data, React Query for mutations and real-time updates.

## Decision Tree

```
When to use which approach?

Initial page data?
  └─ Server Component (async function)

User-triggered updates (forms, mutations)?
  └─ React Query useMutation

Real-time data or polling?
  └─ React Query useQuery with refetchInterval

Infinite scroll or pagination?
  └─ React Query useInfiniteQuery
```

## Server Component Fetching

### Direct Database Access

```tsx
// app/(dashboard)/projects/page.tsx
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { ProjectList } from './_components/project-list';

export default async function ProjectsPage() {
  const session = await getSession();

  // Direct database query - no API needed
  const projects = await prisma.project.findMany({
    where: {
      members: { some: { userId: session.userId } },
    },
    include: { languages: true },
    orderBy: { createdAt: 'desc' },
  });

  return <ProjectList projects={projects} />;
}
```

### Parallel Fetching

```tsx
export default async function DashboardPage() {
  const session = await getSession();

  // Parallel fetch for better performance
  const [projects, stats, activity] = await Promise.all([
    prisma.project.findMany({ where: { ownerId: session.userId } }),
    getStats(session.userId),
    getRecentActivity(session.userId),
  ]);

  return (
    <div>
      <StatsCards stats={stats} />
      <ProjectGrid projects={projects} />
      <ActivityFeed activity={activity} />
    </div>
  );
}
```

### Streaming with Suspense

```tsx
import { Suspense } from 'react';
import { ProjectsSkeleton, ActivitySkeleton } from '@/components/skeletons';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1>Dashboard</h1>

      {/* Each section streams independently */}
      <Suspense fallback={<ProjectsSkeleton />}>
        <ProjectsSection />
      </Suspense>

      <Suspense fallback={<ActivitySkeleton />}>
        <ActivitySection />
      </Suspense>
    </div>
  );
}

async function ProjectsSection() {
  const projects = await getProjects();
  return <ProjectGrid projects={projects} />;
}

async function ActivitySection() {
  const activity = await getRecentActivity();
  return <ActivityFeed activity={activity} />;
}
```

## Passing Server Data to Client

### Initial Data Pattern

```tsx
// page.tsx (Server)
import { getProject } from '@/lib/api/projects';
import { ProjectEditor } from './_components/project-editor';

export default async function EditProjectPage({ params }) {
  const project = await getProject(params.id);

  // Pass server data as initialData
  return <ProjectEditor initialData={project} />;
}

// _components/project-editor.tsx (Client)
('use client');

import { useQuery } from '@tanstack/react-query';
import { projectApi } from '@/lib/api';

interface ProjectEditorProps {
  initialData: Project;
}

export function ProjectEditor({ initialData }: ProjectEditorProps) {
  // Use initialData for instant render, React Query for updates
  const { data: project } = useQuery({
    queryKey: ['project', initialData.id],
    queryFn: () => projectApi.get(initialData.id),
    initialData, // Prevents loading state
    staleTime: 60 * 1000, // Consider fresh for 1 minute
  });

  return <Form defaultValues={project} />;
}
```

## React Query Configuration

```tsx
// components/providers.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

## Custom Query Hooks

### Basic Query

```tsx
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

### With Filters

```tsx
// hooks/use-keys.ts
export function useKeys(branchId: string, filters: KeyFilters) {
  return useQuery({
    queryKey: ['keys', branchId, filters],
    queryFn: () => keyApi.list(branchId, filters),
    enabled: !!branchId,
  });
}
```

## Mutation Patterns

### Basic Mutation

```tsx
// hooks/use-create-project.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectApi } from '@/lib/api';

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: projectApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
```

### With Callbacks

```tsx
// In component
const { mutate, isPending } = useCreateProject();

const handleSubmit = (data: FormData) => {
  mutate(data, {
    onSuccess: (project) => {
      toast.success('Project created');
      router.push(`/projects/${project.id}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
};
```

### Optimistic Updates

```tsx
export function useUpdateTranslation(branchId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: translationApi.update,

    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: ['keys', branchId] });

      const previous = queryClient.getQueryData(['keys', branchId]);

      // Optimistic update
      queryClient.setQueryData(['keys', branchId], (old: Keys) => ({
        ...old,
        items: old.items.map((item) =>
          item.id === newData.keyId ? { ...item, translation: newData.value } : item
        ),
      }));

      return { previous };
    },

    onError: (err, newData, context) => {
      // Rollback on error
      queryClient.setQueryData(['keys', branchId], context?.previous);
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['keys', branchId] });
    },
  });
}
```

## Query Keys Convention

```typescript
// Hierarchical structure
['projects'][('project', projectId)][('project', projectId, 'stats')][ // List // Single // Nested
  // With filters
  ('keys', branchId, { search, page })
][ // Filtered list
  // Aggregates
  'dashboard-stats'
];
```

## Loading & Error States

### Component Pattern

```tsx
function ProjectList({ projects }: { projects: Project[] }) {
  // projects always available (from server)

  const { mutate, isPending } = useDeleteProject();

  return (
    <div>
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onDelete={() => mutate(project.id)}
          isDeleting={isPending}
        />
      ))}
    </div>
  );
}
```

### Skeleton for Streaming

```tsx
// app/(dashboard)/projects/loading.tsx
export default function ProjectsLoading() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="island animate-pulse p-4">
          <div className="bg-muted h-5 w-1/3 rounded" />
          <div className="bg-muted mt-2 h-4 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}
```

## API Layer

```typescript
// lib/api.ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(response.status, error.message);
  }

  return response.json();
}

export const projectApi = {
  list: () => fetchApi<Project[]>('/api/projects'),
  get: (id: string) => fetchApi<Project>(`/api/projects/${id}`),
  create: (data: CreateProjectInput) =>
    fetchApi<Project>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateProjectInput) =>
    fetchApi<Project>(`/api/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => fetchApi<void>(`/api/projects/${id}`, { method: 'DELETE' }),
};
```

## Best Practices

### DO

- Fetch initial data in Server Components
- Use React Query for mutations
- Pass server data as `initialData` to queries
- Keep query keys consistent
- Handle loading/error states

### DON'T

- Fetch in useEffect for initial page data
- Duplicate data fetching (server + client)
- Skip loading states for mutations
- Use React Query for static content

Sources:

- [TanStack Query with Server Components](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)
- [Next.js Data Fetching](https://nextjs.org/docs/app/building-your-application/data-fetching)
