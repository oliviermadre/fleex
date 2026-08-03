import { describe, it, expect } from 'vitest';

import type { StorageDriverName } from '@fleex/shared';

import { resolveCapabilities, type CapabilitySource } from '../../src/application/capabilities.js';

const present = {} as unknown;

function source(overrides: Partial<CapabilitySource> = {}): CapabilitySource {
  return {
    storageDriver: 'sqlite',
    workflowTemplateStore: present,
    workflowRunStore: present,
    stepRunStore: present,
    createWorkflowRun: present,
    resolveHumanGate: present,
    retryStep: present,
    cancelWorkflowRun: present,
    kvStore: present,
    ...overrides,
  };
}

describe('resolveCapabilities', () => {
  it('reports workflows available when every store and use case is wired', () => {
    expect(resolveCapabilities(source()).features.workflows).toBe(true);
  });

  it.each([
    'workflowTemplateStore',
    'workflowRunStore',
    'stepRunStore',
    'createWorkflowRun',
    'resolveHumanGate',
    'retryStep',
    'cancelWorkflowRun',
  ] as const)('reports workflows unavailable when %s is missing', (missing) => {
    // Any single missing piece must flip the flag — a half-wired workflow stack
    // is what produced 404s the UI could not explain.
    expect(resolveCapabilities(source({ [missing]: null })).features.workflows).toBe(false);
  });

  it('tracks kvStore independently of workflows', () => {
    const caps = resolveCapabilities(source({ kvStore: null }));
    expect(caps.features.kvStore).toBe(false);
    expect(caps.features.workflows).toBe(true);
  });

  it('flags remote file storage only on supabase', () => {
    const drivers: StorageDriverName[] = ['json', 'sqlite', 'pgsql', 'supabase'];
    const remote = drivers.map(
      (d) => resolveCapabilities(source({ storageDriver: d })).features.remoteFileStorage,
    );
    expect(remote).toEqual([false, false, false, true]);
  });

  it('echoes back the storage driver', () => {
    expect(resolveCapabilities(source({ storageDriver: 'pgsql' })).storageDriver).toBe('pgsql');
  });

  it('reports all four drivers as workflow-capable once fully wired', () => {
    const drivers: StorageDriverName[] = ['json', 'sqlite', 'pgsql', 'supabase'];
    for (const d of drivers) {
      expect(resolveCapabilities(source({ storageDriver: d })).features.workflows).toBe(true);
    }
  });
});
