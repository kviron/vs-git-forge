import type { Branch, Commit, ChangedFile } from './types';

export const MOCK_LOCAL_BRANCHES: Branch[] = [
  { name: 'MP-8857_edit_create_project_2', isCurrent: false },
  { name: 'master', isCurrent: true, isFavorite: true },
  { name: 'MP-8853_add_validation', isSelected: true },
  { name: 'MP-8857_edit_create_project', isCurrent: false },
];

export const MOCK_REMOTE_BRANCHES: Branch[] = [
  {
    name: 'origin',
    children: [
      { name: 'master', isFavorite: true },
      {
        name: 'DevOps',
        children: [
          { name: 'develop' },
          { name: 'stage' },
        ],
      },
    ],
  },
];

export const MOCK_COMMITS: Commit[] = [
  {
    hash: 'b1100db3',
    shortHash: 'b1100db3',
    message: "MP-8862 #time 20m список мейтов - вёрстка",
    author: 'radyuk',
    authorEmail: 'radyuk@myservices.digital',
    date: '06.03.2026 at 9:58',
    dateRelative: 'Yesterday 9:58',
    branches: ['master', 'origin/master'],
    graphRow: [1],
  },
  {
    hash: 'a1b2c3d4',
    shortHash: 'a1b2c3d4',
    message: "Merge branch 'MP-8853_add_validation' into 'master'",
    author: 'Мамаев Роман Андреевич',
    date: '05.03.2026 14:53',
    dateRelative: '05.03.2026 14:53',
    isMerge: true,
    graphRow: [0, 1, 2],
  },
  {
    hash: 'e5f6g7h8',
    shortHash: 'e5f6g7h8',
    message: 'MP-8859 #time 10m списки проектов - фикс стабов',
    author: 'Радюк Роман Николаевич',
    date: '05.03.2026 12:00',
    dateRelative: '05.03.2026 12:00',
    graphRow: [0, 1],
  },
  {
    hash: 'i9j0k1l2',
    shortHash: 'i9j0k1l2',
    message: 'MP-8853 валидация форм',
    author: 'radyuk',
    date: '04.03.2026 18:30',
    dateRelative: '04.03.2026 18:30',
    graphRow: [1],
  },
];

export const MOCK_CHANGED_FILES: ChangedFile[] = [
  {
    path: 'clubm8-web > src/components/cards > MateCard',
    name: 'index.tsx',
    status: 'modified',
  },
];
