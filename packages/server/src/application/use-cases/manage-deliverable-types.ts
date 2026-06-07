import {
  DELIVERABLE_RENDERERS,
  normalizeDeliverableTypes,
  isValidDeliverableTypeId,
} from '@fleex/shared';
import type { DeliverableTypeDef, DeliverableRenderer, DeliverableTypeColor, TicketDeliverable } from '@fleex/shared';
import {
  InvalidDeliverableTypeError,
  DeliverableTypeNotFoundError,
  DeliverableTypeConflictError,
  DeliverableTypeInUseError,
  DeliverableNotFoundError,
} from '../../domain/errors.js';
import type { ConfigPort } from '../ports/config.port.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBus } from '../event-bus.js';

export interface DeliverableTypesView {
  types: DeliverableTypeDef[];
  /** deliverable count keyed by type id (includes counts for unknown/legacy types). */
  usage: Record<string, number>;
}

/**
 * Per-workspace deliverable-type backoffice: CRUD over the configured types plus
 * usage reporting and deliverable reassignment (single + bulk + rename migration).
 * The configured list lives in AppConfig.deliverableTypes; mutations persist the
 * full normalized list (system types always retained).
 */
export class ManageDeliverableTypesUseCase {
  constructor(
    private readonly config: ConfigPort,
    private readonly deliverableStore: DeliverableStorePort,
    private readonly logger: LoggerPort,
    private readonly eventBus: EventBus | null = null,
  ) {}

  private current(): DeliverableTypeDef[] {
    return normalizeDeliverableTypes(this.config.get().deliverableTypes);
  }

  private async persist(types: DeliverableTypeDef[]): Promise<void> {
    await this.config.update({ deliverableTypes: types });
  }

  /** Count deliverables grouped by their stored `type` value. */
  async usage(): Promise<Record<string, number>> {
    const all = await this.deliverableStore.getAll();
    const counts: Record<string, number> = {};
    for (const d of all) {
      counts[d.type] = (counts[d.type] ?? 0) + 1;
    }
    return counts;
  }

  async list(): Promise<DeliverableTypesView> {
    return { types: this.current(), usage: await this.usage() };
  }

  async create(input: { id: string; label: string; description?: string; renderer: DeliverableRenderer; color?: DeliverableTypeColor | null }): Promise<DeliverableTypesView> {
    const id = input.id.trim();
    if (!isValidDeliverableTypeId(id)) {
      throw new InvalidDeliverableTypeError(id);
    }
    if (!input.label.trim()) {
      throw new DeliverableTypeConflictError('Label is required');
    }
    this.assertRenderer(input.renderer);

    const types = this.current();
    if (types.some((t) => t.id === id)) {
      throw new DeliverableTypeConflictError(`A type with id "${id}" already exists`);
    }
    types.push({
      id,
      label: input.label.trim(),
      description: input.description?.trim() ?? '',
      renderer: input.renderer,
      ...(this.normalizeColor(input.color) ? { color: this.normalizeColor(input.color)! } : {}),
    });
    await this.persist(types);
    this.logger.info('Deliverable type created', { id });
    return { types, usage: await this.usage() };
  }

  async update(id: string, patch: { label?: string; description?: string; renderer?: DeliverableRenderer; color?: DeliverableTypeColor | null }): Promise<DeliverableTypesView> {
    const types = this.current();
    const target = types.find((t) => t.id === id);
    if (!target) throw new DeliverableTypeNotFoundError(id);
    if (target.system) throw new DeliverableTypeConflictError(`System type "${id}" cannot be edited`);

    if (patch.label !== undefined) {
      if (!patch.label.trim()) throw new DeliverableTypeConflictError('Label is required');
      target.label = patch.label.trim();
    }
    if (patch.description !== undefined) {
      target.description = patch.description.trim();
    }
    if (patch.renderer !== undefined) {
      this.assertRenderer(patch.renderer);
      target.renderer = patch.renderer;
    }
    if (patch.color !== undefined) {
      const color = this.normalizeColor(patch.color);
      if (color) target.color = color;
      else delete target.color;
    }
    await this.persist(types);
    this.logger.info('Deliverable type updated', { id });
    return { types, usage: await this.usage() };
  }

