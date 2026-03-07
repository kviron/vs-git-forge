import type { ChangedFile } from '../../shared/lib/types';

interface ChangedFilesProps {
  repoName?: string;
  files: ChangedFile[];
}

export function ChangedFiles(props: ChangedFilesProps) {
  const count = () => props.files.length;
  const title = () =>
    props.repoName
      ? `${props.repoName} ${count()} ${count() === 1 ? 'file' : 'files'}`
      : `${count()} ${count() === 1 ? 'file' : 'files'}`;

  return (
    <div class="changed-files">
      <div class="changed-files__title">{title()}</div>
      <div class="changed-files__tree" role="tree">
        {props.files.map((file) => (
          <div class="changed-files__item" role="treeitem">
            <span class="changed-files__path">{file.path}</span>
            <span class="changed-files__name">{file.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
