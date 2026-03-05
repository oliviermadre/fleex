import { createHash, randomBytes } from 'node:crypto';
import type { AgentToken, AgentTokenCreated } from '@fleex/shared';

export class ApiTokenEntity {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly prefix: string,
    public readonly hashedSecret: string,
    public lastUsedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  static create(params: { id: string; name: string }): { entity: ApiTokenEntity; secret: string } {
    const secret = `fleex_${randomBytes(32).toString('hex')}`;
    const prefix = secret.slice(0, 8);
    const hashedSecret = createHash('sha256').update(secret).digest('hex');
    const entity = new ApiTokenEntity(
      params.id,
      params.name,
      prefix,
      hashedSecret,
      null,
      new Date(),
    );
    return { entity, secret };
  }

  static hashToken(plaintextToken: string): string {
    return createHash('sha256').update(plaintextToken).digest('hex');
  }

  verify(plaintextToken: string): boolean {
    const hash = ApiTokenEntity.hashToken(plaintextToken);
    return hash === this.hashedSecret;
  }

  markUsed(): void {
    this.lastUsedAt = new Date();
  }

  toDTO(): AgentToken {
    return {
      id: this.id,
      name: this.name,
      prefix: this.prefix,
      lastUsedAt: this.lastUsedAt?.toISOString() ?? null,
      createdAt: this.createdAt.toISOString(),
    };
  }

  toCreatedDTO(secret: string): AgentTokenCreated {
    return {
      ...this.toDTO(),
      secret,
    };
  }
}
