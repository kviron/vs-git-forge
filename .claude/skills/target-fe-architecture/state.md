# State Management

Lingx uses a simple state architecture: React Query for server state, React hooks for local state.

## State Types

| Type             | Tool            | Examples                          |
| ---------------- | --------------- | --------------------------------- |
| **Server State** | React Query     | Projects, translations, user data |
| **Form State**   | react-hook-form | Input values, validation          |
| **UI State**     | useState        | Modals, dropdowns, toggles        |
| **Auth State**   | Context         | Current user, auth status         |
| **URL State**    | Next.js router  | Page, filters, pagination         |

## Server State (React Query)

All data from the API is managed by React Query:

```typescript
// Data is fetched via custom hooks
const { data: projects } = useProjects();
const { data: stats } = useDashboardStats();

// Mutations update server and invalidate cache
const { mutate } = useCreateProject();
mutate(data, {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['projects'] });
  },
});
```

See [data-fetching.md](data-fetching.md) for details.

## Local UI State

Use `useState` for component-specific UI state:

```typescript
function TranslationEditor() {
  // UI toggles
  const [isExpanded, setIsExpanded] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Temporary selections
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // View mode
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
}
```

## Form State

Use react-hook-form + zod for forms:

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const projectSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().min(1, 'Slug is required'),
  description: z.string().optional(),
});

type ProjectFormData = z.infer<typeof projectSchema>;

function CreateProjectForm() {
  const form = useForm<ProjectFormData>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      name: '',
      slug: '',
      description: '',
    },
  });

  const onSubmit = (data: ProjectFormData) => {
    // Handle submit
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
```

## Auth Context

Authentication is managed via React Context:

```typescript
// lib/auth.tsx
interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isManager: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check auth on mount
    authApi.me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    setUser(response.user);
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
  };

  const value = {
    user,
    isLoading,
    login,
    logout,
    isManager: user?.role === 'MANAGER' || user?.role === 'ADMIN',
    isAdmin: user?.role === 'ADMIN',
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
```

## URL State

Use Next.js router for URL-based state:

```typescript
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

function TranslationsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Read from URL
  const search = searchParams.get('search') || '';
  const filter = searchParams.get('filter') || 'all';
  const page = parseInt(searchParams.get('page') || '1');

  // Update URL
  const updateFilters = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div>
      <SearchInput
        value={search}
        onChange={(value) => updateFilters({ search: value })}
      />
      <FilterSelect
        value={filter}
        onChange={(value) => updateFilters({ filter: value })}
      />
    </div>
  );
}
```

## Derived State

Use `useMemo` for computed values:

```typescript
function TranslationList({ keys, languages }: Props) {
  // Compute completion percentage
  const completionStats = useMemo(() => {
    const totalCells = keys.length * languages.length;
    const filledCells = keys.reduce((acc, key) => {
      return acc + languages.filter(lang =>
        key.translations[lang.code]?.value
      ).length;
    }, 0);

    return {
      total: totalCells,
      filled: filledCells,
      percentage: totalCells > 0
        ? Math.round((filledCells / totalCells) * 100)
        : 0,
    };
  }, [keys, languages]);

  return (
    <div>
      <p>{completionStats.percentage}% complete</p>
      {/* ... */}
    </div>
  );
}
```

## Lifting State

When siblings need shared state, lift it to parent:

```typescript
// Parent manages shared state
function TranslationEditor() {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);

  return (
    <div>
      <LanguageSelector
        selected={selectedLanguages}
        onChange={setSelectedLanguages}
      />
      <TranslationTable
        visibleLanguages={selectedLanguages}
      />
    </div>
  );
}
```

## When NOT to Use Context

Avoid context for:

- Data that React Query handles (server state)
- Component-specific state (useState)
- URL-based state (router)
- Form state (react-hook-form)

Use context only for:

- Authentication state
- Theme preferences (if needed)
- Feature flags (if needed)

## State Colocation Principles

1. **Start local** - Use useState until proven otherwise
2. **Lift when needed** - Move up only when siblings need it
3. **Use React Query for server state** - Don't duplicate in local state
4. **URL for shareable state** - Filters, pagination, views
5. **Context for truly global** - Auth, theme only
