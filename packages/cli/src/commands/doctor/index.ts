import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { checkClaudeHooks, installClaudeHooks } from '../../core/claude-hooks.ts';
import { c } from '../../core/colors.ts';
import {
  GATEWAY_TOKEN_FILE,
  generateGatewayToken,
  inspectGatewayToken,
  readGatewayToken,
  writeGatewayToken,
} from '../../core/gateway-token.ts';
import { resolveInstance } from '../../core/instance.ts';
import { SERVICES, loadPorts, type Service } from '../../core/ports.ts';
import { isRunning } from '../../core/process.ts';
import { MIN_BUN_VERSION, versionGte } from '../../core/version.ts';
import { reportWorkspacesConfig } from '../../core/workspaces.ts';

import type { CommandDef } from '../../core/types.ts';

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
  workspaceAware: true,
  name: 'doctor',
  description: 'Check system health and prerequisites (bun, tmux, gh, claude, services)',
  setup(cmd) {
    cmd.option('--fix', 'Apply automatic fixes when possible (e.g. install Claude Code hooks)');
  },
  action: async (opts: { fix?: boolean } = {}) => {
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
      line(
        `${c.red('✗')} bun ${bun.version} — too old, need >= ${MIN_BUN_VERSION}. Run: ${c.bold('bun upgrade')}`,
      );
      allOk = false;
    }

    // tmux
    const tmux = probeSimple('tmux', ['-V']);
    if (tmux.installed) line(`${c.green('✓')} tmux ${tmux.version ?? ''}`);
    else {
      line(`${c.red('✗')} tmux not found`);
      allOk = false;
    }

    // claude — 3 states
    const claude = probeClaudeAuth();
    if (!claude.installed) {
      line(`${c.red('✗')} claude CLI not found. Install: npm install -g @anthropic-ai/claude-code`);
      allOk = false;
    } else if (claude.authenticated) {
      line(`${c.green('✓')} claude ${claude.version ?? ''} — authenticated`);
    } else {
      line(
        `${c.yellow('⚠')} claude ${claude.version ?? ''} — not authenticated. Run: ${c.bold('claude auth login')}`,
      );
      allOk = false;
    }

    // claude hooks — Fleex → Claude Code integration in ~/.claude/settings.json
    if (claude.installed) {
      const hooksStatus = checkClaudeHooks();
      if (hooksStatus.ok) {
        line(`${c.green('✓')} claude hooks — Fleex hooks installed`);
      } else if (hooksStatus.settingsCorrupted) {
        if (opts.fix) {
          const res = installClaudeHooks();
          line(
            `${c.green('✓')} claude hooks — installed (${res.installed.length} events). Backup: ${res.backupPath ?? 'none'}`,
          );
        } else {
          line(
            `${c.red('✗')} claude hooks — settings.json is invalid JSON. Run: ${c.bold('fleex doctor --fix')}`,
          );
          allOk = false;
        }
      } else if (opts.fix) {
        const res = installClaudeHooks();
        line(`${c.green('✓')} claude hooks — installed (${res.installed.length} events)`);
      } else {
        line(
          `${c.yellow('⚠')} claude hooks — missing ${hooksStatus.missing.length} event(s). Run: ${c.bold('fleex doctor --fix')}`,
        );
        allOk = false;
      }
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
      line(
        `${c.yellow('⚠')} gh ${gh.version ?? ''} — not authenticated. Run: ${c.bold('gh auth login')}`,
      );
      allOk = false;
    }

    // slack — informational only. Slack message import relies on Claude's
    // native Slack integration, which fleex cannot introspect or verify.
    line(`${c.dim('○')} slack — fleex can't check Claude's Slack integration availability`);

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
      line(
        `${c.yellow('○')} node_modules missing — run: ${c.bold(`cd ${ctx.repoDir} && bun install`)}`,
      );
    }

    // workspaces config — global ~/.fleex/workspaces.json validity, via the
    // shared rule engine (same rules the command guard uses). reportWorkspacesConfig
    // centralizes parse/legacy/rules branching; doctor just renders.
    for (const r of reportWorkspacesConfig()) {
      if (r.level === 'error') {
        line(`${c.red('✗')} workspaces config — ${r.message}`);
        allOk = false;
      } else if (r.level === 'warning') {
        line(`${c.yellow('⚠')} workspaces config — ${r.message}`);
      } else if (r.level === 'legacy') {
        line(`${c.dim('○')} workspaces — ${r.message}`);
      } else {
        line(`${c.green('✓')} workspaces config — ${r.message}`);
      }
    }

    const ports = loadPorts(ctx);

    // gateway token — the gateway runs arbitrary shell commands, so this file
    // is the only thing standing between any local process and a root-equivalent
    // shell. Never print the token itself, only its path and state.
    let tokenReport = inspectGatewayToken();
    const display = GATEWAY_TOKEN_FILE.replace(process.env.HOME ?? '~', '~');
    if (opts.fix && tokenReport.state !== 'ok') {
      // A valid token is never rotated: the running server still holds it.
      if (tokenReport.state === 'bad-perms') {
        fs.chmodSync(GATEWAY_TOKEN_FILE, 0o600);
      } else {
        writeGatewayToken(generateGatewayToken());
      }
      tokenReport = inspectGatewayToken();
      line(`${c.green('✓')} gateway token — fixed (${display}, 0600)`);
      line(`  ${c.dim(`Run '${c.bold('fleex restart')}' so the server picks up the new token.`)}`);
    } else if (tokenReport.state === 'ok') {
      line(`${c.green('✓')} gateway token — present (${display}, 0600)`);
    } else if (tokenReport.state === 'bad-perms') {
      const mode = (tokenReport.mode ?? 0).toString(8).padStart(4, '0');
      line(
        `${c.yellow('⚠')} gateway token — file mode is ${mode}, expected 0600. Run: ${c.bold('fleex doctor --fix')}`,
      );
      allOk = false;
    } else if (tokenReport.state === 'malformed') {
      line(
        `${c.red('✗')} gateway token — malformed (expected 64 hex chars). Run: ${c.bold('fleex doctor --fix')}`,
      );
      allOk = false;
    } else {
      line(`${c.red('✗')} gateway token — missing. Run: ${c.bold('fleex doctor --fix')}`);
      allOk = false;
    }

    // Online probe: a token on disk proves nothing if the running gateway was
    // started with a different one (typically a rotation without a restart).
    const gatewayToken = readGatewayToken();
    if (ports && gatewayToken && isRunning('gateway', ctx)) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 2000);
        const res = await fetch(`http://localhost:${ports.gateway}/health`, {
          headers: { Authorization: `Bearer ${gatewayToken}` },
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        const body = (await res.json().catch(() => ({}))) as { authenticated?: boolean };
        if (res.ok && body.authenticated) {
          line(
            `${c.green('✓')} gateway token — accepted by the running gateway (:${ports.gateway})`,
          );
        } else {
          // /health answers 200 even unauthenticated, so the status code alone
          // says nothing — `authenticated` is what tells them apart.
          const detail = res.ok ? 'token mismatch' : `HTTP ${res.status}`;
          line(
            `${c.red('✗')} gateway token — rejected by the running gateway (${detail}). Run: ${c.bold('fleex restart')}`,
          );
          allOk = false;
        }
      } catch {
        line(
          `${c.yellow('⚠')} gateway token — could not reach the running gateway on :${ports.gateway}`,
        );
      }
    }

    // Services
    process.stdout.write('\n');
    if (ports) {
      line(`${c.bold(`Services [${ctx.instanceSlug}]:`)}`);
      for (const svc of SERVICES as readonly Service[]) {
        if (svc === 'desktop') continue;
        let port: number;
        let healthPath: string;
        if (svc === 'gateway') {
          port = ports.gateway;
          healthPath = '/health';
        } else if (svc === 'server') {
          port = ports.server;
          healthPath = '/health';
        } else {
          port = ports.web;
          healthPath = '/';
        }

        if (!isRunning(svc, ctx)) {
          line(`${c.dim('○')} ${svc} — not running`);
          continue;
        }
        let code = '000';
        try {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 2000);
          const res = await fetch(`http://127.0.0.1:${port}${healthPath}`, { signal: ctrl.signal });
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
    else {
      process.stdout.write(`  ${c.yellow(c.bold('Some checks failed — see above.'))}\n\n`);
      process.exit(1);
    }
  },
};

export default def;
