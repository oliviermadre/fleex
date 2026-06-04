import { useEffect, useState } from 'react';
import type { WorkflowStep, JsonSchema } from '@fleex/shared';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSkillStore } from '../../stores/skillStore';
import { usePanelStore } from '../../stores/panelStore';
import { TagInput } from '../ui/TagInput';

interface Props {
  step: WorkflowStep;
  isEntry: boolean;
  onChange: (next: WorkflowStep) => void;
  onSetEntry: () => void;
}

export function StepConfigPanel({ step, isEntry, onChange, onSetEntry }: Props) {
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

  const refOptions = (() => {
    switch (step.executorType) {
      case 'agent':
        return personas.map((p) => ({ value: p.name, label: p.displayName || p.name }));
      case 'skill':
        return skills.map((s) => ({ value: s.commandName, label: s.displayName || s.commandName }));
      case 'panel':
        return panels.map((p) => ({ value: p.name, label: p.displayName || p.name }));
      case 'human_gate':
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
      {step.executorType !== 'human_gate' && (
        <label className="block text-xs space-y-1">
          <span style={{ color: 'var(--theme-text-muted)' }}>Executor ref</span>
          <select
            value={step.executorRef}
            onChange={(e) => onChange({ ...step, executorRef: e.target.value })}
            className="w-full h-8 px-2 text-xs rounded border"
            style={{ background: 'var(--theme-bg-surface)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
          >
            <option value="">Select…</option>
            {refOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Mode override */}
      {step.executorType !== 'human_gate' && (
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
                ? <span className="text-red-400">A human gate needs at least 2 outcomes.</span>
                : 'Type an outcome, then press Enter, comma or Tab to add it.'
            }
          />
        </div>
      )}

      {/* Output schema textarea */}
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
          <div className="text-red-400 text-[10px] mt-1">{outputSchemaError}</div>
        )}
      </label>

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
