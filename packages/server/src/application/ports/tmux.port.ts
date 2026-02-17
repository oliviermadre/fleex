export interface TmuxSessionInfo {
  name: string;
  created: string;
  attached: boolean;
  width: number;
  height: number;
}

export interface TmuxPort {
  isAvailable(): Promise<boolean>;
  createSession(opts: { name: string; cwd: string; command?: string }): Promise<void>;
  killSession(name: string): Promise<void>;
  hasSession(name: string): Promise<boolean>;
  listSessions(): Promise<TmuxSessionInfo[]>;
  listManagedSessions(): Promise<TmuxSessionInfo[]>;
  renameSession(oldName: string, newName: string): Promise<void>;
  sendKeys(name: string, keys: string): Promise<void>;
  getSessionCwd(name: string): Promise<string | null>;
}
