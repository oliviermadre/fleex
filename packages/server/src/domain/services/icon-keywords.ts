/**
 * Icon search keywords guessed from a button's label and command, without a
 * model: the picker shows these results at once while Haiku refines them.
 *
 * Coarser than the model on purpose — the command's program (or a URL's host)
 * is usually the brand, and the label's words cover the rest.
 */

/** Programs whose icon goes by another name. */
const PROGRAM_BRANDS: Record<string, string> = {
  gh: 'github',
  glab: 'gitlab',
  kubectl: 'kubernetes',
  k9s: 'kubernetes',
  kubectx: 'kubernetes',
  gcloud: 'google-cloud',
  gsutil: 'google-cloud',
  bq: 'google-cloud',
  az: 'azure',
  aws: 'aws',
  code: 'vscode',
  psql: 'postgresql',
  'redis-cli': 'redis',
  mongosh: 'mongodb',
  mongo: 'mongodb',
  tf: 'terraform',
  op: '1password',
  fly: 'fly',
  flyctl: 'fly',
  supabase: 'supabase',
  vercel: 'vercel',
  netlify: 'netlify',
  heroku: 'heroku',
  npm: 'npm',
  pnpm: 'pnpm',
  yarn: 'yarn',
  docker: 'docker',
  'docker-compose': 'docker',
  podman: 'podman',
  helm: 'helm',
  terraform: 'terraform',
  git: 'git',
  claude: 'claude',
  slack: 'slack',
  jira: 'jira',
  firebase: 'firebase',
};

/** Words that run a program rather than name it. */
const LAUNCHERS = new Set(['sudo', 'env', 'npx', 'bunx', 'pnpx', 'exec', 'time', 'nohup', 'command', 'open', 'xdg-open']);
/** Shell built-ins and plumbing that say nothing about what the button is for. */
const GENERIC_PROGRAMS = new Set(['cd', 'echo', 'sh', 'bash', 'zsh', 'curl', 'wget', 'cat', 'test', 'true', 'false', 'printf', 'source', 'export', 'make', 'node', 'python', 'python3']);
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'onto', 'this', 'that', 'my', 'your', 'our', 'all', 'new', 'run', 'open', 'start', 'stop', 'toggle',
  'les', 'des', 'une', 'pour', 'avec', 'dans', 'sur', 'mon', 'mes', 'ton', 'tes',
]);
const HOST_NOISE = new Set(['www', 'app', 'api', 'console', 'dashboard', 'portal', 'my', 'web', 'go', 'admin']);
const MAX_KEYWORDS = 4;

export interface GuessedKeywords {
  keywords: string[];
  /** The product the button is about, when the command or URL names one. */
  brand: string | null;
}

export function guessIconKeywords(label: string | undefined, command: string | undefined): GuessedKeywords {
  const brand = command ? brandFromCommand(command) : null;
  const words = (label ?? '')
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  const keywords = [...new Set([...(brand ? [brand] : []), ...words])].slice(0, MAX_KEYWORDS);
  if (keywords.length === 0 && command) {
    const program = firstProgram(command);
    if (program) keywords.push(program);
  }
  return { keywords, brand };
}

function brandFromCommand(command: string): string | null {
  const url = /https?:\/\/([^/\s"'?#]+)/.exec(command);
  const program = firstProgram(command);
  if (program && PROGRAM_BRANDS[program]) return PROGRAM_BRANDS[program]!;
  if (url) return brandFromHost(url[1]!);
  return null;
}

/** `app.datadoghq.com` → `datadoghq`, `github.com` → `github`. */
function brandFromHost(host: string): string | null {
  const parts = host.toLowerCase().replace(/:\d+$/, '').split('.').filter((p) => p && !HOST_NOISE.has(p));
  if (parts.length === 0 || /^\d+$/.test(parts[0]!) || parts[0] === 'localhost') return null;
  // Drop the TLD (and a second-level like co.uk) when something is left.
  const name = parts.length >= 3 && parts[parts.length - 2]!.length <= 3 ? parts[parts.length - 3] : parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return name ?? null;
}

/** First real program of the command: skips `VAR=x`, launchers and generic shell plumbing (`cd x &&`). */
function firstProgram(command: string): string | null {
  for (const segment of command.split(/&&|\|\||;|\|/)) {
    for (const raw of segment.trim().split(/\s+/)) {
      const token = raw.replace(/^["']|["']$/g, '');
      if (!token || /^\w+=/.test(token) || token.startsWith('-') || token.includes('{{')) continue;
      const name = token.split('/').pop()!.toLowerCase();
      if (LAUNCHERS.has(name)) continue;
      if (GENERIC_PROGRAMS.has(name) || /^https?:/.test(token)) break;
      return /^[a-z][\w.-]*$/.test(name) ? name : null;
    }
  }
  return null;
}
