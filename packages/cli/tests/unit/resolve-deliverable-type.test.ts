import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API layer so we can assert resolution without a running server.
const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:9999',
  apiGet,
}));

import {
  resolveDeliverableType,
  assertValidRenderer,
  resolveColor,
} from '../../src/commands/deliverable-type/_shared.ts';

const VIEW = {
  types: [
    { id: 'spec', label: 'Spec', description: '', renderer: 'markdown' },
    { id: 'diagram', label: 'Diagram', description: '', renderer: 'html' },
  ],
  usage: { spec: 3, diagram: 0 },
};

describe('resolveDeliverableType', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue(VIEW);
  });

  it('resolves an exact type id', async () => {
    const t = await resolveDeliverableType('diagram');
    expect(t.renderer).toBe('html');
  });

  it('resolves case-insensitively', async () => {
    const t = await resolveDeliverableType('SPEC');
    expect(t.id).toBe('spec');
  });

  it('exits when the type is not configured', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(resolveDeliverableType('unknown')).rejects.toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });
});

describe('assertValidRenderer', () => {
  it('accepts markdown and html', () => {
    expect(() => assertValidRenderer('markdown')).not.toThrow();
    expect(() => assertValidRenderer('html')).not.toThrow();
  });

  it('rejects an unknown renderer', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => assertValidRenderer('pdf')).toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });
});

describe('resolveColor', () => {
  it('maps a preset key to a concrete {bg,text} pair', () => {
    const color = resolveColor('violet');
    expect(color.bg).toMatch(/rgba/);
    expect(color.text).toMatch(/^#/);
  });

  it('is case-insensitive', () => {
    expect(() => resolveColor('BLUE')).not.toThrow();
  });

  it('rejects an unknown colour key', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(() => resolveColor('chartreuse')).toThrow('exit');
    exit.mockRestore();
    stderr.mockRestore();
  });
});
