export type CommandCategory = 'session' | 'view' | 'create' | 'pinned' | 'worktree' | 'action';

export interface CommandItem {
  id: string;
  label: string;
  category: CommandCategory;
  categoryLabel: string;
  icon: React.ReactNode;
  keywords?: string;
  onExecute: () => void;
}
