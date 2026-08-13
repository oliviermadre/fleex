export type CommandCategory = 'session' | 'view' | 'create' | 'pinned' | 'worktree' | 'action' | 'ticket' | 'memory';

export interface CommandItem {
  id: string;
  label: string;
  category: CommandCategory;
  categoryLabel: string;
  icon: React.ReactNode;
  description?: string;
  keywords?: string;
  onExecute: () => void;
}
