import { describe, it, expect } from 'vitest';
import { ExecuteAgentUseCase } from '../../src/application/use-cases/execute-agent.js';
import type { PromptContentBlock } from '../../src/application/utils/resolve-file-references.js';

/**
 * A human can attach an image to gate notes / a `waiting_for_info` answer. It reaches
 * the next step's agent through exactly one channel:
 * - ticket run: the notes are also posted as a ticket comment, and comments are resolved;
 *   the Run history must stay unresolved, or the agent gets the same image twice;
 * - routine run: there is no ticket, hence no comment, so the Run history is the only
 *   channel and must be resolved, or the agent only sees an unreadable `/api/files/` link.
 */
const NOTES = 'Rejected, see ![shot](/api/files/11111111-1111-1111-1111-111111111111)';
const RUN_HISTORY = `**Run history so far**\n- **Gate** (attempt 1, completed)\n  - human notes: ${NOTES}`;

function makeUseCase() {
  const stub = {} as never;
  const logger = { info() {}, warn() {}, error() {}, debug() {} } as never;
  const config = { get: () => ({}) } as never;
  const useCase = new ExecuteAgentUseCase(
    stub, stub, stub, stub, stub, stub, stub, stub, stub, config, logger, stub, stub, stub,
  );
  const u = useCase as unknown as Record<string, unknown>;
  // Fake file store: every `/api/files/` reference becomes one image block.
  u['resolveText'] = async (text: string): Promise<PromptContentBlock[]> =>
    text.includes('/api/files/')
      ? [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } } as PromptContentBlock]
      : [{ type: 'text', text }];
  return u as unknown as {
    composeRoutineUserPrompt: (s: unknown, p: string) => Promise<{ blocks: PromptContentBlock[]; manifest: { kind: string; imageCount?: number }[] }>;
    composeWorkflowUserPrompt: (c: unknown, p: string) => Promise<{ blocks: PromptContentBlock[]; manifest: { kind: string; imageCount?: number }[] }>;
  };
}

const images = (blocks: PromptContentBlock[]) => blocks.filter((b) => b.type === 'image').length;

describe('ExecuteAgentUseCase — images in human notes of the Run history', () => {
  it('routine run: resolves the image, since the Run history is the only channel', async () => {
    const { blocks, manifest } = await makeUseCase().composeRoutineUserPrompt({ brief: 'Do it', repos: [] }, RUN_HISTORY);

    expect(images(blocks)).toBe(1);
    expect(manifest.find((m) => m.kind === 'workflow_instructions')?.imageCount).toBe(1);
  });

  it('ticket run: the image arrives once, through the decision comment only', async () => {
    const context = {
      ticket: { id: 't1', title: 'T', status: 'doing', priority: 'urgent', description: null },
      comments: [{ id: 'c1', authorName: 'workflow', authorType: 'agent', body: `**User decision :** *reject*\n\n${NOTES}` }],
      deliverables: [],
    };
    const { blocks, manifest } = await makeUseCase().composeWorkflowUserPrompt(context, RUN_HISTORY);

    expect(images(blocks)).toBe(1);
    expect(manifest.find((m) => m.kind === 'comment')?.imageCount).toBe(1);
    expect(manifest.find((m) => m.kind === 'workflow_instructions')?.imageCount).toBeUndefined();
  });
});
