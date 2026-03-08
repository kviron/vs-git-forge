# Entities

Business objects with display logic only. No mutations or side effects.

## When to Create Entity

- Business data display (Project, Key, User)
- Used in 3+ different places
- Pure presentation (receives data via props)
- Formats/transforms data for display

## Entity Structure

```
entities/entity-name/
├── index.ts              # Public API
├── ui/
│   ├── entity-card.tsx         # Card display
│   ├── entity-list-item.tsx    # List item
│   └── entity-badge.tsx        # Small indicator
├── model/
│   └── types.ts                # TypeScript types
└── lib/
    └── format-entity.ts        # Formatting utilities
```

## Project Entity

```
entities/project/
├── index.ts
├── ui/
│   ├── project-card.tsx
│   ├── project-list-item.tsx
│   ├── project-header.tsx
│   └── project-badge.tsx
├── model/
│   └── types.ts
└── lib/
    └── format-project.ts
```

### Card Component

```tsx
// entities/project/ui/project-card.tsx
import Link from 'next/link';
import { Folder, Languages } from 'lucide-react';
import type { Project } from '@lingx/shared';
import { Card } from '@/shared/ui/card';
import { formatProjectProgress } from '../lib/format-project';

interface ProjectCardProps {
  project: Project;
  actions?: React.ReactNode; // Slot for features
}

export function ProjectCard({ project, actions }: ProjectCardProps) {
  const progress = formatProjectProgress(project);

  return (
    <Card className="p-4 transition-shadow hover:shadow-md">
      <Link href={`/projects/${project.id}`} className="block">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 rounded-lg p-2">
              <Folder className="text-primary size-5" />
            </div>
            <div>
              <h3 className="font-medium">{project.name}</h3>
              <p className="text-muted-foreground text-sm">{project.slug}</p>
            </div>
          </div>
          {actions && <div onClick={(e) => e.preventDefault()}>{actions}</div>}
        </div>

        <div className="text-muted-foreground mt-4 flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1">
            <Languages className="size-4" />
            {project.languages?.length ?? 0} languages
          </span>
          <span>{progress}% complete</span>
        </div>
      </Link>
    </Card>
  );
}
```

### List Item Component

```tsx
// entities/project/ui/project-list-item.tsx
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { Project } from '@lingx/shared';

interface ProjectListItemProps {
  project: Project;
}

export function ProjectListItem({ project }: ProjectListItemProps) {
  return (
    <Link
      href={`/projects/${project.id}`}
      className="hover:bg-accent/50 flex items-center justify-between p-4 transition-colors"
    >
      <div className="min-w-0">
        <p className="truncate font-medium">{project.name}</p>
        <p className="text-muted-foreground truncate text-sm">
          {project.description || project.slug}
        </p>
      </div>
      <ChevronRight className="text-muted-foreground size-5 flex-shrink-0" />
    </Link>
  );
}
```

### Header Component

```tsx
// entities/project/ui/project-header.tsx
import type { Project } from '@lingx/shared';
import { Badge } from '@/shared/ui/badge';

interface ProjectHeaderProps {
  project: Project;
  actions?: React.ReactNode;
}

export function ProjectHeader({ project, actions }: ProjectHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <div className="mt-1 flex items-center gap-2">
          <Badge variant="secondary">{project.sourceLanguage}</Badge>
          <span className="text-muted-foreground">→</span>
          {project.languages?.map((lang) => (
            <Badge key={lang.code} variant="outline">
              {lang.code}
            </Badge>
          ))}
        </div>
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
```

### Formatting Utilities

```typescript
// entities/project/lib/format-project.ts
import type { Project } from '@lingx/shared';

export function formatProjectProgress(project: Project): number {
  if (!project.stats) return 0;

  const { totalKeys, completedTranslations, totalLanguages } = project.stats;
  const totalTranslations = totalKeys * totalLanguages;

  if (totalTranslations === 0) return 0;
  return Math.round((completedTranslations / totalTranslations) * 100);
}

export function formatProjectDate(project: Project): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(project.createdAt));
}
```

### Public API

