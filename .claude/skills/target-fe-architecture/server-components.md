# React Server Components

Server Components render on the server, shipping zero JavaScript to the client.

## Mental Model

```
┌─────────────────────────────────────────────────────────┐
│  Server (Node.js)                                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Server Components                               │   │
│  │  - async/await                                   │   │
│  │  - Direct database access                        │   │
│  │  - No hooks, no state                            │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────────┬────────────────────────────────┘
                         │ serialized props
┌────────────────────────▼────────────────────────────────┐
│  Browser                                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Client Components                               │   │
│  │  - useState, useEffect                           │   │
│  │  - Event handlers                                │   │
│  │  - Browser APIs                                  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Server Component Patterns

### Async Data Fetching

```tsx
// app/(dashboard)/projects/page.tsx
import { prisma } from '@/lib/prisma';
import { ProjectList } from './_components/project-list';

export default async function ProjectsPage() {
  // Direct database access - no API route needed
  const projects = await prisma.project.findMany({
    include: { languages: true },
    orderBy: { createdAt: 'desc' },
  });

  return <ProjectList projects={projects} />;
}
```

### Parallel Data Fetching

```tsx
export default async function DashboardPage() {
  // Fetch in parallel for better performance
  const [projects, stats, activity] = await Promise.all([
    getProjects(),
    getStats(),
    getRecentActivity(),
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

export default function DashboardPage() {
  return (
    <div>
      {/* Immediate */}
      <Header />

      {/* Streams when ready */}
      <Suspense fallback={<ProjectsSkeleton />}>
        <ProjectsSection />
      </Suspense>

      <Suspense fallback={<ActivitySkeleton />}>
        <ActivitySection />
      </Suspense>
    </div>
  );
}

// Each section is its own Server Component
async function ProjectsSection() {
  const projects = await getProjects();
  return <ProjectList projects={projects} />;
}
```

## Client Boundary Rules

### The 'use client' Directive

When you add `'use client'`, that component AND all its children become Client Components:

```tsx
// This entire tree is client-rendered
'use client';

export function Form() {
  return (
    <div>
      <Input /> {/* Client */}
      <Button /> {/* Client */}
      <Validation /> {/* Client */}
    </div>
  );
}
```

### Passing Server Components as Children

Server Components can be passed as children to Client Components:

```tsx
// page.tsx (Server)
export default function Page() {
  return (
    <ClientWrapper>
      {/* This stays a Server Component! */}
      <ServerContent />
    </ClientWrapper>
  );
}

// _components/client-wrapper.tsx
('use client');

export function ClientWrapper({ children }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button onClick={() => setOpen(!open)}>Toggle</button>
      {open && children}
    </div>
  );
}
```

## What Can't Server Components Do?

| Feature             | Server | Client |
| ------------------- | ------ | ------ |
| async/await         | ✅     | ❌     |
| Database access     | ✅     | ❌     |
| useState, useEffect | ❌     | ✅     |
| Event handlers      | ❌     | ✅     |
| Browser APIs        | ❌     | ✅     |
| Context providers   | ❌     | ✅     |

## Common Patterns

### Layout with Auth Check

```tsx
// app/(dashboard)/layout.tsx
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    redirect('/login');
  }

  return (
    <div className="flex">
      <Sidebar user={session.user} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

### Loading States

```tsx
// app/(dashboard)/projects/loading.tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function ProjectsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    </div>
  );
}
```

### Error Handling

```tsx
// app/(dashboard)/projects/error.tsx
'use client';

export default function ProjectsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-8 text-center">
      <h2>Something went wrong!</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

## Activity Component (React 19.2)

Use `<Activity>` to preserve state when hiding content:

```tsx
import { Activity } from 'react';

function TabPanel({ activeTab }) {
  return (
    <div>
      {/* Pre-render tabs, preserve state when hidden */}
      <Activity mode={activeTab === 'settings' ? 'visible' : 'hidden'}>
        <SettingsPanel />
      </Activity>

      <Activity mode={activeTab === 'profile' ? 'visible' : 'hidden'}>
        <ProfilePanel />
      </Activity>
    </div>
  );
}
```

**Modes:**

- `visible` - Shows children, runs effects normally
- `hidden` - Hides children, unmounts effects, defers updates

**Use Cases:**

- Preserve form state during tab navigation
- Pre-render content likely to be navigated to
- Faster back/forward navigation

```tsx
// ❌ Old pattern - loses state
{
  activeTab === 'settings' && <SettingsPanel />;
}

// ✅ New pattern - preserves state
<Activity mode={activeTab === 'settings' ? 'visible' : 'hidden'}>
  <SettingsPanel />
</Activity>;
```

## Best Practices

### DO

- Default to Server Components
- Fetch data at the top (page/layout)
- Use Suspense for streaming
- Pass data down as props
- Keep client boundaries small
- Use `<Activity>` for state preservation

### DON'T

- Add 'use client' to pages
- Fetch in useEffect for initial data
- Create large client component trees
- Mix data fetching patterns unnecessarily
- Use conditional rendering when state matters

## Performance Benefits

1. **Zero JS** - Server Components ship no JavaScript
2. **Smaller bundles** - Only client components in bundle
3. **Direct data access** - No API roundtrip
4. **Streaming** - Progressive page rendering
5. **Caching** - Request deduplication
6. **State preservation** - Activity component maintains UI state

Sources:

- [React Server Components](https://www.patterns.dev/react/react-server-components/)
- [Josh Comeau's RSC Guide](https://www.joshwcomeau.com/react/server-components/)
- [React 19.2](https://react.dev/blog/2025/10/01/react-19-2)
