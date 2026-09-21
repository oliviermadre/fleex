import { useCallback, useMemo } from 'react';
import type { ConversationMode, EffortLevel, UpdateTicketExecutionConfigRequest } from '@fleex/shared';
import { inferModelCapabilities, resolveEffortLevel } from '@fleex/shared';
import { useTicketStore } from '../stores/ticketStore';
import { useModels } from './useModels';
import * as api from '../services/api';

export interface ExecConfig {
  executionMode: ConversationMode;
  modelOverride: string | null;
  effortOverride: EffortLevel | null;
  fastMode: boolean;
  /** Persona playing the assistant on this ticket; null = workspace default. */
  assistantPersonaId: string | null;
  /** Only the effort levels the overridden model actually accepts. */
  effortLevels: readonly EffortLevel[];
  /** Effort control shown only for an explicit, effort-capable model override. */
  showEffort: boolean;
  /** Fast toggle shown only when the overridden model supports it. */
  showFast: boolean;
  /** Stored effort clamped to this model's ceiling (or '' in Auto). */
  effectiveEffort: EffortLevel | '';
  patchExecConfig: (req: UpdateTicketExecutionConfigRequest) => void;
  cycleMode: () => void;
  setExecutionMode: (mode: ConversationMode) => void;
}

/**
 * Conversation-scoped execution config (mode / model / effort / fast) for a
 * ticket's composer. The config lives on the ticket (persisted server side,
 * synced via the `ticket:updated` WS broadcast); this hook reads it from the
 * ticket store and PATCHes `/execution-config` on change — it sends no message.
 *
 * Extracted from TicketComments so the ticket comments, mobile and Work-stream
 * composers all drive the same source of truth.
 */
export function useExecConfig(ticketId: string): ExecConfig {
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === ticketId));
  const { models } = useModels();

  const executionMode: ConversationMode = ticket?.conversationMode ?? 'plan';
  const modelOverride: string | null = ticket?.modelOverride ?? null;
  const effortOverride: EffortLevel | null = ticket?.effortOverride ?? null;
  const fastMode: boolean = ticket?.fastMode ?? false;
  const assistantPersonaId: string | null = ticket?.assistantPersonaId ?? null;

  // The model whose capabilities drive the Effort/Fast controls. In "Auto"
  // (no override) we can't know which persona will run, so those controls stay
  // hidden — they degrade cleanly and only appear for an explicit, capable
  // model override.
  const overriddenModel = useMemo(
    () => (modelOverride ? models.find((m) => m.id === modelOverride) : undefined),
    [models, modelOverride],
  );
  // Only the levels THIS model accepts — a model can support effort and still
  // reject xhigh/max, and an unsupported level is a 400. Fall back to local
  // inference if the model list predates the effortLevels field.
  const effortLevels = useMemo(
    () => (modelOverride ? overriddenModel?.effortLevels ?? inferModelCapabilities(modelOverride).effortLevels : []),
    [modelOverride, overriddenModel],
  );
  const showEffort = effortLevels.length > 0;
  const showFast = overriddenModel?.supportsFastMode === true;
  // What will actually run: a stored level above this model's ceiling is clamped
  // down, so show the clamped value rather than a phantom selection.
  const effectiveEffort = modelOverride ? resolveEffortLevel(modelOverride, effortOverride) ?? '' : '';

  const patchExecConfig = useCallback(
    (req: UpdateTicketExecutionConfigRequest) => {
      void api.updateTicketExecutionConfig(ticketId, req).catch(() => {});
    },
    [ticketId],
  );

  const cycleMode = useCallback(() => {
    const order: ConversationMode[] = ['talk', 'plan', 'edit'];
    const next = order[(order.indexOf(executionMode) + 1) % order.length]!;
    patchExecConfig({ conversationMode: next });
  }, [executionMode, patchExecConfig]);

  const setExecutionMode = useCallback(
    (mode: ConversationMode) => patchExecConfig({ conversationMode: mode }),
    [patchExecConfig],
  );

  return {
    executionMode,
    modelOverride,
    effortOverride,
    fastMode,
    assistantPersonaId,
    effortLevels,
    showEffort,
    showFast,
    effectiveEffort,
    patchExecConfig,
    cycleMode,
    setExecutionMode,
  };
}
