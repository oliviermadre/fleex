import { TriggerNotFoundError } from '../../domain/errors.js';
import type { TriggerStorePort } from '../ports/trigger-store.port.js';

export class DeleteTriggerUseCase {
  constructor(private readonly store: TriggerStorePort) {}

  async execute(id: string): Promise<void> {
    const trigger = await this.store.getById(id);
    if (!trigger) throw new TriggerNotFoundError(id);
    // trigger_runs are removed via the FK ON DELETE CASCADE.
    await this.store.delete(id);
  }
}
