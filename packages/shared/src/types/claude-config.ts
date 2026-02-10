export interface ClaudeConfigTreeEntry {
  name: string;
  relativePath: string; // relative to ~ (e.g., ".claude/settings.json")
  isDirectory: boolean;
  size?: number;
  mtimeMs?: number;
  children?: ClaudeConfigTreeEntry[];
}
