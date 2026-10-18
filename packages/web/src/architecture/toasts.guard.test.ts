import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { findToastViolations, formatViolation, type SourceFile } from './toastGuard';
import { FLOATING_SURFACES } from './floating-surfaces.allowlist';

/**
 * Fleex has ONE toast (docs/adr/0001-single-toast.md). The Focus "Annuler"
 * pill was born because nothing stopped a second surface from being built;
 * this test is what stops the next one. Its failure message tells the author
 * (human or LLM) exactly what to use instead.
 */

const SRC = path.resolve(__dirname, '..');

function readSources(dir: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(SRC, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (rel !== 'architecture') files.push(...readSources(full));
    } else if (/\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      files.push({ path: rel, content: fs.readFileSync(full, 'utf8') });
    }
  }
  return files;
}

describe('one toast in Fleex', () => {
  it('no source file builds its own toast, snackbar, floating notice or expiry bar', () => {
    const violations = findToastViolations(readSources(SRC), FLOATING_SURFACES);
    // Throw the formatted messages so they read as instructions in the test output.
    if (violations.length) throw new Error('\n' + violations.map(formatViolation).join('\n\n'));
  });

  it('every allowlisted floating surface still exists and says why', () => {
    for (const { path: p, reason } of FLOATING_SURFACES) {
      expect(fs.existsSync(path.join(SRC, p)), `${p} is allowlisted but gone — remove the entry`).toBe(true);
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});

describe('the guard catches each way a second toast gets built', () => {
  const check = (file: SourceFile, allow: { path: string }[] = []) => findToastViolations([file], allow);

  it('R1 — importing the internal store instead of lib/toast', () => {
    const v = check({ path: 'components/boards/BoardHeader.tsx', content: "import { useToastStore } from '../../stores/toastStore';" });
    expect(v.map((x) => x.rule)).toEqual(['R1']);
    expect(check({ path: 'lib/toast.ts', content: "import { useToastStore } from '../stores/toastStore';" })).toEqual([]);
  });

  it('R2 — a hand-made toast component, declared or rendered (the prototype.html copy)', () => {
    const decl = check({ path: 'components/inbox/InboxView.tsx', content: 'function UndoToast({ label }: Props) {' });
    const jsx = check({ path: 'components/inbox/InboxView.tsx', content: '  return <MySnackbar label={l} />;' });
    expect(decl.map((x) => x.rule)).toEqual(['R2']);
    expect(jsx.map((x) => x.rule)).toEqual(['R2']);
  });

  it('R2 — ignores the one <Toaster/>, TS generics and non-component helpers', () => {
    const ok = [
      '<Toaster linksEnabled={false} />',
      'const tones: Record<ToastTone, string> = {};',
      'const undoToastId = (key: string) => key;',
      'function clearStartToast(runId: string) {}',
    ].join('\n');
    expect(check({ path: 'App.tsx', content: ok })).toEqual([]);
  });

  it('R3 — a floating corner/centre box, unless allowlisted with a reason', () => {
    const file = { path: 'components/work/SyncNotice.tsx', content: '<div className="fixed top-4 right-4 z-50 rounded-md">' };
    expect(check(file).map((x) => x.rule)).toEqual(['R3']);
    expect(check({ ...file, content: '<div className="fixed bottom-12 left-1/2 -translate-x-1/2">' }).map((x) => x.rule)).toEqual(['R3']);
    expect(check(file, [{ path: 'components/work/SyncNotice.tsx' }])).toEqual([]);
    expect(check({ path: 'x.tsx', content: '<div className="fixed inset-0 z-50">' })).toEqual([]); // a modal backdrop
  });

  it('R4 — a shrinking-width (or scaleX) expiry bar, inline or in CSS', () => {
    const inline = check({ path: 'components/inbox/InboxView.tsx', content: "<style>{'@keyframes x{from{width:100%}to{width:0}}'}</style>" });
    const css = check({ path: 'index.css', content: '@keyframes bar {\n  from { transform: scaleX(1); }\n  to { transform: scaleX(0); }\n}' });
    expect(inline.map((x) => x.rule)).toEqual(['R4']);
    expect(css.map((x) => x.rule)).toEqual(['R4']);
    expect(check({ path: 'index.css', content: '@keyframes fade { from { opacity: 0 } }' })).toEqual([]);
  });

  it('the message tells the author what to do instead', () => {
    const [v] = check({ path: 'components/inbox/InboxView.tsx', content: 'function UndoToast() {}' });
    const msg = formatViolation(v!);
    expect(msg).toContain('src/components/inbox/InboxView.tsx:1 (rule R2');
    expect(msg).toContain("import { toast } from");
    expect(msg).toContain('Extend ToastInput in src/lib/toast.ts');
    expect(msg).toContain('floating-surfaces.allowlist.ts');
    expect(msg).toContain('docs/adr/0001-single-toast.md');
  });
});
