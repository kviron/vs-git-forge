import { sendViewDiff } from '../../shared/api/vscodeApi';
import type { ChangedFile } from '../../shared/lib/types';
import { UNCOMMITTED_HASH } from '../../shared/lib/types';

interface ChangedFilesProps {
  repoName?: string;
  files: ChangedFile[];
  /** Хеш выбранного коммита; при UNCOMMITTED клик по файлу открывает diff (HEAD ↔ working tree). */
  selectedCommitHash?: string | null;
}

export function ChangedFiles(props: ChangedFilesProps) {
  const count = () => props.files.length;
  const title = () =>
    props.repoName
      ? `${props.repoName} ${count()} ${count() === 1 ? 'file' : 'files'}`
      : `${count()} ${count() === 1 ? 'file' : 'files'}`;

  const onFileClick = (file: ChangedFile) => {
    if (props.selectedCommitHash !== UNCOMMITTED_HASH) return;
    const status = file.status ?? 'modified';
    sendViewDiff({
      fromHash: 'HEAD',
      toHash: UNCOMMITTED_HASH,
      oldFilePath: file.path,
      newFilePath: file.path,
      type: status,
    });
  };

  return (
    <div class="changed-files">
      <div class="changed-files__title">{title()}</div>
      <div class="changed-files__tree" role="tree">
        {props.files.map((file) => (
          <div
            class="changed-files__item"
            classList={{
              'changed-files__item--clickable':
                props.selectedCommitHash === UNCOMMITTED_HASH,
            }}
            role="treeitem"
            title={
              props.selectedCommitHash === UNCOMMITTED_HASH
                ? 'Сравнить с HEAD (открыть diff)'
                : undefined
            }
            onClick={() => onFileClick(file)}
          >
            <span class="changed-files__path">{file.path}</span>
            <span class="changed-files__name">{file.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
