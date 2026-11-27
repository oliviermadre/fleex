/**
 * Runs the Assistant's turns for every conversation: the folder, the SDK
 * session, the guard, the transcript, the artefacts, Stop.
 *
 * Everything with a side effect outside the conversation (the SDK, the
 * broadcast to clients, the clock) is injected, so the whole turn is testable
 * with a scripted `query`.
 */
import fs from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { runTurn, type McpServerState, type QueryFn, type QueryHandle, type TurnEvent } from './agent-turn.ts';
import { bashAccess, type AccessCatalog } from './fleex-access.ts';
import { buildCard, changedFiles, PRODUCING_TOOLS, type ArtifactCard } from './artifacts.ts';
import { applyConfirm, denyAll, type PendingConfirm } from './confirmations.ts';
import { createOutsideWriteHook, GUARDED_TOOLS, targetOf, type OutsideWriteRequest } from './outside-write-guard.ts';
import { buildSystemAppend, formatPageContext, legacyHistoryPreamble } from './system-prompt.ts';
import { ensureWorkDir, isInside, writeWorkDir } from './work-dir.ts';
import { isLegacy, type SessionData, type SessionStore, type ToolLine, type TranscriptItem } from './sessions.ts';

export interface PageRef {
  url?: string;
  title?: string;
  content: string;
}

/** Frames pushed to every connected client, tagged with their conversation. */
export type ClientEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; id: string; name: string; toolKind: string; target: string; access?: string; outsideWorkDir?: boolean; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; status: ToolLine['status']; ok: boolean; text: string; exitCode?: number; truncated?: boolean; outsideAutoAllowed?: boolean }
  | { type: 'confirm_request'; id: string; tool: string; path: string; diff: string; isNewFile: boolean }
  | { type: 'artifact'; turnId: string; card: ArtifactCard; replaces?: boolean }
  | { type: 'artifact_modified'; path: string }
  | { type: 'mcp_status'; servers: McpServerState[] }
  | { type: 'max_turns'; limit: number }
  | { type: 'notice'; notice: 'continued' | 'legacy_resumed' | 'context_reloaded' }
  | { type: 'auth_missing' }
  | { type: 'error'; message: string }
  | { type: 'done'; stopReason: string | null };

export interface RunnerDeps {
  store: SessionStore;
  query: QueryFn;
  /** Push a frame about one conversation to every client. */
  emit: (sessionId: string, e: ClientEvent) => void;
  /** The session list changed (status, folder, flags). */
  sessionsChanged: () => void;
  /** Resolve the Fleex workspace a conversation runs against. */
  resolveWorkspace: (sessionWorkspace?: string) => string | undefined;
  /** `<basePath>/workspaces` of that workspace. */
  workspacesRoot: (workspace?: string) => string | undefined;
  accessCatalog: () => AccessCatalog;
  defaultModel: string;
  /** `agentMaxTurns` of the workspace (D9); undefined = the shared default. */
  maxTurns: (workspace?: string) => Promise<number | undefined>;
  /** Fallback key for when Claude Code has no login (T1). */
  apiKey: () => string | undefined;
  now?: () => number;
  log?: (msg: string) => void;
  /** Called when a turn ends (memory distillation hook). */
  onTurnEnd?: (session: SessionData) => void;
}

const RESUME_LOST = /no conversation found|session .*not found|could not find session/i;

/** User and assistant text of a transcript as a Messages history (to rebuild a lost session). */
function transcriptAsMessages(items: TranscriptItem[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const i of items) if ('role' in i) out.push({ role: i.role, content: i.text });
  return out;
}

export class Runner {
  private readonly pending = new Map<string, PendingConfirm>();
  private readonly pages = new Map<string, PageRef>();
  private readonly running = new Map<string, QueryHandle>();
  private readonly stopping = new Set<string>();
  private readonly mcp = new Map<string, McpServerState[]>();

