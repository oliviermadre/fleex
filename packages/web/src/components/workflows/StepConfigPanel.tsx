import { useEffect, useState } from 'react';
import type { WorkflowStep, WorkflowEdge, JsonSchema, WorkflowTemplate } from '@fleex/shared';
import { includedWorkflowSlugs } from '@fleex/shared';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSkillStore } from '../../stores/skillStore';
import { usePanelStore } from '../../stores/panelStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { TagInput } from '../ui/TagInput';
import { NativeActionsEditor } from './NativeActionsEditor';

interface Props {
  step: WorkflowStep;
  isEntry: boolean;
  onChange: (next: WorkflowStep) => void;
  onSetEntry: () => void;
  /** The rest of the graph — a native step's references are resolved against it. */
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  entryStepId: string;
  /** Slug of the workflow being edited — what a sub-workflow must not lead back to. */
  workflowSlug: string;
}

/**
 * Why `candidate` can't be included in `currentSlug`, or null. Mirrors the
 * server's save-time check (G1/G2) so the choice is greyed out before a save
 * gets refused.
 */
function inclusionBlocker(candidate: string, currentSlug: string, templates: WorkflowTemplate[]): string | null {
  if (candidate === currentSlug) return 'this workflow itself';
  const bySlug = new Map(templates.map((t) => [t.slug, t]));
  const seen = new Set<string>();
  const stack = [candidate];
  while (stack.length > 0) {
    const slug = stack.pop()!;
    if (slug === currentSlug) return 'would create a cycle';
    if (seen.has(slug)) continue;
    seen.add(slug);
    stack.push(...includedWorkflowSlugs(bySlug.get(slug)?.steps ?? []));
  }
  return null;
}

