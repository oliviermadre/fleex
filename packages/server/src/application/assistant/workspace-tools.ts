import { isAbsolute, resolve as resolvePath } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { capCliOutput } from './assistant-environment.js';

/**
 * The assistant's own hands on the ticket workspace: Read, Write, Edit, Bash —
 * what an agent gets in edit mode. It still delegates the bulk of the work by
 * design; these let it look at what the user shows it (a screenshot), check a
 * proof (a diff, a test run) or make a small fix without opening a thread.
 *
 * Search has no tool of its own: Bash runs grep, rg and find.
 */

/** Files and shell of the machine the agents run on. Injected, so tests touch neither. */
export interface AssistantWorkspacePort {
  /** The ticket's workspace directory, created with its worktrees on first use — as for an agent run. Null when it cannot be. */
  resolve(ticketId: string): Promise<string | null>;
  readFile(path: string): Promise<Buffer>;
  /** Creates the parent directories. */
  writeFile(path: string, content: string): Promise<void>;
  shell(command: string, opts: { cwd: string; timeoutMs: number }): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }>;
}

/** A file uploaded to Fleex (`/api/files/<uuid>`), as the discussion references it. */
export interface AssistantAttachmentsPort {
  load(fileId: string): Promise<{ name: string; mimeType: string; buffer: Buffer } | null>;
}

export const WORKSPACE_TOOL_NAMES = ['Read', 'Write', 'Edit', 'Bash'] as const;
export type WorkspaceToolName = (typeof WORKSPACE_TOOL_NAMES)[number];

export const WORKSPACE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'Read',
    description: "Lit un fichier : texte (avec `offset`/`limit` en lignes pour un gros fichier) ou image (png, jpg, gif, webp — tu la VOIS). `path` : chemin absolu, chemin relatif au workspace du ticket, ou une pièce jointe de la discussion sous sa forme `/api/files/<uuid>`.",
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Chemin du fichier, ou /api/files/<uuid>' },
        offset: { type: 'integer', description: 'Première ligne à lire (1 = début)' },
        limit: { type: 'integer', description: 'Nombre de lignes à lire' },
      },
      required: ['path'],
    },
  },
  {
    name: 'Write',
    description: 'Écrit un fichier (créé ou remplacé en entier ; les dossiers parents sont créés). `path` absolu ou relatif au workspace du ticket.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'Edit',
    description: "Remplace `old_string` par `new_string` dans un fichier. `old_string` doit être présent exactement, et une seule fois sauf `replace_all: true`.",
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'Bash',
    description: "Exécute une commande shell dans le workspace du ticket (git, tests, grep/rg/find, gh…). Une commande à la fois, sans tâche de fond. `timeout_ms` : 120 000 par défaut, 600 000 au plus. La CLI `fleex` n'y passe pas : utilise tes outils `fleex_*`.",
    input_schema: {
      type: 'object',
      properties: { command: { type: 'string' }, timeout_ms: { type: 'integer' } },
      required: ['command'],
    },
  },
];

export function isWorkspaceTool(name: string): name is WorkspaceToolName {
  return (WORKSPACE_TOOL_NAMES as readonly string[]).includes(name);
}

export const BASH_DEFAULT_TIMEOUT_MS = 120_000;
export const BASH_MAX_TIMEOUT_MS = 600_000;
/** Per-image limit of the Messages API. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME_BY_EXT: Record<string, 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};
const IMAGE_MIMES = new Set<string>(Object.values(IMAGE_MIME_BY_EXT));

const FILE_REF = /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/** Ids of the attachments a text references, in order, without duplicates. */
export function attachmentIds(text: string): string[] {
  return [...new Set([...text.matchAll(FILE_REF)].map((m) => m[1]!.toLowerCase()))];
}

/**
 * The CLI is the one thing Bash must not run: through it the assistant would
 * settle a workflow gate, or launch a target outside any thread — exactly what
 * its `fleex_*` allow-list withholds. A guard against the honest mistake, not
 * against a model set on getting around it.
 */
