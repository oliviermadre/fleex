import type { PtyHandle, TerminalDimensions } from '@fleex/shared';

export interface PtyPort {
  spawnAttach(tmuxSessionName: string, dims: TerminalDimensions): PtyHandle;
}