  constructor(private readonly deps: RunnerDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  attachPage(sessionId: string, page: PageRef): void {
    // No disarming any more (D2): the page is data, the prompt says so.
    this.pages.set(sessionId, page);
  }

  /** Confirmations of this conversation still waiting, to re-show on open (R4). */
  pendingFor(sessionId: string): OutsideWriteRequest[] {
    return [...this.pending.values()].filter((p) => p.sessionId === sessionId).map((p) => p.request);
  }

  mcpStatus(sessionId: string): McpServerState[] | undefined {
    return this.mcp.get(sessionId);
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  confirm(msg: Record<string, unknown>): boolean {
    const outcome = applyConfirm(msg, this.pending, this.deps.store);
    if (!outcome) return false;
    if (outcome.decision === 'always') this.deps.sessionsChanged();
    outcome.pending.resolve(outcome.decision);
    return true;
  }

  /** Stop the running turn: pending confirmations are refused, the SDK is interrupted (RG9). */
  async stop(sessionId: string): Promise<void> {
    const q = this.running.get(sessionId);
    if (!q) return;
    this.stopping.add(sessionId);
    denyAll(sessionId, this.pending);
    try {
      await q.interrupt();
    } catch (e) {
      this.deps.log?.(`interrupt failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Forget a conversation being deleted. */
  async forget(sessionId: string): Promise<void> {
    await this.stop(sessionId);
    this.pages.delete(sessionId);
    this.mcp.delete(sessionId);
  }

  /** Ensure the conversation's folder exists (created on the first message, R5; recreated if removed, RG22). */
  private workDirFor(session: SessionData, workspace: string | undefined): string | null {
    if (session.workDir) {
      if (!fs.existsSync(session.workDir)) writeWorkDir(session.workDir, session.id);
      return session.workDir;
    }
    const root = this.deps.workspacesRoot(workspace);
    if (!root) return null;
    session.workDir = ensureWorkDir(root, session.id);
    this.deps.store.save(session.id);
    return session.workDir;
  }

  async handleUserTurn(sessionId: string, text: string, opts: { continued?: boolean } = {}): Promise<void> {
    const { store, emit } = this.deps;
    const session = store.get(sessionId);
    if (!session) return;
    if (session.status !== 'idle' || this.running.has(sessionId)) {
      emit(sessionId, { type: 'error', message: 'This conversation is still working.' });
      return;
    }
    const workspace = this.deps.resolveWorkspace(session.workspace);
    const workDir = this.workDirFor(session, workspace);
    if (!workDir) {
      emit(sessionId, {
        type: 'error',
        message: `Impossible de déterminer le dossier des workspaces${workspace ? ` du workspace « ${workspace} »` : ''} : il n'a pas de basePath dans ~/.fleex/workspaces.json.`,
      });
      return;
    }

    // What the SDK session has not seen yet: a pre-SDK history, or exchanges
    // recorded from the command palette since the last turn.
    const legacy = isLegacy(session);
    const unseen = session.messages.slice(session.sdkSessionId ? session.sdkContextUpTo ?? 0 : 0);
    const preamble = unseen.length ? legacyHistoryPreamble(unseen) : '';
    const page = this.pages.get(sessionId);
    this.pages.delete(sessionId);
    const prompt = [preamble, text, page ? formatPageContext(page) : ''].filter(Boolean).join('\n\n');

    if (!opts.continued) store.maybeTitleFrom(sessionId, text);
    if (legacy) this.pushNotice(session, 'legacy_resumed');
    if (opts.continued) this.pushNotice(session, 'continued');
    else session.transcript.push({ role: 'user', text });
    store.touchMessage(sessionId);
    store.setStatus(sessionId, 'working');
    this.deps.sessionsChanged();

    const turnId = `${this.now()}`;
    try {
      let outcome = await this.runOnce(session, { prompt, workDir, workspace, turnId, resume: session.sdkSessionId });
      if (outcome.resumeLost) {
        // The SDK session is gone (RG10): start over with the text history.
        session.sdkSessionId = undefined;
        this.pushNotice(session, 'context_reloaded');
        const history = legacyHistoryPreamble(transcriptAsMessages(session.transcript.slice(0, -1)));
        outcome = await this.runOnce(session, { prompt: [history, prompt].filter(Boolean).join('\n\n'), workDir, workspace, turnId });
      }
      if (outcome.authFailed && !outcome.produced) {
        const key = this.deps.apiKey();
        if (key) outcome = await this.runOnce(session, { prompt, workDir, workspace, turnId, resume: session.sdkSessionId, apiKey: key });
        if (!key || outcome.authFailed) emit(sessionId, { type: 'auth_missing' });
      }
    } catch (e) {
      emit(sessionId, { type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.finishTurn(session);
    }
  }

  private pushNotice(session: SessionData, notice: 'continued' | 'legacy_resumed' | 'context_reloaded'): void {
    session.transcript.push({ notice });
    this.deps.emit(session.id, { type: 'notice', notice });
  }

  private finishTurn(session: SessionData): void {
    const stopped = this.stopping.delete(session.id);
    // A line still running when the turn ends was cut short.
    for (const item of session.transcript) {
      if ('tool' in item && item.tool.status === 'running') item.tool.status = stopped ? 'stopped' : 'interrupted';
    }
    denyAll(session.id, this.pending);
    this.running.delete(session.id);
    this.deps.store.setStatus(session.id, 'idle');
    this.deps.store.save(session.id);
    this.deps.sessionsChanged();
    this.deps.onTurnEnd?.(session);
  }

  private async runOnce(
    session: SessionData,
    run: { prompt: string; workDir: string; workspace?: string; turnId: string; resume?: string; apiKey?: string },
  ): Promise<{ authFailed: boolean; resumeLost: boolean; produced: boolean }> {
    const { store, emit } = this.deps;
    const sessionId = session.id;
    let assistantBuf = '';
    let authFailed = false;
    let resumeLost = false;
    let produced = false;
    let lastError = '';
    const lines = new Map<string, ToolLine>();
    const started = new Map<string, number>();
    const denied = new Set<string>();
    const autoAllowed = new Set<string>();

    const flush = (): void => {
      if (!assistantBuf) return;
      session.transcript.push({ role: 'assistant', text: assistantBuf });
      assistantBuf = '';
      store.touchMessage(sessionId);
    };

    const guardHook = createOutsideWriteHook({
      workDir: () => run.workDir,
      outsideWritesAllowed: () => store.get(sessionId)?.outsideWritesAllowed === true,
      onAutoAllowed: (id) => autoAllowed.add(id),
      ask: (request) =>
        new Promise((resolve) => {
          store.setStatus(sessionId, 'awaiting_input');
          this.deps.sessionsChanged();
          this.pending.set(request.id, {
            sessionId,
            request,
            resolve: (decision) => {
              if (decision === 'deny') denied.add(request.id);
              if (this.store().get(sessionId)?.status === 'awaiting_input') store.setStatus(sessionId, 'working');
              this.deps.sessionsChanged();
              resolve(decision);
            },
          });
          emit(sessionId, { type: 'confirm_request', ...request });
        }),
    });

    const onEvent = (e: TurnEvent): void => {
      switch (e.type) {
        case 'session':
          session.sdkSessionId = e.sdkSessionId;
          session.sdkContextUpTo = session.messages.length;
          store.save(sessionId);
          break;
        case 'mcp_status':
          this.mcp.set(sessionId, e.servers);
          emit(sessionId, e);
          break;
        case 'text':
          produced = true;
          assistantBuf += (assistantBuf ? '\n\n' : '') + e.text;
          emit(sessionId, { type: 'text', text: (assistantBuf === e.text ? '' : '\n\n') + e.text });
          break;
        case 'tool_call': {
          produced = true;
          flush();
          const access = e.name === 'Bash' ? bashAccess(String(e.input.command ?? ''), this.deps.accessCatalog()) : undefined;
          const target = (GUARDED_TOOLS as readonly string[]).includes(e.name) ? targetOf(e.name, e.input) : undefined;
          const outsideWorkDir = target ? !isInside(target, run.workDir, run.workDir) : undefined;
          const line: ToolLine = {
            id: e.id,
            name: e.name,
            toolKind: e.toolKind,
            target: e.target,
            status: 'running',
            ...(access ? { access } : {}),
            ...(outsideWorkDir ? { outsideWorkDir } : {}),
          };
          session.transcript.push({ tool: line });
          lines.set(e.id, line);
          if (PRODUCING_TOOLS.has(e.name)) started.set(e.id, this.now());
          store.save(sessionId);
          emit(sessionId, {
            type: 'tool_call',
            id: e.id,
            name: e.name,
            toolKind: e.toolKind,
            target: e.target,
            input: e.input,
            ...(access ? { access } : {}),
            ...(outsideWorkDir ? { outsideWorkDir } : {}),
          });
          break;
        }
        case 'tool_result': {
          const line = lines.get(e.id);
          if (!line) break;
          line.status = denied.has(e.id) ? 'denied' : this.stopping.has(sessionId) && !e.ok ? 'stopped' : e.ok ? 'ok' : 'fail';
          line.text = e.text;
          if (e.exitCode !== undefined) line.exitCode = e.exitCode;
          if (e.truncated) line.truncated = true;
          if (autoAllowed.has(e.id)) line.outsideAutoAllowed = true;
          store.save(sessionId);
          emit(sessionId, {
            type: 'tool_result',
            id: e.id,
            name: line.name,
            status: line.status,
            ok: e.ok,
            text: e.text,
            ...(e.exitCode !== undefined ? { exitCode: e.exitCode } : {}),
            ...(e.truncated ? { truncated: true } : {}),
            ...(line.outsideAutoAllowed ? { outsideAutoAllowed: true } : {}),
          });
          const since = started.get(e.id);
          if (since !== undefined) this.collectArtifacts(session, run.workDir, run.turnId, since);
          break;
        }
        case 'max_turns':
          flush();
          session.transcript.push({ notice: 'max_turns', limit: e.limit });
          emit(sessionId, e);
          break;
        case 'auth_failed':
          authFailed = true;
          lastError = e.message;
          break;
        case 'done':
          flush();
          if (e.subtype !== 'success' && e.subtype !== 'error_max_turns') lastError ||= e.subtype;
          emit(sessionId, { type: 'done', stopReason: e.subtype });
          break;
      }
    };

    try {
      const maxTurns = await this.deps.maxTurns(run.workspace);
      await runTurn(
        this.deps.query,
        {
          prompt: run.prompt,
          workDir: run.workDir,
          model: session.model || this.deps.defaultModel,
          ...(maxTurns !== undefined ? { maxTurns } : {}),
          workspace: run.workspace,
          systemAppend: buildSystemAppend({ workspace: run.workspace, workDir: run.workDir }),
          guardHook: guardHook as never,
          ...(run.resume ? { resume: run.resume } : {}),
          ...(run.apiKey ? { apiKey: run.apiKey } : {}),
        },
        onEvent,
        (q) => this.running.set(sessionId, q),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (run.resume && !produced && RESUME_LOST.test(msg)) resumeLost = true;
      else if (/invalid api key|please run \/login|not logged in|authentication/i.test(msg)) authFailed = true;
      else if (!this.stopping.has(sessionId)) throw e;
    } finally {
      flush();
    }
    if (run.resume && !produced && RESUME_LOST.test(lastError)) resumeLost = true;
    return { authFailed, resumeLost, produced };
  }

  private store(): SessionStore {
    return this.deps.store;
  }

  /** Cards for the files of the folder this call created or changed (RG33-34). */
  private collectArtifacts(session: SessionData, workDir: string, turnId: string, sinceMs: number): void {
    // mtime granularity can be coarser than the clock: give it a second.
    const files = changedFiles(workDir, sinceMs - 1000);
    for (const file of files) {
      const card = buildCard(file, workDir);
      if (!card) continue;
      const sameTurn = session.transcript.find(
        (i): i is { artifact: ArtifactCard & { turnId: string } } => 'artifact' in i && i.artifact.path === file && i.artifact.turnId === turnId,
      );
      if (sameTurn) {
        // One card per file per turn, showing its latest state.
        if (sameTurn.artifact.sizeBytes === card.sizeBytes && JSON.stringify(sameTurn.artifact.preview) === JSON.stringify(card.preview)) continue;
        Object.assign(sameTurn.artifact, card, { attachments: sameTurn.artifact.attachments });
        this.deps.emit(session.id, { type: 'artifact', turnId, card: sameTurn.artifact, replaces: true });
        continue;
      }
      for (const i of session.transcript) {
        if ('artifact' in i && i.artifact.path === file && !i.artifact.modifiedSince) i.artifact.modifiedSince = true;
      }
      if (session.transcript.some((i) => 'artifact' in i && i.artifact.path === file)) {
        this.deps.emit(session.id, { type: 'artifact_modified', path: file });
      }
      session.transcript.push({ artifact: { ...card, turnId } });
      this.deps.emit(session.id, { type: 'artifact', turnId, card });
    }
    this.deps.store.save(session.id);
  }

  /** Find an artefact card of a conversation by path (latest first). */
  artifact(sessionId: string, filePath: string): (ArtifactCard & { turnId: string }) | undefined {
    const s = this.deps.store.get(sessionId);
    if (!s) return undefined;
    for (let k = s.transcript.length - 1; k >= 0; k--) {
      const i = s.transcript[k]!;
      if ('artifact' in i && i.artifact.path === filePath) return i.artifact;
    }
    return undefined;
  }

  /** Paths a client may ask to open: the folder and what is inside it. */
  canOpen(sessionId: string, target: string): boolean {
    const dir = this.deps.store.get(sessionId)?.workDir;
    return !!dir && path.isAbsolute(target) && isInside(target, dir);
  }
}
