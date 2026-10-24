/**
 * `fleex workflow apply` — create or REPLACE a whole workflow template from one
 * JSON document. There is deliberately no partial-edit flag (no --name,
 * --add-step, --set-*): #403 decided workflows are never edited piecemeal from
 * the CLI. Validation lives on the server, in the shared invariant registry;
 * this command only reads the document and prints what the server answers.
 *
 * The primary consumer is an LLM agent: descriptions below are normative.
 */
import { readFile } from 'node:fs/promises';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { c, die, isJsonMode } from '../../../core/colors.ts';
import { apiBase } from '../../../core/api.ts';
import { parseDocument, renderApplyResult, type ApplyResult } from './render.ts';

const SECTION = chalk.bold.yellow;
const DIM = chalk.dim;

interface ApplyOptions {
  file?: string;
  dryRun?: boolean;
  documentation?: boolean;
  format?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function readDocument(file: string): Promise<unknown> {
  let text: string;
  if (file === '-') {
    text = await readStdin();
  } else {
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      die(`--file ${file}: cannot read the file (${e instanceof Error ? e.message : String(e)}).`);
    }
  }
  const parsed = parseDocument(text, file === '-' ? '- (stdin)' : file);
  if (!parsed.ok) die(parsed.error);
  return parsed.value;
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  const url = `${apiBase()}${path}`;
  try {
    const res = await fetch(url, {
      method,
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    return { status: res.status, text: await res.text() };
  } catch {
    die(`API request failed: ${method} ${url} (connection error)`);
  }
}

async function printDocumentation(format: string): Promise<void> {
  const { status, text } = await call('GET', `/api/workflows/templates/apply/documentation?format=${format}`);
  if (status !== 200) die(`API error (HTTP ${status}): ${text}`);
  process.stdout.write(format === 'json' ? `${JSON.stringify(JSON.parse(text), null, 2)}\n` : `${text}\n`);
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'apply',
  description:
    'Create or REPLACE a whole workflow template from a JSON document (keyed by its "slug"). No partial edit: the document is the entire template. Atomic, and every violation is reported in one call. Read `fleex workflow apply --documentation` before writing a document.',
  setup(cmd) {
    cmd.option(
      '--file <path|->',
      'The JSON document to apply. Use "-" to read it from stdin. Same shape as `fleex workflow show <slug> --json`.',
    );
    cmd.option('--dry-run', 'Validate and print the diff against the current template, WITHOUT writing anything.');
    cmd.option(
      '--documentation',
      'Print the full contract: JSON Schema, every validation rule with an example and its exact error message, the capabilities of this workspace (agents, skills, native operations…) and two valid examples.',
    );
    cmd.option('--format <markdown|json>', 'With --documentation: output format (default markdown).');
  },
  extraHelp: `\n${SECTION('Examples:')}
  ${DIM('$')} fleex workflow apply --documentation          ${DIM('# read this first')}
  ${DIM('$')} fleex workflow show bugfix --json > wf.json   ${DIM('# exact round-trip')}
  ${DIM('$')} fleex workflow apply --file wf.json --dry-run ${DIM('# validate + diff, no write')}
  ${DIM('$')} fleex workflow apply --file wf.json           ${DIM('# create or replace')}
  ${DIM('$')} cat wf.json | fleex workflow apply --file -

${SECTION('Notes:')}
  Run \`fleex workflow apply --documentation\` before writing a document.
  Unknown slug → the template is created. Existing slug → it is replaced entirely (same id).
  A refused document writes nothing and exits 1; --json prints { ok, errors[], warnings[] }.
  Runs already in progress keep the version they started with.
`,
  action: async (opts: ApplyOptions) => {
    if (opts.documentation && opts.file !== undefined) {
      die('workflow apply: --file and --documentation are exclusive (got both).');
    }
    if (opts.format !== undefined && !opts.documentation) {
      die('workflow apply: --format only applies to --documentation. Run: fleex workflow apply --documentation --format json');
    }
    if (opts.documentation) {
      const format = opts.format ?? (isJsonMode() ? 'json' : 'markdown');
      if (format !== 'markdown' && format !== 'json') {
        die(`workflow apply: --format must be markdown or json (got "${format}").`);
      }
      await printDocumentation(format);
      return;
    }
    if (opts.file === undefined) {
      if (opts.dryRun) die('workflow apply: --dry-run needs --file <path|->. Run: fleex workflow apply --file wf.json --dry-run');
      die('workflow apply: pass --file <path|-> to apply a document, or --documentation to read the contract. Run: fleex workflow apply --documentation');
    }

    const document = await readDocument(opts.file);
    const { status, text } = await call(
      'POST',
      `/api/workflows/templates/apply${opts.dryRun ? '?dryRun=1' : ''}`,
      document,
    );
    let result: ApplyResult;
    try {
      result = JSON.parse(text) as ApplyResult;
    } catch {
      die(`API error (HTTP ${status}): ${text}`);
    }
    if (status >= 500 || (status >= 400 && status !== 422)) die(`API error (HTTP ${status}): ${text}`);

    if (isJsonMode()) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else {
      const slug = typeof (document as { slug?: unknown })?.slug === 'string' ? (document as { slug: string }).slug : '(no slug)';
      process.stdout.write(`${renderApplyResult(result, slug, { red: c.red, green: c.green, yellow: c.yellow, cyan: c.cyan, dim: c.dim })}\n`);
    }
    if (!result.ok) process.exit(1);
  },
};

export default def;
