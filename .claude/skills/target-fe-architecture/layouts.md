# Layout Patterns

Lingx uses Next.js route groups to scope layouts to different parts of the application.

## Route Groups Overview

```
app/
├── (auth)/           # Authentication scope
│   └── layout.tsx    # Split panel: branding + form
├── (dashboard)/      # User workspace scope
│   └── layout.tsx    # AppSidebar + main content
├── (project)/        # Project scope
│   └── layout.tsx    # ProjectSidebar + main content
└── workbench/        # Full-screen editor (no group)
    └── layout.tsx    # Minimal: just container
```

## Auth Layout

Split panel design with animated branding.

```tsx
// app/(auth)/layout.tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left: Branding panel */}
      <div className="bg-primary/5 hidden flex-col p-12 lg:flex">
        <Logo />
        <div className="flex flex-1 items-center">
          <HeroContent />
        </div>
        <FeatureHighlights />
      </div>

      {/* Right: Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
```

## Dashboard Layout

Sidebar-based layout for user workspace.

```tsx
// app/(dashboard)/layout.tsx
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/app-sidebar';
import { DashboardHeader } from '@/components/dashboard-header';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        {/* Mobile header - visible on small screens */}
        <header className="flex h-14 items-center gap-4 border-b px-4 lg:hidden">
          <SidebarTrigger />
          <span className="font-semibold">Lingx</span>
        </header>

        {/* Desktop toolbar - visible on large screens */}
        <div className="hidden h-14 items-center gap-4 border-b px-6 lg:flex">
          <DashboardHeader />
        </div>

        {/* Main content */}
        <main className="flex-1 p-6">
          <div className="animate-fade-in-up">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

## Project Layout

Similar to dashboard but with project-specific sidebar.

```tsx
// app/(project)/projects/[projectId]/layout.tsx
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import { ProjectSidebar } from '@/components/project-sidebar';

interface Props {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}

export default async function ProjectLayout({ children, params }: Props) {
  const { projectId } = await params;

  return (
    <SidebarProvider>
      <ProjectSidebar projectId={projectId} />
      <SidebarInset>
        <header className="flex h-14 items-center gap-4 border-b px-4 lg:hidden">
          <SidebarTrigger />
        </header>

        <main className="flex-1 p-6">
          <div className="animate-fade-in-up">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

## Nested Settings Layout

Project settings has an additional nested layout with sidebar navigation.

```tsx
// app/(project)/projects/[projectId]/settings/layout.tsx
import Link from 'next/link';
import { cn } from '@/lib/utils';

const settingsNav = [
  { href: '', label: 'General', icon: Settings },
  { href: '/glossary', label: 'Glossary', icon: BookOpen },
  { href: '/ai-translation', label: 'AI Translation', icon: Bot },
  { href: '/integrations', label: 'Integrations', icon: Plug },
];

interface Props {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}

export default async function SettingsLayout({ children, params }: Props) {
  const { projectId } = await params;
  const basePath = `/projects/${projectId}/settings`;

  return (
    <div className="flex gap-8">
      {/* Settings sidebar */}
      <nav className="sticky top-6 w-64 shrink-0 self-start">
        <div className="space-y-1">
          {settingsNav.map((item) => (
            <Link
              key={item.href}
              href={`${basePath}${item.href}`}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2',
                'text-muted-foreground hover:bg-accent'
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* Settings content */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
```

## Workbench Layout

Minimal layout for full-screen translation editor.

```tsx
// app/workbench/layout.tsx
export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-background h-screen overflow-hidden">{children}</div>;
}
```

## Root Layout

Provider setup at the root.

```tsx
// app/layout.tsx
import { Providers } from '@/components/providers';
import { Toaster } from '@/components/ui/sonner';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
```

## Layout Patterns

### Passing Params to Layout

```tsx
// Next.js 15+: params is a Promise
interface Props {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}

export default async function Layout({ children, params }: Props) {
  const { projectId } = await params;
  // Use projectId...
}
```

### Conditional Layout Content

```tsx
// Show different content based on route
import { usePathname } from 'next/navigation';

function LayoutContent({ children }) {
  const pathname = usePathname();
  const isSettings = pathname.includes('/settings');

  return (
    <div>
      {!isSettings && <QuickActions />}
      {children}
    </div>
  );
}
```

### Mobile vs Desktop

```tsx
// Different UI for mobile/desktop
<>
  {/* Mobile: Show in header */}
  <div className="lg:hidden">
    <MobileNav />
  </div>

  {/* Desktop: Show in sidebar */}
  <div className="hidden lg:block">
    <DesktopSidebar />
  </div>
</>
```

## Best Practices

1. **Keep layouts thin** - Just structure, no business logic
2. **Use route groups** - Different layouts for different scopes
3. **Animate transitions** - Use `animate-fade-in-up` for page content
4. **Handle mobile** - Always consider responsive design
5. **Consistent spacing** - Use standard padding (`p-6`) in main content areas
