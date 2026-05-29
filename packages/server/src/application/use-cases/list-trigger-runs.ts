import type { TriggerRunStorePort } from '../ports/trigger-run-store.port.js';
import type { TriggerRun } from '@fleex/shared';

export class ListTriggerRunsUseCase {
  constructor(private readonly triggerRunStore: TriggerRunStorePort) {}

  async execute(triggerId: string, limit = 50): Promise<TriggerRun[]> {
    const runs = await this.triggerRunStore.getByTrigger(triggerId, limit);
    return runs.map((r) => r.toDTO());
  }
}