  /** Rename a type id, migrating all existing deliverables from old → new. */
  async rename(oldId: string, newId: string): Promise<{ view: DeliverableTypesView; migrated: number }> {
    const target = newId.trim();
    if (!isValidDeliverableTypeId(target)) throw new InvalidDeliverableTypeError(target);

    const types = this.current();
    const existing = types.find((t) => t.id === oldId);
    if (!existing) throw new DeliverableTypeNotFoundError(oldId);
    if (existing.system) throw new DeliverableTypeConflictError(`System type "${oldId}" cannot be renamed`);
    if (target !== oldId && types.some((t) => t.id === target)) {
      throw new DeliverableTypeConflictError(`A type with id "${target}" already exists`);
    }

    existing.id = target;
    await this.persist(types);
    const migrated = await this.reassignDeliverables(oldId, target);
    this.logger.info('Deliverable type renamed', { from: oldId, to: target, migrated });
    return { view: { types, usage: await this.usage() }, migrated };
  }

  /** Delete a type. Blocked while any deliverable still uses it. */
  async remove(id: string): Promise<DeliverableTypesView> {
    const types = this.current();
    const target = types.find((t) => t.id === id);
    if (!target) throw new DeliverableTypeNotFoundError(id);
    if (target.system) throw new DeliverableTypeConflictError(`System type "${id}" cannot be deleted`);

    const usage = await this.usage();
    const count = usage[id] ?? 0;
    if (count > 0) throw new DeliverableTypeInUseError(id, count);

    const next = types.filter((t) => t.id !== id);
    await this.persist(next);
    this.logger.info('Deliverable type deleted', { id });
    return { types: next, usage };
  }

  /** Bulk reassign every deliverable of `from` to `to`. `to` must be configured. */
  async reassign(from: string, to: string): Promise<{ migrated: number }> {
    const types = this.current();
    if (!types.some((t) => t.id === to)) throw new InvalidDeliverableTypeError(to);
    const migrated = await this.reassignDeliverables(from, to);
    this.logger.info('Deliverables reassigned by type', { from, to, migrated });
    return { migrated };
  }

  /** Change a single deliverable's type. `type` must be configured. */
  async setDeliverableType(deliverableId: string, type: string): Promise<TicketDeliverable> {
    const types = this.current();
    if (!types.some((t) => t.id === type)) throw new InvalidDeliverableTypeError(type);

    const deliverable = await this.deliverableStore.getById(deliverableId);
    if (!deliverable) throw new DeliverableNotFoundError(deliverableId);

    const oldStatus = deliverable.status;
    const oldType = deliverable.type;
    deliverable.setType(type);
    await this.deliverableStore.save(deliverable);

    this.eventBus?.emit({
      type: 'deliverable.updated',
      deliverableId: deliverable.id,
      ticketId: deliverable.ticketId,
      agentName: deliverable.agentName,
      oldStatus,
      newStatus: deliverable.status,
      oldType,
      newType: deliverable.type,
      title: deliverable.title,
      occurredAt: new Date(),
    });

    this.logger.info('Deliverable type changed', { deliverableId, type });
    return deliverable.toDTO();
  }

  private async reassignDeliverables(from: string, to: string): Promise<number> {
    if (from === to) return 0;
    const items = await this.deliverableStore.getAllByType(from);
    for (const d of items) {
      d.setType(to);
      await this.deliverableStore.save(d);
    }
    return items.length;
  }

  private assertRenderer(renderer: string): void {
    if (!(DELIVERABLE_RENDERERS as readonly string[]).includes(renderer)) {
      throw new DeliverableTypeConflictError(`Unknown renderer: ${renderer}`);
    }
  }

  /** Coerce arbitrary input into a valid color pair, or null to clear it. */
  private normalizeColor(color: DeliverableTypeColor | null | undefined): DeliverableTypeColor | null {
    if (!color) return null;
    const bg = typeof color.bg === 'string' ? color.bg.trim() : '';
    const text = typeof color.text === 'string' ? color.text.trim() : '';
    if (!bg || !text) return null;
    return { bg, text };
  }
}
