import { join } from 'node:path';
import { FLEEX_DIR } from '@fleex/shared';
import type { AgentExecution } from '@fleex/shared';
import { AgentEventEntity } from '../../domain/entities/agent-event.entity.js';
import type { AgentEventStorePort, CliExecutionUpsert } from '../../application/ports/agent-event-store.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { HostFs } from '../host/types.js';

interface ExecutionIndex {
  id: string;
  personaId: string;
  ticketId: string;
  mentionId: string;
  eventCount: number;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  startedAt: string;
  completedAt: string | null;
  lastEventAt: string | null;
  sdkSessionId?: string | null;
  model?: string;
  effectiveMode?: string;
  effort?: string;
  fast?: boolean;
  durationMs?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  source?: 'sdk' | 'cli';
}

export class JsonAgentEventStore implements AgentEventStorePort {
  private readonly eventsDir: string;
  private readonly indexFile: string;
  private index: ExecutionIndex[] = [];
  private initialized = false;

  constructor(
    private readonly hostFs: HostFs,
    private readonly homedir: string,
    private readonly logger: LoggerPort,
  ) {
    this.eventsDir = join(this.homedir, FLEEX_DIR, 'projects', 'agent-events');
    this.indexFile = join(this.eventsDir, 'index.json');
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (!(await this.hostFs.exists(this.eventsDir))) {
      await this.hostFs.mkdir(this.eventsDir);
    }
    await this.loadIndex();
    this.initialized = true;
  }

  async startExecution(params: {
    executionId: string;
    personaId: string;
    ticketId: string;
    mentionId: string;
    model?: string;
    effort?: string;
    fast?: boolean;
  }): Promise<void> {
    const entry: ExecutionIndex = {
      id: params.executionId,
      personaId: params.personaId,
      ticketId: params.ticketId,
      mentionId: params.mentionId,
      eventCount: 0,
      status: 'running',
      startedAt: new Date().toISOString(),
      completedAt: null,
      lastEventAt: null,
      model: params.model ?? undefined,
      effort: params.effort ?? undefined,
      fast: params.fast ?? undefined,
    };
    this.index.push(entry);
    await this.syncIndex();
  }

  async appendEvent(event: AgentEventEntity): Promise<void> {
    const filePath = join(this.eventsDir, `${event.executionId}.jsonl`);
    const line = JSON.stringify(event.toDTO()) + '\n';
    await this.hostFs.appendFile(filePath, line);

    const entry = this.index.find((e) => e.id === event.executionId);
    if (entry) {
      entry.eventCount++;
      entry.lastEventAt = new Date().toISOString();
      // Batch index sync — only sync every 100 events to reduce I/O
      if (entry.eventCount % 100 === 0) {
        await this.syncIndex();
      }
    }
  }

  async completeExecution(executionId: string, status: 'completed' | 'failed' | 'interrupted', metrics?: {
    model?: string; effectiveMode?: string; effort?: string; fast?: boolean; durationMs?: number; costUsd?: number;
    inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number;
  }): Promise<void> {
    const entry = this.index.find((e) => e.id === executionId);
    if (entry) {
      entry.status = status;
      entry.completedAt = new Date().toISOString();
      if (metrics?.model) entry.model = metrics.model;
      if (metrics?.effectiveMode) entry.effectiveMode = metrics.effectiveMode;
      if (metrics?.effort) entry.effort = metrics.effort;
      if (metrics?.fast != null) entry.fast = metrics.fast;
      if (metrics?.durationMs != null) entry.durationMs = metrics.durationMs;
      if (metrics?.costUsd != null) entry.costUsd = metrics.costUsd;
      if (metrics?.inputTokens != null) entry.inputTokens = metrics.inputTokens;
      if (metrics?.outputTokens != null) entry.outputTokens = metrics.outputTokens;
      if (metrics?.cacheReadTokens != null) entry.cacheReadTokens = metrics.cacheReadTokens;
      if (metrics?.cacheCreationTokens != null) entry.cacheCreationTokens = metrics.cacheCreationTokens;
      await this.syncIndex();
    }
  }

