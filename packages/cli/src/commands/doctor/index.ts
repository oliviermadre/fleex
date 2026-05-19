import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { CommandDef } from '../../core/types.ts';
import { c } from '../../core/colors.ts';
import { resolveInstance } from '../../core/instance.ts';
import { SERVICES, loadPorts, type Service } from '../../core/ports.ts';
import { isRunning } from '../../core/process.ts';
import { MIN_BUN_VERSION, versionGte } from '../../core/version.ts';

interface ToolStatus {
  installed: boolean;
  version?: string;
  authenticated?: boolean | null;
}

/**
 * Probe `gh auth status`. Returns a "boolean | null" auth state:
 *  - null  → command not present
 *  - false → present but not authenticated
 *  - true  → present and authenticated
 */
function probeGhAuth(): ToolStatus {
  const which = spawnSync('which', ['gh']);
  if (which.status !== 0) return { installed: false, authenticated: null };
  const ver = spawnSync('gh', ['--version'], { encoding: 'utf8' });
  const versionLine = ver.stdout.split('\n')[0] ?? '';
  const versionMatch = versionLine.match(/(\d+\.\d+\.\d+)/);
  const version = versionMatch ? versionMatch[1] : undefined;
  const auth = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  return { installed: true, version, authenticated: auth.status === 0 };
}

/**
 * Probe `claude auth status` and parse the JSON-ish output for "loggedIn: true".
 */
function probeClaudeAuth(): ToolStatus {
  const which = spawnSync('which', ['claude']);
  if (which.status !== 0) return { installed: false, authenticated: null };
  const ver = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  const versionMatch = ver.stdout.match(/(\d+\.\d+\.\d+)/);
  const version = versionMatch ? versionMatch[1] : undefined;
  const auth = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8' });
  const loggedIn = /"loggedIn"\s*:\s*true/.test(auth.stdout);
  return { installed: true, version, authenticated: loggedIn };
}

function probeSimple(cmd: string, versionArgs: string[] = ['--version']): ToolStatus {
  const which = spawnSync('which', [cmd]);
  if (which.status !== 0) return { installed: false };
  const ver = spawnSync(cmd, versionArgs, { encoding: 'utf8' });
  const versionLine = ver.stdout.split('\n')[0] ?? '';
  const versionMatch = versionLine.match(/(\d+\.\d+(?:\.\d+)?)/);
  return { installed: true, version: versionMatch ? versionMatch[1] : undefined };
}

const def: CommandDef = {
  name: 'doctor',
  description: 'Check system health and prerequisites (bun, tmux, gh, claude, services)',
  action: async () => {
    const ctx = resolveInstance();
    process.stdout.write(`\n  ${c.bold('fleex doctor')}\n\n`);

    let allOk = true;
    const line = (s: string) => process.stdout.write(`  ${s}\n`);

    // bun
    const bun = probeSimple('bun');
    if (!bun.installed) {
      line(`${c.red('✗')} bun not found. Install: https://bun.sh`);
      allOk = false;
    } else if (bun.version && versionGte(bun.version, MIN_BUN_VERSION)) {
      line(`${c.green('✓')} bun ${bun.version} (>= ${MIN_BUN_VERSION})`);
    } else {
      line(`${c.red('✗')} bun ${bun.version} — too old, need >= ${MIN_BUN_VERSION}. Run: ${c.bold('bun upgrade')}`);
      allOk = false;
    }

    // tmux
    const tmux = probeSimple('tmux', ['-V']);
    if (tmux.installed) line(`${c.green('✓')} tmux ${tmux.version ?? ''}`);
    else { line(`${c.red('✗')} tmux not found`); allOk = false; }

    // claude — 3 states
    const claude = probeClaudeAuth();
    if (!claude.installed) {
      line(`${c.red('✗')} claude CLI not found. Install: npm install -g @anthropic-ai/claude-code`);
      allOk = false;
    } else if (claude.authenticated) {
      line(`${c.green('✓')} claude ${claude.version ?? ''} — authenticated`);
    } else {
      line(`${c.yellow('⚠')} claude ${claude.version ?? ''} — not authenticated. Run: ${c.bold('claude auth login')}`);
      allOk = false;
    }

    // jq (informational — TS CLI does not require it, but the bash CLI did)
    const jq = probeSimple('jq');
    if (jq.installed) line(`${c.green('✓')} jq ${jq.version ?? ''}`);
    else line(`${c.yellow('⚠')} jq not found (no longer required by fleex)`);

    // gh — 3 states
    const gh = probeGhAuth();
    if (!gh.installed) {
      line(`${c.dim('○')} gh not found (optional)`);
    } else if (gh.authenticated) {
      line(`${c.green('✓')} gh ${gh.version ?? ''} — authenticated`);
    } else {
      line(`${c.yellow('⚠')} gh ${gh.version ?? ''} — not authenticated. Run: ${c.bold('gh auth login')}`);
      allOk = false;
    }

    // repo
    if (fs.existsSync(path.join(ctx.repoDir, 'packages'))) {
      line(`${c.green('✓')} repo found at ${ctx.repoDir}`);
    } else {
      line(`${c.red('✗')} repo not found at ${ctx.repoDir}`);
      allOk = false;
    }

    // node_modules
    if (fs.existsSync(path.join(ctx.repoDir, 'node_modules'))) {
      line(`${c.green('✓')} node_modules installed`);
    } else {
      line(`${c.yellow('○')} node_modules missing — run: ${c.bold(`cd ${ctx.repoDir} && bun install`)}`);
    }

    // Services
    process.stdout.write('\n');
    const ports = loadPorts(ctx);
    if (ports) {
      line(`${c.bold(`Services [${ctx.instanceSlug}]:`)}`);
      for (const svc of SERVICES as readonly Service[]) {
        if (svc === 'desktop') continue;
        let port: number;
        let healthPath: string;
        if (svc === 'gateway') { port = ports.gateway; healthPath = '/health'; }
        else if (svc === 'server') { port = ports.server; healthPath = '/health'; }
        else { port = ports.web; healthPath = '/'; }

        if (!isRunning(svc, ctx)) {
          line(`${c.dim('○')} ${svc} — not running`);
          continue;
        }
        let code = '000';
        try {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 2000);
          const res = await fetch(`http://localhost:${port}${healthPath}`, { signal: ctrl.signal });
          clearTimeout(tid);
          code = String(res.status);
          if (res.status >= 200 && res.status < 300) {
            line(`${c.green('✓')} ${svc} — healthy (HTTP ${code} on :${port})`);
            continue;
          }
        } catch {
          // fall through to failure
        }
        line(`${c.red('✗')} ${svc} — unhealthy (HTTP ${code} on :${port})`);
        allOk = false;
      }
    } else {
      line(`${c.dim(`No running instance found for ${ctx.instanceSlug}`)}`);
    }

    process.stdout.write('\n');
    if (allOk) process.stdout.write(`  ${c.green(c.bold('All checks passed.'))}\n\n`);
    else { process.stdout.write(`  ${c.yellow(c.bold('Some checks failed — see above.'))}\n\n`); process.exit(1); }
  },
};

export default def;
