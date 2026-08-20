import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeLoadFailures, missingPackageFrom, type LoadFailure } from '../../src/core/program.ts';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * What a freshly cloned checkout does before anything has been installed or
 * built.
 *
 * A clone plus `bun install` left the CLI missing fifteen commands, because
 * `@fleex/shared` resolved to a `dist/` that only exists after a build. The
 * commands that vanished included the ones you would reach for to fix it, and the
 * only diagnosis was fifteen copies of the same resolution error.
 */
describe('@fleex/shared resolution', () => {
  it('resolves to TypeScript source under Bun, so no build is required', () => {
    // The guard that matters: everything Bun runs — the CLI, migrations, hooks,
    // the dev server — must work on a checkout that has never been built. Drop
    // this condition and `fleex --help` loses a third of its commands again.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoDir, 'packages/shared/package.json'), 'utf8'),
    ) as { exports: Record<string, Record<string, string>> };

    expect(manifest.exports['.']!['bun']).toBe('./src/index.ts');
  });

  it('still resolves to the build for everything else', () => {
    // Production runs the compiled server under Node, which never sets the `bun`
    // condition — pointing the default at source would ship unrunnable code.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoDir, 'packages/shared/package.json'), 'utf8'),
    ) as { exports: Record<string, Record<string, string>> };

    expect(manifest.exports['.']!['default']).toBe('./dist/index.js');
  });

  it('offers the bun condition before the default', () => {
    // Export conditions are matched in declaration order, so a `default` placed
    // first would win and silence the condition above without failing anything.
    const keys = Object.keys(
      (JSON.parse(
        fs.readFileSync(path.join(repoDir, 'packages/shared/package.json'), 'utf8'),
      ) as { exports: Record<string, Record<string, string>> }).exports['.']!,
    );
    expect(keys).toContain('bun');
    expect(keys.indexOf('bun')).toBeLessThan(keys.indexOf('default'));
  });
});

/**
 * Resolution on a checkout with no `node_modules` at all.
 *
 * The export condition above covers an installed checkout. A bare clone has no
 * workspace symlink to follow, so Bun falls back to auto-install, which cannot
 * fetch a `workspace:*` package from a registry — it reports the failure at
 * process teardown, eight times, long after whatever the CLI was doing. That is
 * why `fleex --help` looked clean (it exits immediately) while `fleex
 * self-update` ended in a wall of errors after saying it had succeeded.
 *
 * A `paths` mapping resolves the sibling package directly, with no install
 * involved. It points at the same file the `bun` export condition selects, so
 * the two cannot drift.
 */
describe('CLI module resolution on a bare clone', () => {
  const tsconfig = JSON.parse(
    fs.readFileSync(path.join(repoDir, 'packages/cli/tsconfig.json'), 'utf8'),
  ) as { compilerOptions: { baseUrl?: string; paths?: Record<string, string[]> } };

  it('maps @fleex/shared to the sibling source', () => {
    expect(tsconfig.compilerOptions.paths?.['@fleex/shared']).toEqual(['../shared/src/index.ts']);
  });

  it('declares baseUrl, without which Bun ignores paths entirely', () => {
    // Measured: paths alone left all eight errors in place and the CLI still
    // fifteen commands short. The mapping is inert until baseUrl is set.
    expect(tsconfig.compilerOptions.baseUrl).toBe('.');
  });

  it('points at a file that exists', () => {
    const target = path.join(repoDir, 'packages/cli', tsconfig.compilerOptions.paths!['@fleex/shared']![0]!);
    expect(fs.existsSync(target)).toBe(true);
  });
});

describe('missingPackageFrom', () => {
  it('names the package behind an unresolved bare specifier', () => {
    expect(missingPackageFrom(
      "Cannot find module '@fleex/shared' from '/repo/packages/cli/src/commands/export/index.ts'",
    )).toBe('@fleex/shared');
  });

  it('ignores a relative specifier, which is a broken module and not a missing dep', () => {
    expect(missingPackageFrom(
      "Cannot find module './helpers.ts' from '/repo/packages/cli/src/commands/x/index.ts'",
    )).toBeNull();
  });

  it('ignores an absolute specifier', () => {
    expect(missingPackageFrom("Cannot find module '/opt/thing' from '/repo/x.ts'")).toBeNull();
  });

  it('returns null for any other failure', () => {
    expect(missingPackageFrom('SyntaxError: Unexpected token')).toBeNull();
  });
});

function failure(file: string, message: string): LoadFailure {
  return { file, message, missingPackage: missingPackageFrom(message) };
}

const notInstalled = (file: string) =>
  failure(file, `Cannot find module '@fleex/shared' from '/repo/packages/cli/src/commands/${file}'`);

describe('describeLoadFailures', () => {
  it('says nothing when every command loaded', () => {
    expect(describeLoadFailures([], '/repo')).toBeNull();
  });

  it('states an uninstalled dependency once, however many commands it took down', () => {
    const report = describeLoadFailures([
      notInstalled('export/index.ts'),
      notInstalled('import/index.ts'),
      notInstalled('ticket/deliverable/add/index.ts'),
    ], '/repo')!;

    expect(report.match(/@fleex\/shared/g)).toHaveLength(1);
    expect(report).toContain('3 commands unavailable');
  });

  it('names the groups that disappeared from help, not the modules', () => {
    // The reader is looking at `--help` and wondering what is missing from it.
    const report = describeLoadFailures([
      notInstalled('ticket/deliverable/add/index.ts'),
      notInstalled('ticket/deliverable/update/index.ts'),
      notInstalled('workflow/show/index.ts'),
    ], '/repo')!;

    expect(report).toContain('Missing: ticket, workflow');
    expect(report).not.toContain('deliverable/add');
  });

  it('gives the command that fixes it', () => {
    const report = describeLoadFailures([notInstalled('export/index.ts')], '/srv/fleex')!;
    expect(report).toContain('cd /srv/fleex && bun install');
  });

  it('reports a genuinely broken module on its own line', () => {
    // Collapsing this into "run bun install" would send the reader after a
    // dependency problem that does not exist.
    const report = describeLoadFailures([
      failure('agent/index.ts', 'SyntaxError: Unexpected token )'),
    ], '/repo')!;

    expect(report).toContain('agent/index.ts failed to load');
    expect(report).toContain('SyntaxError');
    expect(report).not.toContain('bun install');
  });

  it('reports both causes when they occur together', () => {
    const report = describeLoadFailures([
      failure('agent/index.ts', 'SyntaxError: Unexpected token )'),
      notInstalled('export/index.ts'),
    ], '/repo')!;

    expect(report).toContain('agent/index.ts failed to load');
    expect(report).toContain('1 command unavailable');
  });

  it('treats a missing default export as that module\'s own problem', () => {
    const report = describeLoadFailures([
      { file: 'agent/index.ts', message: 'no default export', missingPackage: null },
    ], '/repo')!;
    expect(report).toContain('no default export');
  });
});
