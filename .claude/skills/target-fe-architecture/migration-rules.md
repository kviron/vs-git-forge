# Migration Rules

When to migrate from `_components/` to FSD layers.

## Decision Flowchart

```
Is it page-specific?
│
├─ YES → Keep in _components/
│
└─ NO → Is it used in 3+ places?
         │
         ├─ YES → Does it have mutations?
         │        │
         │        ├─ YES → features/
         │        │
         │        └─ NO → Is it a business object?
         │                 │
         │                 ├─ YES → entities/
         │                 │
         │                 └─ NO → shared/
         │
         └─ NO → Is it complex with internal state?
                  │
                  ├─ YES → widgets/
                  │
                  └─ NO → Keep in _components/
```

## Migration Triggers

### → entities/

**Trigger:** Business object display used in 3+ routes

**Signs:**

- Same component copied to multiple `_components/` folders
- Displays business data (Project, Key, Translation, User)
- Pure presentation, no mutations

**Example Migration:**

```tsx
// BEFORE: app/(dashboard)/dashboard/_components/project-card.tsx
// BEFORE: app/(project)/projects/_components/project-card.tsx (duplicate)

// AFTER: entities/project/ui/project-card.tsx
export function ProjectCard({ project }: { project: Project }) {
  return (
    <Card>
      <h3>{project.name}</h3>
      <p>{project.slug}</p>
    </Card>
  );
}

// entities/project/index.ts
export { ProjectCard } from './ui/project-card';
```

### → features/

**Trigger:** User action with mutation/side effect

**Signs:**

- `useMutation` or API calls
- Loading/success/error states
- Confirmation dialogs
- Button that does something

**Example Migration:**

```tsx
// BEFORE: app/(project)/projects/[id]/_components/delete-button.tsx
const { mutate } = useDeleteProject();
// Scattered across multiple pages

// AFTER: features/delete-project/ui/delete-button.tsx
('use client');

import { Button } from '@/shared/ui/button';
import { useDeleteProject } from '../model/use-delete-project';
import { ConfirmDialog } from './confirm-dialog';

export function DeleteProjectButton({ projectId }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const { mutate, isPending } = useDeleteProject();

  return (
    <>
      <Button variant="destructive" onClick={() => setShowConfirm(true)}>
        Delete
      </Button>
      <ConfirmDialog open={showConfirm} onConfirm={() => mutate(projectId)} isPending={isPending} />
    </>
  );
}

// features/delete-project/index.ts
export { DeleteProjectButton } from './ui/delete-button';
```

### → widgets/

**Trigger:** Complex UI block with multiple features and shared state

**Signs:**

- Combines 2+ features
- Has internal state shared between sub-components
- Real-time updates
- Complex user interactions

**Example Migration:**

```tsx
// BEFORE: app/workbench/_components/translation-editor.tsx
// Large component (500+ lines) with:
// - Key list
// - Translation cells
// - Presence indicators
// - AI translate buttons
// - Bulk edit functionality

// AFTER: widgets/translation-editor/
widgets/translation-editor/
├── index.ts
├── ui/
│   ├── translation-editor.tsx    # Main composition
│   ├── presence-bar.tsx
│   ├── key-list.tsx
│   └── key-row.tsx
├── model/
│   ├── use-realtime-sync.ts      # WebSocket state
│   ├── use-presence.ts
│   └── editor-context.tsx        # Shared state
└── lib/
    └── conflict-resolver.ts
```

### → shared/

**Trigger:** Generic utility or UI primitive

**Signs:**

- No business logic
- Used across all layers
- Could be in a standalone library

**Example Migration:**

```tsx
// BEFORE: app/(dashboard)/_components/empty-state.tsx
// Generic empty state used everywhere

// AFTER: shared/ui/empty-state.tsx
interface EmptyStateProps {
  icon?: React.ComponentType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="py-12 text-center">
      {Icon && <Icon className="text-muted-foreground mx-auto size-12" />}
      <h3 className="mt-4 font-medium">{title}</h3>
      {description && <p className="text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

## Migration Checklist

### Before Migration

- [ ] Component is used in 3+ places (or will be)
- [ ] Clear category (entity/feature/widget/shared)
- [ ] No circular dependencies will be created
- [ ] Public API is well-defined

### During Migration

- [ ] Create slice directory structure
- [ ] Move component to `ui/`
- [ ] Extract hooks to `model/`
- [ ] Create `index.ts` with exports
- [ ] Update all imports

### After Migration

- [ ] Remove old `_components/` file
- [ ] Verify no duplicate code remains
- [ ] Test all routes using component
- [ ] Update any tests

## Anti-Patterns to Avoid

### ❌ Premature Migration

```
// DON'T migrate just because it might be reused
// Wait until actually used in 3+ places
```

### ❌ Wrong Layer

```tsx
// DON'T put mutations in entities
// entities/project/ui/project-card.tsx
const { mutate } = useDeleteProject(); // ❌ Should be in features/
```

### ❌ Sibling Imports

```tsx
// DON'T import between slices in same layer
// entities/project/ui/project-card.tsx
import { UserAvatar } from '@/entities/user'; // ❌
```

### ❌ Over-Engineering

```
// DON'T create all layers upfront
widgets/
features/
entities/
shared/

// DO create layers as needed
shared/       # Start with this
entities/     # When first entity extracted
features/     # When first feature extracted
widgets/      # When first widget needed
```

## Gradual Migration Path

### Phase 1: shared/

Always have from start:

- `shared/ui/` - shadcn components
- `shared/lib/` - utilities
- `shared/api/` - API client

### Phase 2: entities/

When business objects repeat:

- Project display components
- User avatars
- Key/Translation display

### Phase 3: features/

When mutations consolidate:

- Delete buttons
- Create forms
- AI actions

### Phase 4: widgets/

When complexity grows:

- Translation editor
- Import wizard
- Dashboard panels

## Import Update Script

After migration, update imports:

```bash
# Find old imports
grep -r "from './_components/project-card'" apps/web/src

# Replace with new
# OLD: import { ProjectCard } from './_components/project-card'
# NEW: import { ProjectCard } from '@/entities/project'
```
