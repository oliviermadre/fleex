/**
 * Read-only side-by-side diff of one worktree file vs its base (merge-base),
 * for the Code editor's Edit/Diff toggle. Lazy-loaded alongside WorktreeMonaco.
 */
import { DiffEditor } from '@monaco-editor/react';
import { getLanguage, inferMonacoTheme } from './monacoUtils';

interface Props {
  original: string;
  modified: string;
  path: string;
}

export default function WorktreeDiffEditor({ original, modified, path }: Props) {
  return (
    <DiffEditor
      theme={inferMonacoTheme()}
      language={getLanguage(path)}
      original={original}
      modified={modified}
      options={{
        readOnly: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        wordWrap: 'on',
        fontSize: 13,
        fontFamily: '"Berkeley Mono", "JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace',
        automaticLayout: true,
        scrollBeyondLastLine: false,
      }}
    />
  );
}
