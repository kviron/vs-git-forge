# Component Patterns

Guidelines for organizing React components in Lingx using the Progressive FSD Hybrid approach.

## FSD vs \_components Decision

```
New component needed?
│
├─ Page-specific only → app/[route]/_components/
│
├─ Used 3+ places?
│   ├─ Business display → entities/ (see entities.md)
│   ├─ User action → features/ (see features.md)
│   └─ Complex state → widgets/ (see widgets.md)
│
└─ Generic UI primitive → shared/ui/
```

## Co-location Strategy

### Page-specific Components (\_components/)

Use `_components/` for components only used by one route:

```
app/(dashboard)/dashboard/
├── page.tsx                  # Main page
├── _components/              # Private to this route
│   ├── dashboard-hero.tsx
│   ├── recent-projects.tsx
│   ├── quick-actions.tsx
│   └── activity-feed.tsx
```

**Keep here when:**

- Used by this page only
- Unlikely to be reused
- Tightly coupled to page data

**Migrate when:**

- Used in 3+ routes → entities/ or features/
- Has mutations → features/
- Over 300 lines with complex state → widgets/

### FSD Layers

| Layer        | Purpose          | Example                            |
| ------------ | ---------------- | ---------------------------------- |
| `entities/`  | Business objects | ProjectCard, KeyRow, UserAvatar    |
| `features/`  | User actions     | AITranslateButton, DeleteKeyButton |
| `widgets/`   | Complex UI       | TranslationEditor, ImportWizard    |
| `shared/ui/` | UI primitives    | Button, Card, Input                |

See respective documentation files for detailed patterns.

## Component Types

### Page Component (Server Component)

Thin orchestration layer that composes FSD components:

```tsx
// app/(dashboard)/dashboard/page.tsx
import { Suspense } from 'react';
import { getDashboardStats, getProjects } from '@/shared/api';
import { ProjectCard } from '@/entities/project';
import { DashboardHero } from './_components/dashboard-hero';
import { ActivityFeed } from './_components/activity-feed';

export default async function DashboardPage() {
  const [stats, projects] = await Promise.all([getDashboardStats(), getProjects()]);

  return (
    <div className="space-y-8">
      <DashboardHero stats={stats} />

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <section className="island">
            <h2 className="text-muted-foreground mb-4 text-sm font-medium">Recent Projects</h2>
            {projects.slice(0, 3).map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </section>
        </div>

        <div className="lg:col-span-5">
          <Suspense fallback={<ActivitySkeleton />}>
            <ActivityFeed />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
```

**Characteristics:**

- Server Component (async function)
- Fetches data on server
- Composes entities, features, widgets
- Passes data via props
- Uses \_components/ for page-specific UI

### Presentational Component

Pure display with no side effects (keep in \_components/ or migrate to entities/):

```tsx
// app/(dashboard)/dashboard/_components/dashboard-hero.tsx
import type { DashboardStats } from '@lingx/shared';
import { Folder, Key, Languages, CheckCircle } from 'lucide-react';

interface DashboardHeroProps {
  stats: DashboardStats | undefined;
}

export function DashboardHero({ stats }: DashboardHeroProps) {
  return (
    <div className="island animate-fade-in-up p-6 lg:p-8">
      <h1 className="mb-6 text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Folder} label="Projects" value={stats?.totalProjects ?? 0} />
        <StatCard icon={Key} label="Keys" value={stats?.totalKeys ?? 0} />
        <StatCard icon={Languages} label="Languages" value={stats?.totalLanguages ?? 0} />
        <StatCard
          icon={CheckCircle}
          label="Complete"
          value={`${Math.round((stats?.completionRate ?? 0) * 100)}%`}
        />
      </div>
    </div>
  );
}

// Small helper - OK to keep in same file
function StatCard({ icon: Icon, label, value }: StatCardProps) {
  return (
    <div className="text-center">
      <Icon className="text-muted-foreground mx-auto mb-2 size-5" />
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-muted-foreground text-sm">{label}</p>
    </div>
  );
}
```

**Characteristics:**

- Receives data via props
- No data fetching or mutations
- Pure rendering logic
- Typically < 100 lines

## Props Patterns

### Required vs Optional

```tsx
interface ComponentProps {
  // Required
  id: string;

  // Optional with default
  variant?: 'default' | 'compact';

  // Optional, undefined allowed
  description?: string;

  // Callback
  onSelect?: (id: string) => void;
}

export function Component({ id, variant = 'default', description, onSelect }: ComponentProps) {
  // ...
}
```

### Action Slots (FSD Pattern)

Entities provide slots for feature actions:

