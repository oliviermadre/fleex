import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STATUS_MODEL,
  Status,
  resolveAnchor,
  statusAnchors,
  findStatusColumn,
  validateStatusModel,
  type StatusModel,
  type StatusColumn,
} from '@fleex/shared';

function col(over: Partial<StatusColumn> & Pick<StatusColumn, 'key'>): StatusColumn {
  return {
    label: over.key,
    color: 'gray',
    order: 0,
    startable: false,
    active: false,
    terminal: false,
    outcome: null,
    anchors: [],
    collapsedByDefault: false,
    ...over,
  };
}

/** A minimal model satisfying every invariant, for negative-test mutation. */
function validModel(): StatusModel {
  return {
    columns: [
      col({ key: 'todo', startable: true, anchors: ['defaultNew', 'agentQueue'] }),
      col({ key: 'doing', active: true, anchors: ['workStart'] }),
      col({ key: 'done', terminal: true, outcome: 'completed', anchors: ['mergeLanding'] }),
    ],
  };
}

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
        { key: 'icebox', label: 'Icebox', color: 'gray', order: 0, startable: true, active: false, terminal: false, outcome: null, anchors: ['defaultNew'], collapsedByDefault: false },
        { key: 'shipped', label: 'Shipped', color: 'green', order: 1, startable: false, active: false, terminal: true, outcome: 'completed', anchors: ['mergeLanding'], collapsedByDefault: false },
      ],
    };
    expect(Status.of('icebox', model).isStartable()).toBe(true);
    expect(Status.of('shipped', model).isCompleted()).toBe(true);
    // 'doing' is not part of this model → no roles
    expect(Status.of('doing', model).isActive()).toBe(false);
    expect(findStatusColumn('shipped', model)?.label).toBe('Shipped');
  });
});

describe('validateStatusModel', () => {
  it('accepts the built-in default model', () => {
    expect(validateStatusModel(DEFAULT_STATUS_MODEL)).toEqual({ ok: true });
  });

  it('accepts a minimal valid custom model', () => {
    expect(validateStatusModel(validModel())).toEqual({ ok: true });
  });

  it('rejects an empty model', () => {
    const res = validateStatusModel({ columns: [] });
    expect(res.ok).toBe(false);
  });

  it('rejects duplicate keys', () => {
    const m = validModel();
    const res = validateStatusModel({ columns: [...m.columns, col({ key: 'todo', startable: true })] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('rejects a missing anchor', () => {
    const m = validModel();
    // drop the agentQueue anchor
    const columns = m.columns.map((c) =>
      c.key === 'todo' ? { ...c, anchors: ['defaultNew'] as StatusColumn['anchors'] } : c,
    );
    const res = validateStatusModel({ columns });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('agentQueue'))).toBe(true);
  });

  it('rejects an anchor filled by two columns', () => {
    const m = validModel();
    const columns = [...m.columns, col({ key: 'doing2', active: true, anchors: ['workStart'] })];
    const res = validateStatusModel({ columns });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('workStart'))).toBe(true);
  });

  it('rejects a mergeLanding column that is not a completed terminal', () => {
    const columns = [
      col({ key: 'todo', startable: true, anchors: ['defaultNew', 'agentQueue'] }),
      col({ key: 'doing', active: true, anchors: ['workStart', 'mergeLanding'] }),
      col({ key: 'done', terminal: true, outcome: 'completed' }),
    ];
    const res = validateStatusModel({ columns });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('mergeLanding'))).toBe(true);
  });

  it('rejects a terminal column without an outcome', () => {
    const m = validModel();
    const columns = m.columns.map((c) => (c.key === 'done' ? { ...c, outcome: null } : c));
    // done also holds mergeLanding → will additionally fail that rule, but the
    // outcome rule must fire.
    const res = validateStatusModel({ columns });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.some((e) => e.includes('outcome'))).toBe(true);
  });

  it('requires at least one startable and one active column', () => {
    const noStartable = validModel().columns.map((c) => ({ ...c, startable: false }));
    expect(validateStatusModel({ columns: noStartable }).ok).toBe(false);
  });
});
