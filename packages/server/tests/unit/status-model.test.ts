import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STATUS_MODEL,
  Status,
  resolveAnchor,
  statusAnchors,
  findStatusColumn,
  type StatusModel,
} from '@fleex/shared';

describe('DEFAULT_STATUS_MODEL', () => {
  it('exposes the six historical columns in order', () => {
    expect(DEFAULT_STATUS_MODEL.columns.map((c) => c.key)).toEqual([
      'backlog', 'todo', 'doing', 'reviewing', 'done', 'cancelled',
    ]);
  });

  it('classifies predicate roles exactly as before the refactor', () => {
    const startable = DEFAULT_STATUS_MODEL.columns.filter((c) => c.startable).map((c) => c.key);
    const active = DEFAULT_STATUS_MODEL.columns.filter((c) => c.active).map((c) => c.key);
    const terminal = DEFAULT_STATUS_MODEL.columns.filter((c) => c.terminal).map((c) => c.key);
    expect(startable).toEqual(['backlog', 'todo']);
    expect(active).toEqual(['doing', 'reviewing']);
    expect(terminal).toEqual(['done', 'cancelled']);
  });
});

describe('Status value object (default model)', () => {
  it('reports startable roles', () => {
    expect(Status.of('backlog').isStartable()).toBe(true);
    expect(Status.of('todo').isStartable()).toBe(true);
    expect(Status.of('doing').isStartable()).toBe(false);
  });

  it('reports active roles', () => {
    expect(Status.of('doing').isActive()).toBe(true);
    expect(Status.of('reviewing').isActive()).toBe(true);
    expect(Status.of('todo').isActive()).toBe(false);
  });

  it('reports terminal roles and outcomes', () => {
    expect(Status.of('done').isTerminal()).toBe(true);
    expect(Status.of('cancelled').isTerminal()).toBe(true);
    expect(Status.of('doing').isTerminal()).toBe(false);

    expect(Status.of('done').isCompleted()).toBe(true);
    expect(Status.of('done').isCancelled()).toBe(false);
    expect(Status.of('cancelled').isCancelled()).toBe(true);
    expect(Status.of('cancelled').isCompleted()).toBe(false);
    expect(Status.of('done').outcome).toBe('completed');
    expect(Status.of('cancelled').outcome).toBe('abandoned');
  });

  it('reports anchor membership', () => {
    expect(Status.of('backlog').fills('defaultNew')).toBe(true);
    expect(Status.of('todo').fills('agentQueue')).toBe(true);
    expect(Status.of('doing').fills('workStart')).toBe(true);
    expect(Status.of('done').fills('mergeLanding')).toBe(true);
    expect(Status.of('reviewing').fills('workStart')).toBe(false);
  });

  it('treats an unknown key as having no roles', () => {
    const s = Status.of('nonexistent');
    expect(s.isStartable()).toBe(false);
    expect(s.isActive()).toBe(false);
    expect(s.isTerminal()).toBe(false);
    expect(s.isCompleted()).toBe(false);
    expect(s.outcome).toBeNull();
    expect(s.fills('workStart')).toBe(false);
  });
});

describe('anchor resolution (default model)', () => {
  it('resolves each anchor to its single column', () => {
    expect(resolveAnchor('defaultNew')).toBe('backlog');
    expect(resolveAnchor('workStart')).toBe('doing');
    expect(resolveAnchor('agentQueue')).toBe('todo');
    expect(resolveAnchor('mergeLanding')).toBe('done');
  });

  it('exposes the same values via the statusAnchors helper', () => {
    expect(statusAnchors.defaultNew()).toBe('backlog');
    expect(statusAnchors.workStart()).toBe('doing');
    expect(statusAnchors.agentQueue()).toBe('todo');
    expect(statusAnchors.mergeLanding()).toBe('done');
  });

  it('throws when a model has no column for an anchor', () => {
    const emptyModel: StatusModel = { columns: [] };
    expect(() => resolveAnchor('workStart', emptyModel)).toThrow(/workStart/);
  });
});

describe('role resolution against an explicit model', () => {
  it('honours a custom model passed to Status.of', () => {
    const model: StatusModel = {
      columns: [
        { key: 'icebox', label: 'Icebox', order: 0, startable: true, active: false, terminal: false, outcome: null, anchors: ['defaultNew'], collapsedByDefault: false },
        { key: 'shipped', label: 'Shipped', order: 1, startable: false, active: false, terminal: true, outcome: 'completed', anchors: ['mergeLanding'], collapsedByDefault: false },
      ],
    };
    expect(Status.of('icebox', model).isStartable()).toBe(true);
    expect(Status.of('shipped', model).isCompleted()).toBe(true);
    // 'doing' is not part of this model → no roles
    expect(Status.of('doing', model).isActive()).toBe(false);
    expect(findStatusColumn('shipped', model)?.label).toBe('Shipped');
  });
});