  async getEventsByExecution(executionId: string): Promise<AgentEventEntity[]> {
    const filePath = join(this.eventsDir, `${executionId}.jsonl`);
    if (!(await this.hostFs.exists(filePath))) return [];

    const raw = await this.hostFs.readFile(filePath);
    const events: AgentEventEntity[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const dto = JSON.parse(line);
        events.push(new AgentEventEntity(
          dto.id,
          dto.executionId,
          dto.eventType,
          dto.data,
          dto.sequence,
          new Date(dto.createdAt),
        ));
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  }

  async getExecutionsByTicket(ticketId: string): Promise<AgentExecution[]> {
    return this.index
      .filter((e) => e.ticketId === ticketId)
      .map(this.indexToExecution);
  }

  async getExecutionsByPersona(personaId: string, limit = 50): Promise<AgentExecution[]> {
    return this.index
      .filter((e) => e.personaId === personaId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit)
      .map(this.indexToExecution);
  }

  async getAllExecutions(): Promise<AgentExecution[]> {
    return [...this.index]
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .map(this.indexToExecution);
  }

  async updateSessionId(executionId: string, sdkSessionId: string): Promise<void> {
    const entry = this.index.find((e) => e.id === executionId);
    if (entry) {
      entry.sdkSessionId = sdkSessionId;
      await this.syncIndex();
    }
  }

  async upsertCliExecution(p: CliExecutionUpsert): Promise<void> {
    const existing = this.index.find((e) => e.id === p.executionId);
    const entry: ExecutionIndex = existing ?? {
      id: p.executionId, personaId: 'cli', ticketId: p.ticketId, mentionId: p.mentionId,
      eventCount: 0, status: 'completed', startedAt: p.startedAt, completedAt: null, lastEventAt: null,
    };
    entry.status = 'completed';
    entry.completedAt = p.completedAt;
    entry.sdkSessionId = p.sdkSessionId;
    entry.source = 'cli';
    entry.model = p.model ?? undefined;
    entry.durationMs = p.durationMs ?? undefined;
    entry.costUsd = p.costUsd ?? undefined;
    entry.inputTokens = p.inputTokens ?? undefined;
    entry.outputTokens = p.outputTokens ?? undefined;
    entry.cacheReadTokens = p.cacheReadTokens ?? undefined;
    entry.cacheCreationTokens = p.cacheCreationTokens ?? undefined;
    if (!existing) this.index.push(entry);
    await this.syncIndex();
  }

  async markInterruptedExecutions(): Promise<string[]> {
    const mentionIds: string[] = [];
    const now = new Date().toISOString();
    for (const entry of this.index) {
      if (entry.status === 'running') {
        entry.status = 'interrupted';
        entry.completedAt = now;
        mentionIds.push(entry.mentionId);
      }
    }
    if (mentionIds.length > 0) {
      await this.syncIndex();
    }
    return mentionIds;
  }

  async getSessionHistory(): Promise<Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>> {
    const sorted = [...this.index]
      .filter((e) => e.sdkSessionId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const result = new Map<string, { sdkSessionId: string; personaId: string; ticketId: string }>();
    for (const entry of sorted) {
      const key = `${entry.personaId}:${entry.ticketId}`;
      if (!result.has(key)) {
        result.set(key, { sdkSessionId: entry.sdkSessionId!, personaId: entry.personaId, ticketId: entry.ticketId });
      }
    }
    return result;
  }

  private indexToExecution(entry: ExecutionIndex): AgentExecution {
    return {
      id: entry.id,
      personaId: entry.personaId,
      ticketId: entry.ticketId,
      mentionId: entry.mentionId,
      eventCount: entry.eventCount,
      status: entry.status,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      lastEventAt: entry.lastEventAt ?? null,
      sdkSessionId: entry.sdkSessionId,
      model: entry.model ?? null,
      effectiveMode: entry.effectiveMode ?? null,
      effort: entry.effort ?? null,
      fast: entry.fast ?? null,
      durationMs: entry.durationMs ?? null,
      costUsd: entry.costUsd ?? null,
      inputTokens: entry.inputTokens ?? null,
      outputTokens: entry.outputTokens ?? null,
      cacheReadTokens: entry.cacheReadTokens ?? null,
      cacheCreationTokens: entry.cacheCreationTokens ?? null,
      source: entry.source ?? null,
    };
  }

  private async loadIndex(): Promise<void> {
    if (!(await this.hostFs.exists(this.indexFile))) return;
    try {
      const raw = await this.hostFs.readFile(this.indexFile);
      this.index = JSON.parse(raw) as ExecutionIndex[];
      this.logger.info('Agent event index loaded', { count: this.index.length });
    } catch (err) {
      this.logger.warn('Failed to load agent event index', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async syncIndex(): Promise<void> {
    try {
      await this.hostFs.writeFile(this.indexFile, JSON.stringify(this.index, null, 2));
    } catch (err) {
      this.logger.error('Failed to sync agent event index', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
