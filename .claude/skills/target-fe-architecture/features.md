# Features

User actions with side effects (mutations, API calls, state changes).

## When to Create Feature

- User action that changes data
- Needs `useMutation` or API call
- Has loading/success/error states
- Includes confirmation dialog
- Reused across multiple pages

## Feature Structure

```
features/feature-name/
├── index.ts              # Public API
├── ui/
│   ├── feature-button.tsx      # Main trigger
│   ├── feature-modal.tsx       # Modal (if needed)
│   └── feature-form.tsx        # Form (if needed)
├── model/
│   ├── use-feature.ts          # Main hook with mutation
│   └── types.ts
└── api/
    └── feature-api.ts          # API calls (if complex)
```

## AI Translate Feature

```
features/ai-translate/
├── index.ts
├── ui/
│   ├── ai-translate-button.tsx
│   └── ai-translate-modal.tsx
├── model/
│   └── use-ai-translate.ts
└── api/
    └── ai-translate.ts
```

### Button Component

```tsx
// features/ai-translate/ui/ai-translate-button.tsx
'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { AITranslateModal } from './ai-translate-modal';

interface AITranslateButtonProps {
  keyId: string;
  sourceLanguage: string;
  targetLanguages: string[];
}

export function AITranslateButton({
  keyId,
  sourceLanguage,
  targetLanguages,
}: AITranslateButtonProps) {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setShowModal(true)}>
        <Sparkles className="mr-2 size-4" />
        AI Translate
      </Button>

      <AITranslateModal
        open={showModal}
        onOpenChange={setShowModal}
        keyId={keyId}
        sourceLanguage={sourceLanguage}
        targetLanguages={targetLanguages}
      />
    </>
  );
}
```

### Modal with Form

```tsx
// features/ai-translate/ui/ai-translate-modal.tsx
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { useAITranslate } from '../model/use-ai-translate';

interface AITranslateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyId: string;
  sourceLanguage: string;
  targetLanguages: string[];
}

export function AITranslateModal({
  open,
  onOpenChange,
  keyId,
  sourceLanguage,
  targetLanguages,
}: AITranslateModalProps) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(targetLanguages);

  const { mutate, isPending, error } = useAITranslate({
    onSuccess: () => onOpenChange(false),
  });

  const handleTranslate = () => {
    mutate({
      keyId,
      sourceLanguage,
      targetLanguages: selectedLanguages,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI Translate</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">Select languages to translate to:</p>

          {targetLanguages.map((lang) => (
            <label key={lang} className="flex items-center gap-2">
              <Checkbox
                checked={selectedLanguages.includes(lang)}
                onCheckedChange={(checked) => {
                  setSelectedLanguages((prev) =>
                    checked ? [...prev, lang] : prev.filter((l) => l !== lang)
                  );
                }}
              />
              {lang}
            </label>
          ))}

          {error && <p className="text-destructive text-sm">{error.message}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleTranslate} disabled={isPending || selectedLanguages.length === 0}>
            {isPending ? 'Translating...' : 'Translate'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### Mutation Hook

```tsx
// features/ai-translate/model/use-ai-translate.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { requestAITranslation } from '../api/ai-translate';

interface AITranslateInput {
  keyId: string;
  sourceLanguage: string;
  targetLanguages: string[];
}

interface UseAITranslateOptions {
  onSuccess?: () => void;
}

export function useAITranslate(options?: UseAITranslateOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AITranslateInput) => requestAITranslation(input),
    onSuccess: (data, variables) => {
      // Invalidate translations to refetch with new AI translations
      queryClient.invalidateQueries({
        queryKey: ['translations', variables.keyId],
      });
      options?.onSuccess?.();
    },
  });
}
```

### Public API

```typescript
// features/ai-translate/index.ts
export { AITranslateButton } from './ui/ai-translate-button';
export { useAITranslate } from './model/use-ai-translate';
```

## Delete Key Feature

Feature with confirmation:

```
features/delete-key/
├── index.ts
├── ui/
│   ├── delete-key-button.tsx
│   └── confirm-dialog.tsx
└── model/
    └── use-delete-key.ts
```

```tsx
// features/delete-key/ui/delete-key-button.tsx
'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { useDeleteKey } from '../model/use-delete-key';

export function DeleteKeyButton({ keyId, keyName }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const { mutate, isPending } = useDeleteKey();

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setShowConfirm(true)}>
        <Trash2 className="size-4" />
      </Button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{keyName}"? This will remove all translations for
              this key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => mutate(keyId)} disabled={isPending}>
              {isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

## Bulk Edit Feature

Feature with complex form:

```
features/bulk-edit/
├── index.ts
├── ui/
│   ├── bulk-edit-button.tsx
│   ├── bulk-edit-panel.tsx
│   └── bulk-edit-form.tsx
├── model/
│   ├── use-bulk-edit.ts
│   └── use-selection.ts
└── lib/
    └── validate-edits.ts
```

## Create Project Feature

Feature with form validation:

```
features/create-project/
├── index.ts
├── ui/
│   ├── create-project-button.tsx
│   ├── create-project-dialog.tsx
│   └── create-project-form.tsx
├── model/
│   ├── use-create-project.ts
│   └── form-schema.ts
```

```tsx
// features/create-project/ui/create-project-form.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Button } from '@/shared/ui/button';
import { useCreateProject } from '../model/use-create-project';
import { createProjectSchema, type CreateProjectInput } from '../model/form-schema';

export function CreateProjectForm({ onSuccess }: { onSuccess: () => void }) {
  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      slug: '',
      sourceLanguage: 'en',
    },
  });

  const { mutate, isPending } = useCreateProject({
    onSuccess: () => {
      form.reset();
      onSuccess();
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => mutate(data))} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Slug</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isPending}>
          {isPending ? 'Creating...' : 'Create Project'}
        </Button>
      </form>
    </Form>
  );
}
```

## Feature Composition

Features can be composed in widgets:

```tsx
// widgets/key-actions/ui/key-actions.tsx
import { AITranslateButton } from '@/features/ai-translate';
import { DeleteKeyButton } from '@/features/delete-key';
import { CopyKeyButton } from '@/features/copy-key';

export function KeyActions({ keyId, keyName }: Props) {
  return (
    <div className="flex gap-2">
      <AITranslateButton keyId={keyId} />
      <CopyKeyButton keyId={keyId} />
      <DeleteKeyButton keyId={keyId} keyName={keyName} />
    </div>
  );
}
```

## Best Practices

### DO

- One mutation per feature
- Include loading/error states
- Use confirmation for destructive actions
- Export only public components and hooks

### DON'T

- Put display-only components in features
- Have features depend on other features
- Skip error handling
- Export internal components