export function StepConfigPanel({ step, isEntry, onChange, onSetEntry, steps, edges, entryStepId, workflowSlug }: Props) {
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const personas = useAgentPersonaStore((s) => s.personas);
  const skills = useSkillStore((s) => s.skills);
  const panels = usePanelStore((s) => s.panels);

  const [outputSchemaText, setOutputSchemaText] = useState<string>(
    step.outputSchema ? JSON.stringify(step.outputSchema, null, 2) : '',
  );
  const [outputSchemaError, setOutputSchemaError] = useState<string | null>(null);

  useEffect(() => {
    setOutputSchemaText(step.outputSchema ? JSON.stringify(step.outputSchema, null, 2) : '');
    setOutputSchemaError(null);
  }, [step.id]);

  // `human_gate`, `native` and `route` are self-contained: none points at a
  // persona / skill / panel, and none runs an agent, so none has a ref or a mode.
  const hasExecutorRef = step.executorType !== 'human_gate'
    && step.executorType !== 'native'
    && step.executorType !== 'route';
  // A router produces nothing, so an output schema would be a lie. Its whole
  // configuration is its name — the routing lives on its outgoing edges.
  const isRouter = step.executorType === 'route';
  // A sub-workflow relays its child's output: no persona, no mode, no schema.
  const isSubworkflow = step.executorType === 'workflow';
  const child = isSubworkflow ? templates.find((t) => t.slug === step.executorRef) : undefined;

  const refOptions = (() => {
    switch (step.executorType) {
      case 'agent':
        return personas.map((p) => ({ value: p.name, label: p.displayName || p.name }));
      case 'skill':
        return skills.map((s) => ({ value: s.commandName, label: s.displayName || s.commandName }));
      case 'panel':
        return panels.map((p) => ({ value: p.name, label: p.displayName || p.name }));
      case 'workflow':
        return templates.map((t) => {
          const blocker = inclusionBlocker(t.slug, workflowSlug, templates);
          const suffix = blocker ? ` — ${blocker}` : t.enabled ? '' : ' (disabled)';
          return { value: t.slug, label: `${t.emoji ? `${t.emoji} ` : ''}${t.name}${suffix}`, disabled: blocker !== null };
        });
      case 'human_gate':
      case 'native':
      case 'route':
        return [];
    }
  })();

  const handleOutputSchema = (text: string) => {
    setOutputSchemaText(text);
    if (text.trim() === '') {
      setOutputSchemaError(null);
      onChange({ ...step, outputSchema: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(text) as JsonSchema;
      if (parsed.type !== 'object' || !parsed.properties) {
        throw new Error('must be {"type":"object","properties":{...}}');
      }
      setOutputSchemaError(null);
      onChange({ ...step, outputSchema: parsed });
    } catch (e) {
      setOutputSchemaError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-3">
      {/* Step name input */}
      <label className="block text-xs space-y-1">
        <span style={{ color: 'var(--theme-text-muted)' }}>Step name</span>
        <input
          value={step.name}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
          className="w-full h-8 px-2 text-xs rounded border"
          style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
        />
      </label>

      {/* Type readonly */}
      <div className="text-xs space-y-1">
        <span style={{ color: 'var(--theme-text-muted)' }}>Type</span>
        <div
          className="font-mono px-2 py-1 rounded"
          style={{ background: 'var(--theme-bg-surface)', color: 'var(--theme-text-primary)' }}
        >
          {step.executorType}
        </div>
      </div>

      {/* Executor ref (select) */}
      {hasExecutorRef && (
        <label className="block text-xs space-y-1">
          <span style={{ color: 'var(--theme-text-muted)' }}>{isSubworkflow ? 'Workflow to include' : 'Executor ref'}</span>
          <select
            value={step.executorRef}
            onChange={(e) => onChange({ ...step, executorRef: e.target.value })}
            className="w-full h-8 px-2 text-xs rounded border"
            style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
          >
            <option value="">Select…</option>
            {refOptions.map((o: { value: string; label: string; disabled?: boolean }) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {isSubworkflow && step.executorRef && (
        <div className="text-xs space-y-1">
          {!child && <div className="text-[var(--theme-danger)]">Workflow "{step.executorRef}" not found.</div>}
          {child && !child.enabled && (
            <div className="text-[var(--theme-danger)]">This workflow is disabled: runs including it will be refused.</div>
          )}
          {child && (
            <>
              <span style={{ color: 'var(--theme-text-muted)' }}>Steps run in place ({child.steps.length})</span>
              <ol className="list-decimal pl-4 space-y-0.5" style={{ color: 'var(--theme-text-primary)' }}>
                {child.steps.map((c) => (
                  <li key={c.id}>
                    {c.name} <span style={{ color: 'var(--theme-text-muted)' }}>· {c.executorType}{c.executorType === 'workflow' ? ` ${c.executorRef}` : ''}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <p className="text-[10px] leading-tight" style={{ color: 'var(--theme-text-muted)' }}>
            Each run takes the workflow's latest version. Outgoing edges read the
            output of its last completed step.
          </p>
        </div>
      )}

      {/* Mode override */}
      {hasExecutorRef && !isSubworkflow && (
        <label className="block text-xs space-y-1">
          <span style={{ color: 'var(--theme-text-muted)' }}>Mode override (optional)</span>
          <select
            value={step.mode ?? '__inherit__'}
            onChange={(e) => {
              const v = e.target.value;
              onChange({
                ...step,
                mode: v === '__inherit__' ? undefined : (v as 'talk' | 'plan' | 'edit'),
              });
            }}
            className="w-full h-8 px-2 text-xs rounded border"
            style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
          >
            <option value="__inherit__">Inherit from persona</option>
            <option value="talk">talk</option>
            <option value="plan">plan</option>
            <option value="edit">edit</option>
          </select>
        </label>
      )}

      {/* Custom prompt — agent steps only */}
      {step.executorType === 'agent' && (
        <label className="block text-xs space-y-1">
          <span style={{ color: 'var(--theme-text-muted)' }}>Prompt (optional)</span>
          <textarea
            value={step.prompt ?? ''}
            onChange={(e) => onChange({ ...step, prompt: e.target.value || undefined })}
            className="w-full font-mono text-[11px] min-h-[80px] p-2 rounded border"
            style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
            placeholder="Custom instructions injected into the agent's workflow context…"
          />
        </label>
      )}

      {/* Native actions */}
      {step.executorType === 'native' && (
        <NativeActionsEditor
          step={step}
          steps={steps}
          edges={edges}
          entryStepId={entryStepId}
          onChange={onChange}
        />
      )}

      {/* Human gate outcomes */}
      {step.executorType === 'human_gate' && (
        <div className="text-xs space-y-1">
          <TagInput
            label="Outcomes"
            tags={step.humanGateOutcomes ?? []}
            onChange={(next) => onChange({ ...step, humanGateOutcomes: next })}
            placeholder="approve, reject, request_changes"
            helperText={
              (step.humanGateOutcomes ?? []).length < 2
                ? <span className="text-[var(--theme-danger)]">A human gate needs at least 2 outcomes.</span>
                : 'Type an outcome, then press Enter, comma or Tab to add it.'
            }
          />
        </div>
      )}

      {isRouter && (
        <p className="text-[10px] leading-tight" style={{ color: 'var(--theme-text-muted)' }}>
          A router performs no action. Use it to converge several branches, then
          re-split them: its outgoing edges can read the output of any step that
          runs before it.
        </p>
      )}

      {/* Output schema textarea */}
      {!isRouter && !isSubworkflow && (
      <label className="block text-xs space-y-1">
        <span style={{ color: 'var(--theme-text-muted)' }}>Output schema (JSON Schema)</span>
        <textarea
          value={outputSchemaText}
          onChange={(e) => handleOutputSchema(e.target.value)}
          className="w-full font-mono text-[11px] min-h-[160px] p-2 rounded border"
          style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
          placeholder='{"type":"object","properties":{"path":{"type":"string","enum":["a","b"]}},"required":["path"]}'
        />
        {outputSchemaError && (
          <div className="text-[var(--theme-danger)] text-[10px] mt-1">{outputSchemaError}</div>
        )}
      </label>
      )}

      <button
        disabled={isEntry}
        onClick={onSetEntry}
        className="text-xs px-3 py-1 rounded border disabled:opacity-50"
        style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
      >
        {isEntry ? 'Entry step' : 'Set as entry step'}
      </button>
    </div>
  );
}