```typescript
// entities/project/index.ts
export { ProjectCard } from './ui/project-card';
export { ProjectListItem } from './ui/project-list-item';
export { ProjectHeader } from './ui/project-header';
export { ProjectBadge } from './ui/project-badge';
export { formatProjectProgress, formatProjectDate } from './lib/format-project';
```

## Key Entity

```
entities/key/
├── index.ts
├── ui/
│   ├── key-row.tsx
│   ├── key-badge.tsx
│   └── key-info.tsx
├── model/
│   └── types.ts
└── lib/
    └── format-key.ts
```

```tsx
// entities/key/ui/key-row.tsx
import { Key as KeyIcon } from 'lucide-react';
import type { TranslationKey } from '@lingx/shared';
import { Badge } from '@/shared/ui/badge';

interface KeyRowProps {
  keyData: TranslationKey;
  children?: React.ReactNode; // For translation cells
  actions?: React.ReactNode; // For feature buttons
}

export function KeyRow({ keyData, children, actions }: KeyRowProps) {
  return (
    <div className="flex items-center gap-4 border-b p-3">
      <div className="w-64 flex-shrink-0">
        <div className="flex items-center gap-2">
          <KeyIcon className="text-muted-foreground size-4" />
          <span className="truncate font-mono text-sm">{keyData.name}</span>
        </div>
        {keyData.namespace && (
          <Badge variant="outline" className="mt-1">
            {keyData.namespace}
          </Badge>
        )}
      </div>

      <div className="flex flex-1 items-center gap-2">{children}</div>

      {actions && <div className="flex-shrink-0">{actions}</div>}
    </div>
  );
}
```

## User Entity

```
entities/user/
├── index.ts
├── ui/
│   ├── user-avatar.tsx
│   ├── user-name.tsx
│   └── user-badge.tsx
└── model/
    └── types.ts
```

```tsx
// entities/user/ui/user-avatar.tsx
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/ui/avatar';
import type { User } from '@lingx/shared';

interface UserAvatarProps {
  user: User;
  size?: 'sm' | 'md' | 'lg';
  showName?: boolean;
}

const sizeClasses = {
  sm: 'size-6',
  md: 'size-8',
  lg: 'size-10',
};

export function UserAvatar({ user, size = 'md', showName }: UserAvatarProps) {
  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  return (
    <div className="flex items-center gap-2">
      <Avatar className={sizeClasses[size]}>
        <AvatarImage src={user.avatarUrl} alt={user.name} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      {showName && <span className="text-sm">{user.name}</span>}
    </div>
  );
}
```

## Translation Entity

```
entities/translation/
├── index.ts
├── ui/
│   ├── translation-cell.tsx
│   ├── translation-preview.tsx
│   └── translation-status.tsx
└── lib/
    └── format-translation.ts
```

```tsx
// entities/translation/ui/translation-status.tsx
import { CheckCircle, Circle, AlertCircle } from 'lucide-react';
import type { Translation } from '@lingx/shared';

interface TranslationStatusProps {
  translation: Translation | null;
}

export function TranslationStatus({ translation }: TranslationStatusProps) {
  if (!translation || !translation.value) {
    return <Circle className="text-muted-foreground size-4" />;
  }

  if (translation.isOutdated) {
    return <AlertCircle className="text-warning size-4" />;
  }

  return <CheckCircle className="text-success size-4" />;
}
```

## Composition with Features

Entities provide slots for feature actions:

```tsx
// In a page or widget
import { ProjectCard } from '@/entities/project';
import { DeleteProjectButton } from '@/features/delete-project';
import { EditProjectButton } from '@/features/edit-project';

function ProjectsPage({ projects }) {
  return (
    <div className="grid gap-4">
      {projects.map((project) => (
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
      ))}
    </div>
  );
}
```

## Best Practices

### DO

- Accept data via props only
- Provide slots for actions (render props or children)
- Export formatting utilities
- Keep components pure (no side effects)

### DON'T

- Use mutations or API calls
- Import from other entities
- Import from features or widgets
- Store state beyond UI state (hover, focus)
