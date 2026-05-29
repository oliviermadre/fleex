import { randomUUID } from 'node:crypto';
import { TriggerEntity } from '../../domain/entities/trigger.entity.js';
import type { TriggerStorePort } from '../ports/trigger-store.port.js';
import type { CreateTriggerInput } from '@fleex/shared';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'trigger';
}

export class CreateTriggerUseCase {
  constructor(private readonly store: TriggerStorePort) {}

  async execute(input: CreateTriggerInput): Promise<TriggerEntity> {
    // Derive a unique slug from the name.
    const baseSlug = slugify(input.name);
    let slug = baseSlug;
    let n = 1;
    while (await this.store.getBySlug(slug)) {
      slug = `${baseSlug}-${++n}`;
    }

    const trigger = TriggerEntity.create({
      id: randomUUID(),
      name: input.name,
      slug,
      emoji: input.emoji,
      description: input.description,
      kind: input.kind,
      config: input.config,
      descriptionMd: input.descriptionMd,
      targetType: input.targetType,
      targetRef: input.targetRef,
      mode: input.mode,
      enabled: input.enabled,
    });
    await this.store.save(trigger);
    return trigger;
  }
}
