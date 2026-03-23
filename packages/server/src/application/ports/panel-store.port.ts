import type { PanelEntity } from '../../domain/entities/panel.entity.js';

export interface PanelStorePort {
  getAll(): Promise<PanelEntity[]>;
  getById(id: string): Promise<PanelEntity | null>;
  getByName(name: string): Promise<PanelEntity | null>;
  getEnabled(): Promise<PanelEntity[]>;
  save(panel: PanelEntity): Promise<void>;
  remove(id: string): Promise<void>;
}
