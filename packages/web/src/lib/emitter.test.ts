import { describe, it, expect } from 'vitest';
import { parseEmitter } from './emitter';

describe('parseEmitter', () => {
  it('reads the primitive kind from the prefix and drops it from the label', () => {
    expect(parseEmitter('workflow:Spec Dev PR')).toEqual({ kind: 'workflow', name: 'Spec Dev PR' });
    expect(parseEmitter('panel:archi-committee')).toEqual({ kind: 'panel', name: 'archi-committee' });
    expect(parseEmitter('skill:ship')).toEqual({ kind: 'skill', name: 'ship' });
  });

  it('treats an unprefixed author as a persona', () => {
    expect(parseEmitter('jarvis')).toEqual({ kind: 'persona', name: 'jarvis' });
    expect(parseEmitter('system')).toEqual({ kind: 'persona', name: 'system' });
  });

  it('drops the step suffix so every step reads as its workflow', () => {
    expect(parseEmitter('workflow:Spec Dev PR → Check Spec')).toEqual({
      kind: 'workflow',
      name: 'Spec Dev PR',
    });
  });

  it('keeps a name containing a colon that is not a known prefix', () => {
    expect(parseEmitter('build:er')).toEqual({ kind: 'persona', name: 'build:er' });
  });

  it('falls back to the raw value rather than an empty label', () => {
    expect(parseEmitter('workflow:')).toEqual({ kind: 'workflow', name: 'workflow:' });
  });
});
