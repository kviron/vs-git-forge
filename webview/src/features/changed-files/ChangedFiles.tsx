import { createMemo } from 'solid-js';
import { Index } from 'solid-js';
import {
  TreeView,
  createFileTreeCollection,
  useTreeViewContext,
  type FilePathTreeNode,
} from '@ark-ui/solid/tree-view';
import { sendViewDiff } from '../../shared/api/vscodeApi';
import type { Commit, ChangedFile } from '../../shared/lib/types';
import { UNCOMMITTED_HASH } from '../../shared/lib/types';

/** Хеш пустого дерева Git (для root-коммитов в diff) */
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Нормализует путь к виду с прямыми слешами (для createFileTreeCollection и совпадения value) */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/');
}

interface ChangedFilesProps {
  repoName?: string;
  files: ChangedFile[];
  /** Выбранный коммит; при UNCOMMITTED клик открывает diff (HEAD ↔ working tree), иначе parent ↔ commit */
  commit?: Commit | null;
  /** Хеш выбранного коммита; при UNCOMMITTED клик по файлу открывает diff (HEAD ↔ working tree). */
  selectedCommitHash?: string | null;
}

interface TreeNodeProps {
  node: FilePathTreeNode;
  indexPath: number[];
  collection: ReturnType<typeof createFileTreeCollection>;
  filesByPath: Map<string, ChangedFile>;
  isClickable: boolean;
  selectedCommitHash?: string | null;
  onFileClick: (file: ChangedFile) => void;
}

function TreeNode(props: TreeNodeProps) {
  const tree = useTreeViewContext();
  const nodeState = () => tree().getNodeState({ node: props.node, indexPath: props.indexPath });
  const children = () => props.collection.getNodeChildren(props.node);
  const value = () => props.collection.getNodeValue(props.node);
  const label = () => props.collection.stringifyNode(props.node);
  const isExpanded = () => tree().expandedValue?.includes(value()) ?? false;

  const titleAttr = () =>
    props.isClickable && props.selectedCommitHash !== undefined
      ? props.selectedCommitHash === UNCOMMITTED_HASH
        ? 'Сравнить с HEAD (открыть diff)'
        : 'Открыть diff коммита'
      : undefined;

  const handleItemClick = () => {
    if (!props.isClickable) return;
    const v = value();
    const file = v ? props.filesByPath.get(v) : undefined;
    if (file) props.onFileClick(file);
  };

  return (
    <TreeView.NodeProvider node={props.node} indexPath={props.indexPath}>
      {nodeState().isBranch ? (
        <TreeView.Branch class="changed-files__branch" data-value={value()}>
          <TreeView.BranchControl class="changed-files__branch-control">
            <TreeView.BranchTrigger class="changed-files__branch-trigger">
              <TreeView.BranchIndicator class="changed-files__branch-indicator" />
            </TreeView.BranchTrigger>
            <span
              class={`changed-files__icon codicon codicon-${isExpanded() ? 'folder-opened' : 'folder'}`}
              aria-hidden="true"
            />
            <TreeView.BranchText class="changed-files__branch-text">{label()}</TreeView.BranchText>
          </TreeView.BranchControl>
          <TreeView.BranchContent class="changed-files__branch-content">
            <TreeView.BranchIndentGuide class="changed-files__branch-indent" />
            <Index each={children()}>
              {(child, index) => (
                <TreeNode
                  node={child()}
                  indexPath={[...props.indexPath, index]}
                  collection={props.collection}
                  filesByPath={props.filesByPath}
                  isClickable={props.isClickable}
                  selectedCommitHash={props.selectedCommitHash}
                  onFileClick={props.onFileClick}
                />
              )}
            </Index>
          </TreeView.BranchContent>
        </TreeView.Branch>
      ) : (
        <TreeView.Item
          class="changed-files__item"
          classList={{ 'changed-files__item--clickable': props.isClickable }}
          data-value={value()}
          onClick={handleItemClick}
          title={titleAttr()}
        >
          <span class="changed-files__icon codicon codicon-file" aria-hidden="true" />
          <TreeView.ItemText class="changed-files__item-text">{label()}</TreeView.ItemText>
        </TreeView.Item>
      )}
    </TreeView.NodeProvider>
  );
}

export function ChangedFiles(props: ChangedFilesProps) {
  const count = () => props.files.length;
  const title = () =>
    props.repoName
      ? `${props.repoName} ${count()} ${count() === 1 ? 'file' : 'files'}`
      : `${count()} ${count() === 1 ? 'file' : 'files'}`;

  const isClickable = () =>
    props.selectedCommitHash === UNCOMMITTED_HASH ||
    (props.commit != null &&
      props.commit.hash !== UNCOMMITTED_HASH &&
      props.files.length > 0);

  const onFileClick = (file: ChangedFile) => {
    const status = file.status ?? 'modified';
    if (props.selectedCommitHash === UNCOMMITTED_HASH) {
      sendViewDiff({
        fromHash: 'HEAD',
        toHash: UNCOMMITTED_HASH,
        oldFilePath: file.path,
        newFilePath: file.path,
        type: status,
      });
      return;
    }
    if (props.commit && props.commit.hash !== UNCOMMITTED_HASH) {
      const fromHash = props.commit.parents?.[0] ?? EMPTY_TREE_HASH;
      sendViewDiff({
        fromHash,
        toHash: props.commit.hash,
        oldFilePath: file.path,
        newFilePath: file.path,
        type: status,
      });
    }
  };

  const collection = createMemo(() => {
    const paths = props.files.map((f) => normalizePath(f.path));
    return createFileTreeCollection(paths);
  });

  const filesByPath = createMemo(() => {
    const map = new Map<string, ChangedFile>();
    for (const f of props.files) map.set(normalizePath(f.path), f);
    return map;
  });

  const defaultExpandedValue = createMemo(() => {
    const col = collection();
    return col.getBranchValues?.() ?? [];
  });

  const rootChildren = () => collection().getNodeChildren(collection().rootNode);

  return (
    <div class="changed-files">
      {count() === 0 ? (
        <>
          <div class="changed-files__title">{title()}</div>
          <div class="changed-files__empty">Нет изменённых файлов</div>
        </>
      ) : (
        <TreeView.Root
          class="changed-files__tree-root"
          ids={{ root: 'changed-files-tree', label: 'changed-files-tree-label' }}
          collection={collection()}
          defaultExpandedValue={defaultExpandedValue()}
          expandOnClick
          selectionMode="single"
          onSelectionChange={(e) => {
            const selected = e.value?.[0];
            if (selected) {
              const file = filesByPath().get(selected);
              if (file) onFileClick(file);
            }
          }}
        >
          <TreeView.Label id="changed-files-tree-label" class="changed-files__title">
            {title()}
          </TreeView.Label>
          <TreeView.Tree class="changed-files__tree">
            <Index each={rootChildren()}>
              {(child, index) => (
                <TreeNode
                  node={child()}
                  indexPath={[index]}
                  collection={collection()}
                  filesByPath={filesByPath()}
                  isClickable={isClickable()}
                  selectedCommitHash={props.selectedCommitHash}
                  onFileClick={onFileClick}
                />
              )}
            </Index>
          </TreeView.Tree>
        </TreeView.Root>
      )}
    </div>
  );
}
