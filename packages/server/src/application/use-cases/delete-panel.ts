import { PanelNotFoundError } from '../../domain/errors.js';
import type { PanelStorePort } from '../ports/panel-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class DeletePanelUseCase {
  constructor(
    private readonly panelStore: PanelStorePort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(id: string): Promise<void> {
    const panel = await this.panelStore.getById(id);
    if (!panel) {
      throw new PanelNotFoundError(id);
    }

    await this.panelStore.remove(id);

    this.logger.info('Panel deleted', { id, name: panel.name });
  }
}