```tsx
// entities/project/ui/project-card.tsx
interface ProjectCardProps {
  project: Project;
  actions?: React.ReactNode; // Slot for features
}

export function ProjectCard({ project, actions }: ProjectCardProps) {
  return (
    <Card>
      <h3>{project.name}</h3>
      <p className="text-muted-foreground">{project.slug}</p>
      {actions && <div onClick={(e) => e.preventDefault()}>{actions}</div>}
    </Card>
  );
}

// Usage in page - compose entity with features
import { ProjectCard } from '@/entities/project';
import { DeleteProjectButton } from '@/features/delete-project';
import { EditProjectButton } from '@/features/edit-project';

function ProjectsPage({ projects }) {
  return projects.map((project) => (
    <ProjectCard
      key={project.id}
      project={project}
      actions={
        <div className="flex gap-2">
          <EditProjectButton projectId={project.id} />
          <DeleteProjectButton projectId={project.id} />
        </div>
      }
    />
  ));
}
```

## File Naming

| Type           | Convention       | Example                                |
| -------------- | ---------------- | -------------------------------------- |
| Page component | `page.tsx`       | `dashboard/page.tsx`                   |
| Layout         | `layout.tsx`     | `dashboard/layout.tsx`                 |
| Co-located     | `kebab-case.tsx` | `_components/dashboard-hero.tsx`       |
| Entity/Feature | `kebab-case.tsx` | `entities/project/ui/project-card.tsx` |
| Shared UI      | `kebab-case.tsx` | `shared/ui/button.tsx`                 |

## Import Order

```tsx
// 1. React/Next.js
import { useState, useEffect } from 'react';
import Link from 'next/link';

// 2. External libraries
import { useQuery } from '@tanstack/react-query';

// 3. FSD layers (top to bottom)
import { ProjectCard } from '@/entities/project';
import { DeleteProjectButton } from '@/features/delete-project';
import { Button } from '@/shared/ui/button';

// 4. Co-located components
import { DashboardHero } from './_components/dashboard-hero';

// 5. Types
import type { DashboardStats } from '@lingx/shared';

// 6. Utilities
import { cn } from '@/shared/lib/utils';
```

## Migration Triggers

### → entities/

**When:** Business object display used in 3+ routes

```tsx
// BEFORE: Duplicated in multiple _components/ folders
// app/(dashboard)/dashboard/_components/project-card.tsx
// app/(project)/projects/_components/project-card.tsx

// AFTER: Single source in entities/
// entities/project/ui/project-card.tsx
export function ProjectCard({ project }: { project: Project }) { ... }
```

### → features/

**When:** User action with mutations

```tsx
// BEFORE: Mutation logic in _components/
// app/(project)/projects/[id]/_components/delete-button.tsx
function DeleteButton({ projectId }) {
  const { mutate } = useDeleteProject();  // Mutation = feature
  return <Button onClick={() => mutate(projectId)}>Delete</Button>;
}

// AFTER: Move to features/
// features/delete-project/ui/delete-button.tsx
export function DeleteProjectButton({ projectId }: Props) { ... }
```

### → widgets/

**When:** Complex UI with internal state and multiple features

```tsx
// BEFORE: Large component with many responsibilities
// app/workbench/_components/translation-editor.tsx (500+ lines)

// AFTER: Widget with structured internals
// widgets/translation-editor/
// ├── ui/translation-editor.tsx
// ├── model/use-realtime-sync.ts
// └── lib/conflict-resolver.ts
```

## Anti-patterns

### Don't fetch in presentational components

```tsx
// BAD - fetching in child
function DashboardHero() {
  const { data } = useDashboardStats(); // ❌
  return <div>{data?.totalProjects}</div>;
}

// GOOD - receive via props
function DashboardHero({ stats }: { stats: DashboardStats }) {
  return <div>{stats.totalProjects}</div>;
}
```

### Don't put mutations in entities

```tsx
// BAD - mutation in entity
// entities/project/ui/project-card.tsx
function ProjectCard({ project }) {
  const { mutate } = useDeleteProject(); // ❌ Belongs in features/
  return <Button onClick={() => mutate(project.id)}>Delete</Button>;
}

// GOOD - use action slots
function ProjectCard({ project, actions }) {
  return (
    <Card>
      <h3>{project.name}</h3>
      {actions} {/* ✅ Features passed via slot */}
    </Card>
  );
}
```

### Don't import from sibling layers

```tsx
// BAD - entity importing from another entity
// entities/project/ui/project-card.tsx
import { UserAvatar } from '@/entities/user'; // ❌

// GOOD - compose in higher layer
// features/project-view/ui/project-with-owner.tsx
import { ProjectCard } from '@/entities/project';
import { UserAvatar } from '@/entities/user'; // ✅
```

## Best Practices

### DO

- Start in `_components/`, migrate when needed
- Use action slots in entities for features
- Keep pages thin (compose FSD components)
- Follow strict layer imports

### DON'T

- Prematurely migrate to FSD
- Put mutations in entities
- Import between sibling slices
- Create widgets for simple components
