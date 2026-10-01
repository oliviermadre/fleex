import { BINARY_NAME, aliasUsesTty, type BinaryDiagnosis, type BinaryKind } from '@fleex/shared';

/** Runs a command in the gateway's login, non-interactive zsh (`zsh -l -c`). */
export type DiagnosisExecFn = (command: string) => Promise<{ stdout: string; exitCode: number }>;

export const BINARY_DIAGNOSIS_TIMEOUT_MS = 3_000;
const ALIAS_MAX = 500;

export class InvalidBinaryNameError extends Error {}

/**
 * "Why is X not found?" — compares what a background action sees (login shell,
 * no .zshrc) with what the user's terminal sees (interactive shell). The name
 * is validated before it is ever interpolated into a command line.
 */
export class BinaryDiagnosisService {
  constructor(private readonly exec: DiagnosisExecFn) {}

  async diagnose(binary: string): Promise<BinaryDiagnosis> {
    if (typeof binary !== 'string' || !BINARY_NAME.test(binary)) throw new InvalidBinaryNameError('Invalid binary name');

    const [login, interactive] = await Promise.all([
      this.run(`whence -w ${binary}; whence -p ${binary}`),
      // A nested interactive zsh loads .zshrc; oh-my-zsh noise on stderr is dropped.
      this.run(`zsh -i -c 'whence -w ${binary}; alias ${binary}; whence -p ${binary}' 2>/dev/null`),
    ]);

    const loginKind = kindOf(login, binary);
    const interactiveKind = kindOf(interactive, binary);
    const path = pathOf(login) ?? pathOf(interactive);
    const definition = interactiveKind === 'alias' ? aliasOf(interactive, binary) : undefined;

    return {
      binary,
      login: loginKind === 'command' || loginKind === 'builtin' ? loginKind : 'missing',
      interactive: interactiveKind,
      ...(path ? { path } : {}),
      ...(definition ? { aliasDefinition: definition.slice(0, ALIAS_MAX), usesTty: aliasUsesTty(definition) } : {}),
    };
  }

  private async run(command: string): Promise<string> {
    try {
      return (await this.exec(command)).stdout;
    } catch {
      return '';
    }
  }
}

/** `whence -w` prints `name: alias|command|function|builtin|reserved|none`. */
function kindOf(output: string, binary: string): BinaryKind {
  const m = new RegExp(`^${escape(binary)}: (\\w+)`, 'm').exec(output);
  switch (m?.[1]) {
    case 'alias': return 'alias';
    case 'function': return 'function';
    case 'builtin':
    case 'reserved': return 'builtin';
    case 'command':
    case 'hashed': return 'command';
    default: return 'missing';
  }
}

function pathOf(output: string): string | undefined {
  return output.split('\n').map((l) => l.trim()).find((l) => l.startsWith('/'));
}

/** zsh prints an alias as `name=value` or `name='value'` (single quotes escaped as '\''). */
function aliasOf(output: string, binary: string): string | undefined {
  const line = output.split('\n').find((l) => l.startsWith(`${binary}=`));
  if (!line) return undefined;
  const raw = line.slice(binary.length + 1);
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/'\\''/g, "'");
  return raw;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
