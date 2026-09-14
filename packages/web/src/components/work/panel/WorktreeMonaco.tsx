/**
 * Monaco instance for one worktree file in the Code editor. Editable, ⌘S saves,
 * and the gutter is decorated on the lines changed vs base (`changedLines`).
 * Theme follows the app (light vs dark inferred from the surface luminance).
 * Lazy-loaded by CodeEditor so Monaco stays out of the main bundle.
 */
import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { getLanguage, inferMonacoTheme } from './monacoUtils';

// Derive Monaco types from the mount callback so we don't need a direct
// `monaco-editor` import (it's only a transitive dep of @monaco-editor/react).
type CodeEditorInstance = Parameters<OnMount>[0];
type MonacoNamespace = Parameters<OnMount>[1];
type DecorationsCollection = ReturnType<CodeEditorInstance['createDecorationsCollection']>;

interface Props {
  value: string;
  path: string;
  changedLines: number[];
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

export default function WorktreeMonaco({ value, path, changedLines, readOnly, onChange, onSave }: Props) {
  const editorRef = useRef<CodeEditorInstance | null>(null);
  const monacoRef = useRef<MonacoNamespace | null>(null);
  const decorationsRef = useRef<DecorationsCollection | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const applyDecorations = () => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    const decos = changedLines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: 'wt-diff-gutter',
        overviewRuler: { color: 'rgba(34,197,94,0.6)', position: monaco.editor.OverviewRulerLane.Left },
      },
    }));
    if (!decorationsRef.current) decorationsRef.current = ed.createDecorationsCollection(decos);
    else decorationsRef.current.set(decos);
  };

  const handleMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
    applyDecorations();
  };

  // Re-apply gutter markers when the changed set or file changes.
  useEffect(() => {
    applyDecorations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changedLines, path]);

  return (
    <Editor
      theme={inferMonacoTheme()}
      language={getLanguage(path)}
      path={path}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        readOnly: !!readOnly,
        minimap: { enabled: false },
        wordWrap: 'on',
        tabSize: 2,
        fontSize: 13,
        fontFamily: '"Berkeley Mono", "JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace',
        automaticLayout: true,
        scrollBeyondLastLine: false,
        renderLineHighlight: 'line',
        padding: { top: 12 },
      }}
    />
  );
}
