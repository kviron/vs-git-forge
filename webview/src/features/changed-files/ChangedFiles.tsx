import { createMemo } from 'solid-js';
import { Index } from 'solid-js';
import {
  TreeView,
  createFileTreeCollection,
  useTreeViewContext,
  type FilePathTreeNode,
} from '@ark-ui/solid/tree-view';
import { getContextMenu } from '../../shared/api/contextMenu';
import { sendViewDiff, sendViewFileAtRevision, postMessageToHost } from '../../shared/api/vscodeApi';
import { log } from '../../shared/logger';
import { t } from '../../shared/i18n';
import type { Commit, ChangedFile } from '../../shared/lib/types';
import { UNCOMMITTED_HASH } from '../../shared/lib/types';

/** Иконка codicon для контекстного меню (VS Code webview) */
function codicon(name: string): string {
  return `<span class="codicon codicon-${name}" aria-hidden="true"></span>`;
}

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
  commit?: Commit | null;
  onFileClick: (file: ChangedFile) => void;
  onFileContextMenu?: (file: ChangedFile, e: MouseEvent) => void;
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

  const onFileContextMenu = (e: MouseEvent) => {
    log.debug('ChangedFiles TreeNode: onFileContextMenu вызван, value=', value());
    const v = value();
    const file = v ? props.filesByPath.get(v) : undefined;
    if (!file) {
      log.debug('ChangedFiles TreeNode: file не найден для value=', v);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    log.debug('ChangedFiles TreeNode: вызываем onFileContextMenu для', file.path);
    props.onFileContextMenu?.(file, e);
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
                  commit={props.commit}
                  onFileClick={props.onFileClick}
                  onFileContextMenu={props.onFileContextMenu}
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
          onContextMenu={onFileContextMenu}
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

  const showFileContextMenu = (file: ChangedFile, e: MouseEvent) => {
    log.debug('ChangedFiles: showFileContextMenu для файла', file.path);
    const commit = props.commit;
    const isUncommitted = props.selectedCommitHash === UNCOMMITTED_HASH;
    const fromHash = commit && commit.hash !== UNCOMMITTED_HASH
      ? (commit.parents?.[0] ?? EMPTY_TREE_HASH)
      : 'HEAD';
    const toHash = commit?.hash ?? UNCOMMITTED_HASH;
    const status = file.status ?? 'modified';
    const oldPath = file.oldPath ?? file.path;

    const menu = getContextMenu();
    menu.show(
      [
        [
          {
            title: 'Show Diff',
            visible: true,
            shortcut: 'Ctrl+D',
            icon: codicon('git-compare'),
            onClick: () => {
              sendViewDiff({
                fromHash,
                toHash,
                oldFilePath: oldPath,
                newFilePath: file.path,
                type: status,
              });
            },
          },
          {
            title: 'Show Diff in a New Tab',
            visible: true,
            icon: codicon('git-compare'),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'viewDiff',
                params: {
                  fromHash,
                  toHash,
                  oldFilePath: oldPath,
                  newFilePath: file.path,
                  type: status,
                  openInNewTab: true,
                },
              });
            },
          },
        ],
        [
          {
            title: 'Compare with Local',
            visible: !isUncommitted && !!commit,
            icon: codicon('git-compare'),
            onClick: () => {
              sendViewDiff({
                fromHash: commit!.hash,
                toHash: UNCOMMITTED_HASH,
                oldFilePath: oldPath,
                newFilePath: file.path,
                type: status,
              });
            },
          },
          {
            title: 'Compare Before with Local',
            visible: !isUncommitted && !!commit,
            icon: codicon('git-compare'),
            onClick: () => {
              sendViewDiff({
                fromHash,
                toHash: UNCOMMITTED_HASH,
                oldFilePath: oldPath,
                newFilePath: file.path,
                type: status,
              });
            },
          },
        ],
        [
          {
            title: 'Edit Source',
            visible: true,
            shortcut: 'F4',
            icon: codicon('edit'),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'openWorkingFile',
                params: { filePath: file.path },
              });
            },
          },
          {
            title: 'Open Repository Version',
            visible: !isUncommitted && !!commit,
            icon: codicon('file'),
            onClick: () => {
              sendViewFileAtRevision({
                hash: commit!.hash,
                filePath: file.path,
                type: status,
              });
            },
          },
        ],
        [
          {
            title: 'Revert Selected Changes',
            visible: isUncommitted,
            icon: codicon('discard'),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'revertWorkingFile',
                params: { filePath: file.path },
              });
            },
          },
          {
            title: 'Cherry-Pick Selected Changes',
            visible: !isUncommitted && !!commit,
            icon: codicon('git-branch'),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'cherryPickFile',
                params: { commitHash: commit!.hash, filePath: file.path },
              });
            },
          },
          {
            title: 'Extract Selected Changes to Separate Commit...',
            visible: true,
            disabled: true,
            onClick: () => {},
          },
          {
            title: 'Drop Selected Changes',
            visible: true,
            disabled: true,
            onClick: () => {},
          },
        ],
        [
          {
            title: 'Create Patch...',
            visible: !isUncommitted && !!commit,
            icon: codicon('add'),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'createPatchForFile',
                params: { commitHash: commit!.hash, filePath: file.path, oldFilePath: oldPath },
              });
            },
          },
          {
            title: 'Get from Revision',
            visible: !isUncommitted && !!commit,
            icon: codicon('arrow-down'),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'getFileFromRevision',
                params: { commitHash: commit!.hash, filePath: file.path },
              });
            },
          },
        ],
        [
          {
            title: 'History Up to Here',
            visible: !isUncommitted && !!commit,
            icon: codicon('history'),
            onClick: () => {
              postMessageToHost({
                type: 'command',
                command: 'fileHistoryUpToCommit',
                params: { commitHash: commit!.hash, filePath: file.path },
              });
            },
          },
          {
            title: 'Show Changes to Parents',
            visible: !isUncommitted && !!commit,
            icon: codicon('git-compare'),
            onClick: () => {
              sendViewDiff({
                fromHash,
                toHash: commit!.hash,
                oldFilePath: oldPath,
                newFilePath: file.path,
                type: status,
              });
            },
          },
        ],
      ],
      e,
      document.body,
    );
  };

  const onTreeContextMenu = (e: MouseEvent) => {
    const item = (e.target as HTMLElement).closest?.('.changed-files__item');
    if (!item) return;
    const val = item.getAttribute('data-value');
    const file = val ? filesByPath().get(val) : undefined;
    if (file) {
      e.preventDefault();
      e.stopPropagation();
      log.debug('ChangedFiles: контекстное меню по делегированию, файл', file.path);
      showFileContextMenu(file, e);
    }
  };

  return (
    <div class="changed-files">
      {count() === 0 ? (
        <>
          <div class="changed-files__title">{title()}</div>
          <div class="changed-files__empty">{t("changedFiles.empty")}</div>
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
            const selected = e.selectedValue?.[0];
            if (selected) {
              const file = filesByPath().get(selected);
              if (file) onFileClick(file);
            }
          }}
        >
          <TreeView.Label id="changed-files-tree-label" class="changed-files__title">
            {title()}
          </TreeView.Label>
          <div class="changed-files__tree-wrap" onContextMenu={onTreeContextMenu}>
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
                  commit={props.commit}
                  onFileClick={onFileClick}
                  onFileContextMenu={showFileContextMenu}
                />
              )}
            </Index>
          </TreeView.Tree>
          </div>
        </TreeView.Root>
      )}
    </div>
  );
}