const FLEEX_IN_SHELL = /(^|[\s;&|(`'"/])fleex(\s|$)/;

/** `content` goes to the model (it may carry an image); `summary` is what the execution log keeps — never the base64. */
export type WorkspaceToolResult = {
  ok: boolean;
  content: string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;
  summary: string;
};

function imageBlock(mimeType: string, buffer: Buffer): Anthropic.ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: mimeType as 'image/png', data: buffer.toString('base64') } };
}

/** An uploaded image as a block the model sees; null when it is not an image the API takes. */
export async function attachmentImage(attachments: AssistantAttachmentsPort, fileId: string): Promise<{ name: string; block: Anthropic.ImageBlockParam } | null> {
  const file = await attachments.load(fileId).catch(() => null);
  if (!file || !IMAGE_MIMES.has(file.mimeType) || file.buffer.length > MAX_IMAGE_BYTES) return null;
  return { name: file.name, block: imageBlock(file.mimeType, file.buffer) };
}

const fail = (text: string): WorkspaceToolResult => ({ ok: false, content: text, summary: text });
const done = (text: string): WorkspaceToolResult => ({ ok: true, content: text, summary: text });
const seen = (label: string, mimeType: string, buffer: Buffer): WorkspaceToolResult => {
  const note = `Image ${label} (${mimeType}, ${Math.round(buffer.length / 1024)} Ko) :`;
  return { ok: true, content: [{ type: 'text', text: note }, imageBlock(mimeType, buffer)], summary: `${note} [image transmise au modèle]` };
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Runs one workspace tool. `cwd` is resolved by the caller (once per turn, on
 * first use); it is null when the ticket has no workspace — only an uploaded
 * attachment can be read then.
 */
export async function runWorkspaceTool(
  name: WorkspaceToolName,
  input: Record<string, unknown>,
  ctx: { cwd: string | null; workspace: AssistantWorkspacePort; attachments?: AssistantAttachmentsPort | null },
): Promise<WorkspaceToolResult> {
  const path = str(input.path);
  if (name === 'Read' && path) {
    const [fileId] = attachmentIds(path);
    if (fileId) {
      const file = await ctx.attachments?.load(fileId).catch(() => null);
      if (!file) return fail(`Pièce jointe introuvable : ${fileId}. Recopie l'identifiant exactement depuis la discussion.`);
      if (IMAGE_MIMES.has(file.mimeType)) {
        if (file.buffer.length > MAX_IMAGE_BYTES) return fail(`Image trop lourde pour être lue (${Math.round(file.buffer.length / 1024)} Ko, 5 Mo au plus) : ${file.name}.`);
        return seen(`« ${file.name} »`, file.mimeType, file.buffer);
      }
      if (file.mimeType.startsWith('text/') || file.mimeType === 'application/json') return done(capCliOutput(file.buffer.toString('utf-8')));
      return fail(`« ${file.name} » (${file.mimeType}) n'est ni un texte ni une image : je ne peux pas te le montrer.`);
    }
  }
  if (!ctx.cwd) return fail("Le workspace de ce ticket n'a pas pu être préparé : outil indisponible ce tour-ci.");
  const abs = (p: string) => (isAbsolute(p) ? p : resolvePath(ctx.cwd!, p));
  try {
    switch (name) {
      case 'Read': {
        if (!path) return fail('Argument manquant : path.');
        const buffer = await ctx.workspace.readFile(abs(path));
        const mime = IMAGE_MIME_BY_EXT[path.split('.').pop()?.toLowerCase() ?? ''];
        if (mime) {
          if (buffer.length > MAX_IMAGE_BYTES) return fail(`Image trop lourde pour être lue (${Math.round(buffer.length / 1024)} Ko, 5 Mo au plus).`);
          return seen(path, mime, buffer);
        }
        if (buffer.includes(0)) return fail(`${path} est un fichier binaire (${buffer.length} octets) : je ne peux pas te le montrer.`);
        let text = buffer.toString('utf-8');
        const offset = Number.isInteger(input.offset) ? Math.max(1, input.offset as number) : 1;
        const limit = Number.isInteger(input.limit) ? Math.max(1, input.limit as number) : null;
        if (offset > 1 || limit !== null) {
          const lines = text.split('\n');
          text = lines.slice(offset - 1, limit === null ? undefined : offset - 1 + limit).join('\n');
          text += `\n[lignes ${offset} à ${Math.min(lines.length, offset - 1 + (limit ?? lines.length))} sur ${lines.length}]`;
        }
        return done(capCliOutput(text));
      }
      case 'Write': {
        if (!path || typeof input.content !== 'string') return fail('Arguments manquants : path, content.');
        await ctx.workspace.writeFile(abs(path), input.content);
        return done(`Écrit : ${abs(path)} (${input.content.length} caractères).`);
      }
      case 'Edit': {
        const oldStr = str(input.old_string);
        if (!path || !oldStr || typeof input.new_string !== 'string') return fail('Arguments manquants : path, old_string, new_string.');
        const text = (await ctx.workspace.readFile(abs(path))).toString('utf-8');
        const count = text.split(oldStr).length - 1;
        if (count === 0) return fail(`Rien n'a été modifié : old_string est introuvable dans ${path}. Relis le fichier.`);
        if (count > 1 && input.replace_all !== true) return fail(`Rien n'a été modifié : old_string apparaît ${count} fois dans ${path}. Donne plus de contexte, ou replace_all: true.`);
        await ctx.workspace.writeFile(abs(path), text.split(oldStr).join(input.new_string));
        return done(`Modifié : ${abs(path)} (${count} remplacement${count > 1 ? 's' : ''}).`);
      }
      case 'Bash': {
        const command = str(input.command);
        if (!command) return fail('Argument manquant : command.');
        if (FLEEX_IN_SHELL.test(command)) {
          return fail("Refusé, rien n'a été exécuté : la CLI `fleex` ne passe pas par Bash. Utilise tes outils `fleex_*` ; ce qu'ils ne proposent pas reste à l'utilisateur ou passe par tes actions de thread.");
        }
        const timeoutMs = Number.isInteger(input.timeout_ms) ? Math.min(Math.max(1000, input.timeout_ms as number), BASH_MAX_TIMEOUT_MS) : BASH_DEFAULT_TIMEOUT_MS;
        const r = await ctx.workspace.shell(command, { cwd: ctx.cwd, timeoutMs });
        const out = [r.stdout.trimEnd(), r.stderr.trimEnd() ? `[stderr]\n${r.stderr.trimEnd()}` : ''].filter(Boolean).join('\n');
        const status = r.timedOut ? `[interrompu : délai de ${timeoutMs} ms dépassé]` : `[code de sortie ${r.exitCode}]`;
        const text = capCliOutput(`${out || '(aucune sortie)'}\n${status}`);
        return { ok: r.exitCode === 0 && !r.timedOut, content: text, summary: text };
      }
    }
  } catch (err) {
    return fail(`${name} a échoué : ${err instanceof Error ? err.message : String(err)}`);
  }
}
