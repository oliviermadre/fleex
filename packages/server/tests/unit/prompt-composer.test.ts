import { describe, it, expect } from 'vitest';
import {
  PromptComposer,
  buildExecutionContextData,
  flattenPrompt,
  promptTextLength,
} from '../../src/application/utils/prompt-composer.js';
import type { PromptContentBlock } from '../../src/application/utils/resolve-file-references.js';

/** Passthrough resolver: no file stores, so text stays one text block. */
const plainResolver = async (text: string): Promise<PromptContentBlock[]> => [{ type: 'text', text }];

/** Resolver that turns a marker into an image block, as attachments do. */
const imageResolver = async (text: string): Promise<PromptContentBlock[]> => {
  if (!text.includes('[[img]]')) return [{ type: 'text', text }];
  const [before, after] = text.split('[[img]]');
  return [
    { type: 'text', text: before ?? '' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    { type: 'text', text: after ?? '' },
  ];
};

describe('PromptComposer keeps the prompt and its manifest in sync', () => {
  it('records a manifest entry for tracked content and none for scaffolding', async () => {
    const composer = new PromptComposer(plainResolver);

    composer.scaffold('\n## Comments\n');
    composer.track(
      { kind: 'comment', section: 'Comments', label: 'Olivier (user)', sourceKind: 'comment', sourceId: 'c1' },
      '**Olivier** (user):\nship it\n',
    );

    // Both pieces reach the prompt; only the sourced one is declared.
    expect(promptTextLength(composer.getBlocks())).toBe(
      '\n## Comments\n'.length + '**Olivier** (user):\nship it\n'.length,
    );
    expect(composer.getManifest()).toHaveLength(1);
    expect(composer.getManifest()[0]).toMatchObject({
      kind: 'comment',
      sourceId: 'c1',
      charCount: '**Olivier** (user):\nship it\n'.length,
    });
  });

  it('measures charCount from the text actually pushed', () => {
    const composer = new PromptComposer(plainResolver);
    composer.track({ kind: 'description', section: 'Description', label: 'd' }, 'abcde');
    expect(composer.getManifest()[0]?.charCount).toBe(5);
  });

  it('attributes resolved image blocks to the item that carried them', async () => {
    const composer = new PromptComposer(imageResolver);
    await composer.trackResolved(
      { kind: 'description', section: 'Description', label: 'Ticket description' },
      'before[[img]]after',
    );

    const entry = composer.getManifest()[0];
    expect(entry?.imageCount).toBe(1);
    // charCount counts text only — an image block contributes no characters.
    expect(entry?.charCount).toBe('before'.length + 'after'.length);
    expect(composer.getBlocks().filter((b) => b.type === 'image')).toHaveLength(1);
  });

  it('omits imageCount when an item resolved to no image', async () => {
    const composer = new PromptComposer(imageResolver);
    await composer.trackResolved({ kind: 'description', section: 'Description', label: 'd' }, 'plain text');
    expect(composer.getManifest()[0]).not.toHaveProperty('imageCount');
  });

  it('preserves the order sections were composed in', () => {
    const composer = new PromptComposer(plainResolver);
    composer.track({ kind: 'ticket_header', section: 'Ticket', label: 'T' }, 'a');
    composer.track({ kind: 'comment', section: 'Comments', label: 'c1' }, 'b');
    composer.track({ kind: 'task_instruction', section: 'Your task', label: 'go' }, 'c');

    expect(composer.getManifest().map((m) => m.section)).toEqual(['Ticket', 'Comments', 'Your task']);
  });
});

describe('flattenPrompt reproduces what the SDK receives', () => {
  it('concatenates text blocks verbatim, with no separator', () => {
    const blocks: PromptContentBlock[] = [
      { type: 'text', text: '# Ticket\n' },
      { type: 'text', text: 'body' },
    ];
    expect(flattenPrompt(blocks)).toBe('# Ticket\nbody');
  });

  it('marks an image inline so its position in the prompt stays visible', () => {
    const blocks: PromptContentBlock[] = [
      { type: 'text', text: 'before' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      { type: 'text', text: 'after' },
    ];
    expect(flattenPrompt(blocks)).toBe('before\n[image attachment]\nafter');
  });
});

describe('buildExecutionContextData', () => {
  it('carries both prompts verbatim alongside the manifest', () => {
    const composer = new PromptComposer(plainResolver);
    composer.track({ kind: 'ticket_header', section: 'Ticket', label: 'Fix login' }, '# Ticket: Fix login');

    const data = buildExecutionContextData({
      executionId: 'exec-1',
      systemPrompt: 'You are an agent.',
      promptBlocks: composer.getBlocks(),
      manifest: composer.getManifest(),
      model: 'claude-x',
      effectiveMode: 'edit',
      maxTurns: 12,
    });

    expect(data.systemPromptRaw).toBe('You are an agent.');
    expect(data.userPromptRaw).toBe('# Ticket: Fix login');
    expect(data.manifest).toHaveLength(1);
    expect(data.imageCount).toBe(0);
    expect(data).toMatchObject({ executionId: 'exec-1', model: 'claude-x', effectiveMode: 'edit', maxTurns: 12 });
  });

  it('counts every image block in the prompt', async () => {
    const composer = new PromptComposer(imageResolver);
    await composer.trackResolved({ kind: 'description', section: 'Description', label: 'd' }, 'a[[img]]b');
    await composer.trackResolved({ kind: 'comment', section: 'Comments', label: 'c' }, 'c[[img]]d');

    const data = buildExecutionContextData({
      executionId: 'exec-2',
      systemPrompt: '',
      promptBlocks: composer.getBlocks(),
      manifest: composer.getManifest(),
      model: 'claude-x',
    });

    expect(data.imageCount).toBe(2);
  });
});
