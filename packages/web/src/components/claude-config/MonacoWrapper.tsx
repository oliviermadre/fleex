import Editor, { type OnMount } from '@monaco-editor/react';

import { useClaudeConfigStore } from '../../stores/claudeConfigStore';

const LANGUAGE_MAP: Record<string, string> = {
  json: 'json',
  md: 'markdown',
  ts: 'typescript',
  js: 'javascript',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  txt: 'plaintext',
};

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_MAP[ext] ?? 'plaintext';
}

export default function MonacoWrapper() {
  const selectedFile = useClaudeConfigStore((s) => s.selectedFile);
  const fileContent = useClaudeConfigStore((s) => s.fileContent);
  const setFileContent = useClaudeConfigStore((s) => s.setFileContent);
  const saveFile = useClaudeConfigStore((s) => s.saveFile);

  const language = selectedFile ? getLanguage(selectedFile) : 'plaintext';

  const handleMount: OnMount = (editor, monaco) => {
    // Cmd+S save binding
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveFile();
    });
  };

  return (
    <Editor
      theme="vs-dark"
      language={language}
      value={fileContent}
      onChange={(value) => setFileContent(value ?? '')}
      onMount={handleMount}
      options={{
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
