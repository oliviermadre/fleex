import { describe, it, expect } from 'vitest';
import { NATIVE_OPERATIONS, NATIVE_OPERATION_IDS, getNativeOperation } from '@fleex/shared';
import { NativeOperationRegistry } from '../../src/application/services/native-operations/registry.js';
import { TICKET_OPERATIONS } from '../../src/application/services/native-operations/ticket-operations.js';

/**
 * The registry is what makes native steps open/closed: adding an operation must
 * be "one descriptor + one implementation", nothing else. These tests are the
 * contract that keeps that promise honest — a descriptor without an
 * implementation would produce a form the author can fill and the run then
 * rejects; an implementation without a descriptor would be unreachable dead code
 * that no form can configure.
 */
describe('native operation registry', () => {
  const registry = new NativeOperationRegistry();

  it('exposes exactly the operations that have a descriptor — no orphan on either side', () => {
    expect([...registry.ids()].sort()).toEqual([...NATIVE_OPERATION_IDS].sort());
  });

  it('registers every implementation exactly once', () => {
    const ids = TICKET_OPERATIONS.map((op) => op.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves an operation to its own implementation, not a neighbour', () => {
    for (const id of NATIVE_OPERATION_IDS) {
      expect(registry.get(id)?.id).toBe(id);
    }
  });

  it('reports unknown operations rather than falling back to a default', () => {
    expect(registry.has('ticket.self_destruct')).toBe(false);
    expect(registry.get('ticket.self_destruct')).toBeUndefined();
  });

  it('gives every declared parameter something the editor can render', () => {
    // The config form is generated from `params`; a param with no type (or an
    // enum with no values) would render as a dead field.
    for (const op of NATIVE_OPERATIONS) {
      expect(op.params.length, `${op.id} has no params`).toBeGreaterThan(0);
      for (const param of op.params) {
        expect(param.label, `${op.id}.${param.name} has no label`).toBeTruthy();
        if (param.type === 'enum') {
          expect(param.enum?.length, `${op.id}.${param.name} is an enum with no values`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('only declares conflictsOn fields that one of its params can write', () => {
    // `conflictsOn` is how two actions are detected as fighting over the same
    // ticket field. A typo there silently disables the protection.
    for (const op of NATIVE_OPERATIONS) {
      for (const field of op.conflictsOn ?? []) {
        expect(
          op.params.some((p) => p.name === field),
          `${op.id} declares conflictsOn "${field}" but has no such param`,
        ).toBe(true);
      }
    }
  });

  it('keeps ticket.create the only operation that is not a plain mutation', () => {
    // `apply-native-actions` special-cases exactly one id. If a second creating
    // operation appeared, that special case would silently not apply to it.
    const creators = NATIVE_OPERATIONS.filter((op) => op.id.endsWith('.create'));
    expect(creators.map((op) => op.id)).toEqual(['ticket.create']);
  });

  it('exposes a descriptor for every id it advertises', () => {
    for (const id of NATIVE_OPERATION_IDS) {
      expect(getNativeOperation(id)).toBeDefined();
    }
  });
});
