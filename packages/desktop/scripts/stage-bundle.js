/**
 * Stage the compiled artifacts under packages/desktop/build/, ready for
 * electron-builder's `extraResources`. Run via `bun run build:dmg`.
 *
 * Why a Node script and not a chained shell command:
 *  - we need conditional logic (skip steps already built, copy production deps)
 *  - we need to fail loud with actionable error messages, not silent ENOENTs
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const buildDir = path.join(desktopDir, 'build');

const log = (...args) => console.log('[stage-bundle]', ...args);
const fail = (msg) => {
  console.error('[stage-bundle] FATAL:', msg);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function cpDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function ensureBuilt(label, sourcePath, builder) {
  if (!fs.existsSync(sourcePath)) {
    log(`${label}: building (no ${sourcePath})`);
    builder();
  } else if (process.env.FORCE_REBUILD === '1') {
    log(`${label}: rebuilding (FORCE_REBUILD=1)`);
    builder();
  } else {
    log(`${label}: reusing existing build at ${sourcePath}`);
  }
  if (!fs.existsSync(sourcePath)) {
    fail(`${label} build did not produce ${sourcePath}`);
  }
}

// ── 1. clean previous staging ──────────────────────────────────────────────
log('Clean staging area:', buildDir);
rmrf(buildDir);
fs.mkdirSync(buildDir, { recursive: true });

// ── 2. compile shared (needed by server tsc) ──────────────────────────────
ensureBuilt(
  'shared',
  path.join(repoRoot, 'packages', 'shared', 'dist', 'index.js'),
  () => run('bun', ['run', 'build'], { cwd: path.join(repoRoot, 'packages', 'shared') }),
);

// ── 3. compile gateway → standalone Bun binary ────────────────────────────
const gatewaySrc = path.join(repoRoot, 'packages', 'host-gateway', 'dist', 'gateway');
ensureBuilt(
  'gateway',
  gatewaySrc,
  () => run('bun', ['run', 'build'], { cwd: path.join(repoRoot, 'packages', 'host-gateway') }),
);
fs.copyFileSync(gatewaySrc, path.join(buildDir, 'gateway'));
fs.chmodSync(path.join(buildDir, 'gateway'), 0o755);
log('gateway → build/gateway');

// ── 4. compile server (tsc → dist/) + ship its production node_modules ────
const serverDist = path.join(repoRoot, 'packages', 'server', 'dist');
ensureBuilt(
  'server',
  path.join(serverDist, 'main.js'),
  () => run('bun', ['run', 'build'], { cwd: path.join(repoRoot, 'packages', 'server') }),
);
cpDir(serverDist, path.join(buildDir, 'server', 'dist'));

// Server uses ESM with `.js` imports of workspace siblings — at runtime under
// Electron's Node it resolves them via packages/server/node_modules/@fleex/shared
// which is a workspace symlink. We need to materialise the shared package and
// the production dependencies into the bundle.
//
// Strategy: install a self-contained node_modules dir at build/server using
// `bun install --production` against packages/server/package.json. This is
// expensive (~30s on first run) but avoids hand-rolling a dependency walker.
log('Installing production dependencies for server bundle…');
const serverPkgSrc = path.join(repoRoot, 'packages', 'server', 'package.json');
const serverStageDir = path.join(buildDir, 'server');
fs.copyFileSync(serverPkgSrc, path.join(serverStageDir, 'package.json'));
// Materialise the workspace `@fleex/shared` package inside server's node_modules,
// since bun install --production will see it as `workspace:*` and refuse without
// a workspace root. We point npm/bun to install via a synthetic resolver.
const sharedSrcDir = path.join(repoRoot, 'packages', 'shared');
const sharedStageDir = path.join(serverStageDir, 'vendor', 'shared');
cpDir(sharedSrcDir, sharedStageDir);
// Strip the symlinked node_modules that may exist under the worktree shared
rmrf(path.join(sharedStageDir, 'node_modules'));

// Rewrite the staged package.json to point @fleex/shared at the vendored copy.
const stagedPkg = JSON.parse(fs.readFileSync(path.join(serverStageDir, 'package.json'), 'utf8'));
if (stagedPkg.dependencies && stagedPkg.dependencies['@fleex/shared']) {
  stagedPkg.dependencies['@fleex/shared'] = `file:./vendor/shared`;
}
// `scripts` aren't relevant inside the bundle and they reference dev tooling
// we don't want to invoke during `bun install --production`.
delete stagedPkg.scripts;
fs.writeFileSync(
  path.join(serverStageDir, 'package.json'),
  JSON.stringify(stagedPkg, null, 2),
);

run('bun', ['install', '--production', '--no-save'], { cwd: serverStageDir });

// node_modules can pull in dev-only artifacts via lifecycle scripts — prune.
rmrf(path.join(serverStageDir, 'node_modules', '.cache'));

log('server → build/server');

// ── 5. compile web → dist/ ────────────────────────────────────────────────
const webDist = path.join(repoRoot, 'packages', 'web', 'dist');
ensureBuilt(
  'web',
  path.join(webDist, 'index.html'),
  () => run('bun', ['run', 'build'], { cwd: path.join(repoRoot, 'packages', 'web') }),
);
cpDir(webDist, path.join(buildDir, 'web', 'dist'));
log('web → build/web');

log('Bundle staging complete. Artifacts in', buildDir);
