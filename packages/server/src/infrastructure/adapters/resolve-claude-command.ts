import { join } from 'node:path';
import type { ExecFn, HostFs } from '../host/types.js';

/**
 * Resolve the local `claude` CLI binary path.
 * Always runs locally — the claude binary is host-specific.
 */
export async function resolveClaudeCommand(
  execFn: ExecFn,
  hostFs: HostFs,
  homedir: string,
): Promise<string> {
  const localBin = join(homedir, '.local', 'bin', 'claude');
  if (await hostFs.exists(localBin)) return localBin;
  try {
    const { stdout } = await execFn('which', ['claude']);
    return stdout.trim();
  } catch {
    return 'claude';
  }
}
