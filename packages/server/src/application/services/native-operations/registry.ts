import type { NativeOperationImpl } from './types.js';
import { TICKET_OPERATIONS } from './ticket-operations.js';

/**
 * Lookup table for native operation implementations.
 *
 * Adding an operation means appending to `TICKET_OPERATIONS` (server behaviour)
 * and to `NATIVE_OPERATIONS` (shared metadata). Nothing in the executor, the
 * workflow engine or the React editor needs to change.
 */
export class NativeOperationRegistry {
  private readonly byId: Map<string, NativeOperationImpl>;

  constructor(operations: readonly NativeOperationImpl[] = TICKET_OPERATIONS) {
    this.byId = new Map(operations.map((op) => [op.id, op]));
  }

  get(id: string): NativeOperationImpl | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }
}
