export type ExecResult = { stdout: string; stderr: string };

export type ExecFn = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; maxBuffer?: number },
) => Promise<ExecResult>;

/**
 * A shell command's outcome. Never throws on a non-zero exit — callers read
 * `exitCode` (and `timedOut`) when they care, and the older callers that only
 * look at stdout/stderr keep working unchanged.
 */
export type ShellExecResult = ExecResult & { exitCode: number; timedOut?: boolean };

export type ShellExecFn = (
  command: string,
  options?: { cwd?: string; timeout?: number },
) => Promise<ShellExecResult>;

export interface HostFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  appendFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean }[]>;
  stat(path: string): Promise<{ size: number; mtimeMs: number } | null>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  rm(path: string, options?: { recursive?: boolean }): Promise<void>;
  readTail(path: string, bytes: number): Promise<string>;
}
