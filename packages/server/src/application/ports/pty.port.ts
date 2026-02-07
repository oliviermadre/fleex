import type { PtyHandle, TerminalDimensions } from '@asm/shared';

export interface PtyPort {
  spawnAttach(tmuxSessionName: string, dims: TerminalDimensions): PtyHandle;
}
