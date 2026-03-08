# FSD Overview

Feature-Sliced Design (FSD) organizes code by business domain with strict layer dependencies.

## Layers

### app/ (Pages Layer)

Next.js App Router pages. Thin orchestration layer.

**Responsibilities:**

- Compose widgets and features
- Fetch data on server (RSC)
- Handle routing and layouts
- Pass data down via props

**Can import:** widgets, features, entities, shared

```tsx
// app/(project)/projects/[id]/page.tsx
import { ProjectHeader } from '@/entities/project';
import { TranslationEditor } from '@/widgets/translation-editor';

export default async function ProjectPage({ params }) {
  const project = await getProject(params.id);

  return (
    <>
      <ProjectHeader project={project} />
      <TranslationEditor projectId={project.id} />
    </>
  );
}
```

### widgets/

Complex UI blocks combining multiple features with internal state.

**Responsibilities:**

- Combine multiple features into cohesive blocks
- Manage complex internal state
- Coordinate between features
- Handle real-time updates

**Can import:** features, entities, shared

**Examples:**

- `translation-editor/` - Real-time collaborative editor
- `key-detail-panel/` - Key info with actions
- `import-wizard/` - Multi-step import flow

```
widgets/translation-editor/
├── index.ts              # Public API
├── ui/
│   ├── translation-editor.tsx
│   ├── presence-bar.tsx
│   └── key-list.tsx
├── model/
│   ├── use-realtime-sync.ts
│   └── use-presence.ts
└── lib/
    └── conflict-resolver.ts
```

### features/

User actions with side effects.

**Responsibilities:**

- Handle user interactions
- Execute mutations (create, update, delete)
- Show confirmation dialogs
- Display loading/success/error states

**Can import:** entities, shared

**Examples:**

- `ai-translate/` - AI translation button
- `delete-key/` - Delete with confirmation
- `bulk-edit/` - Batch translation updates
- `export-translations/` - Export modal

```
features/ai-translate/
├── index.ts              # Public API
├── ui/
│   ├── ai-translate-button.tsx
│   └── ai-translate-modal.tsx
├── model/
│   └── use-ai-translate.ts
└── api/
    └── ai-translate.ts
```

### entities/

Business objects with display logic only.

**Responsibilities:**

- Display business data
- Format/transform for display
- Provide type definitions
- Pure presentation (no mutations)

**Can import:** shared

**Examples:**

- `project/` - ProjectCard, ProjectListItem
- `key/` - KeyRow, KeyBadge
- `translation/` - TranslationCell, TranslationPreview
- `user/` - UserAvatar, UserName

```
entities/project/
├── index.ts              # Public API
├── ui/
│   ├── project-card.tsx
│   └── project-list-item.tsx
├── model/
│   └── types.ts
└── lib/
    └── format-project.ts
```

### shared/

Reusable code with no business logic.

**Responsibilities:**

- UI primitives (shadcn/ui)
- API client and React Query setup
- Utility functions
- Shared hooks
- Constants and types

**Can import:** nothing (leaf layer)

```
shared/
├── ui/                   # shadcn/ui components
│   ├── button.tsx
│   ├── input.tsx
│   └── card.tsx
├── api/
│   ├── client.ts         # API client setup
│   └── hooks/            # React Query hooks
├── lib/
│   ├── utils.ts          # cn(), formatters
│   └── constants.ts
└── hooks/
    ├── use-debounce.ts
    └── use-mobile.ts
```

## Slice Structure

Each slice within a layer follows consistent structure:

```
slice-name/
├── index.ts              # Public API (re-exports)
├── ui/                   # React components
├── model/                # State, hooks, logic
├── api/                  # API calls (if needed)
└── lib/                  # Utilities (if needed)
```

### Public API (index.ts)

Only export what's needed externally:

```typescript
// entities/project/index.ts
export { ProjectCard } from './ui/project-card';
export { ProjectListItem } from './ui/project-list-item';
export type { Project } from './model/types';
```

### Segments

| Segment  | Purpose                      |
| -------- | ---------------------------- |
| `ui/`    | React components (TSX)       |
| `model/` | State, hooks, business logic |
| `api/`   | API calls and types          |
| `lib/`   | Utilities, helpers           |

## Import Rules

### Strict Hierarchy

```
app     → widgets, features, entities, shared
widgets → features, entities, shared
features → entities, shared
entities → shared
shared  → (nothing)
```

### Within Same Layer

Slices cannot import from sibling slices:

```tsx
// ❌ BAD - entity importing from another entity
// entities/project/ui/project-card.tsx
import { UserAvatar } from '@/entities/user'; // ❌

// ✅ GOOD - both import from shared, compose in feature/widget
// features/project-view/ui/project-with-owner.tsx
import { ProjectCard } from '@/entities/project';
import { UserAvatar } from '@/entities/user';
```

### Cross-Slice Composition

Compose entities in features or widgets:

```tsx
// widgets/project-dashboard/ui/project-dashboard.tsx
import { ProjectCard } from '@/entities/project';
import { UserAvatar } from '@/entities/user';
import { DeleteProjectButton } from '@/features/delete-project';

export function ProjectDashboard({ project, owner }) {
  return (
    <div>
      <ProjectCard project={project} />
      <UserAvatar user={owner} />
      <DeleteProjectButton projectId={project.id} />
    </div>
  );
}
```

## Naming Conventions

### Directories

```
kebab-case/
├── kebab-case.tsx        # Component file
├── use-kebab-case.ts     # Hook file
└── types.ts              # Types file
```

### Exports

```typescript
// PascalCase for components
export { ProjectCard } from './project-card';

// camelCase for hooks
export { useProjectStats } from './use-project-stats';

// PascalCase for types
export type { Project } from './types';
```

## When to Create Each Layer

| Layer     | Create When                             |
| --------- | --------------------------------------- |
| widgets/  | Combining 2+ features with shared state |
| features/ | Adding user action with mutation        |
| entities/ | Business object used in 3+ places       |
| shared/   | Generic utility/component               |

## FSD vs App Router Co-location

Keep page-specific code in `_components/`:

```
app/(dashboard)/dashboard/
├── page.tsx
└── _components/          # Page-specific only
    ├── stats-card.tsx
    └── activity-feed.tsx
```

Move to FSD when:

- Used in multiple routes
- Has mutations → features/
- Business object display → entities/
- Complex state → widgets/

## Best Practices

### DO

- Export only public API from index.ts
- Keep slices independent (no sibling imports)
- Start in \_components/, migrate when needed
- Use shared/ for generic code only

### DON'T

- Import from sibling slices
- Put mutations in entities
- Create widgets for simple components
- Over-engineer with too many layers early
