import { describe, it, expect } from 'vitest';
import { SessionEntity } from '../../src/domain/entities.js';

function createSession(overrides?: Partial<ConstructorParameters<typeof SessionEntity>>) {
  return new SessionEntity(
    'test-id',
    'fleex_shell_abc12345',
    'shell',
    'running',
    '/tmp/test',
    new Date('2025-01-01'),
    null,
    'myorg',
    'myrepo',
    'main',
    'https://github.com/myorg/myrepo.git',
  );
}

describe('SessionEntity', () => {
  it('should create a session entity', () => {
    const session = createSession();
    expect(session.id).toBe('test-id');
    expect(session.type).toBe('shell');
    expect(session.status).toBe('running');
  });

  it('should mark as attached', () => {
    const session = createSession();
    expect(session.lastAttachedAt).toBeNull();
    session.markAttached();
    expect(session.lastAttachedAt).toBeInstanceOf(Date);
  });

  it('should mark as dead', () => {
    const session = createSession();
    expect(session.status).toBe('running');
    session.markDead();
    expect(session.status).toBe('dead');
  });

  it('should detect managed sessions', () => {
    const session = createSession();
    expect(session.isManaged()).toBe(true);
  });

  it('should convert to DTO', () => {
    const session = createSession();
    const dto = session.toDTO();
    expect(dto.id).toBe('test-id');
    expect(dto.tmuxName).toBe('fleex_shell_abc12345');
    expect(dto.type).toBe('shell');
    expect(dto.status).toBe('running');
    expect(dto.cwd).toBe('/tmp/test');
    expect(dto.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(dto.lastAttachedAt).toBeNull();
    expect(dto.repositoryOrg).toBe('myorg');
    expect(dto.repositoryName).toBe('myrepo');
    expect(dto.worktreeBranch).toBe('main');
  });
});
