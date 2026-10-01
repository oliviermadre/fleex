import { useEffect, useState } from 'react';
import { extractBinaries, scriptFromAlias, type BinaryDiagnosis, type RunHint } from '@fleex/shared';
import { cn } from '../../lib/cn';
import { tint, tintText } from '../../lib/tints';
import * as api from '../../services/api';
import { useToastStore } from '../../stores/toastStore';
import { Button } from '../ui/Button';

/** One diagnosis per program per page life: the answer only changes when the user edits their shell config. */
const diagnoses = new Map<string, Promise<BinaryDiagnosis | null>>();

export function diagnoseBinaryCached(binary: string): Promise<BinaryDiagnosis | null> {
  let pending = diagnoses.get(binary);
  if (!pending) {
    pending = api.diagnoseBinary(binary);
    diagnoses.set(binary, pending);
    // A failed lookup may succeed later (gateway back up).
    void pending.then((d) => { if (!d) diagnoses.delete(binary); });
  }
  return pending;
}

/** Test seam: forget cached diagnoses. */
export function clearBinaryDiagnoses(): void {
  diagnoses.clear();
}

export function useBinaryDiagnosis(binary: string | undefined): BinaryDiagnosis | null {
  const [diagnosis, setDiagnosis] = useState<BinaryDiagnosis | null>(null);
  useEffect(() => {
    setDiagnosis(null);
    if (!binary) return;
    let alive = true;
    void diagnoseBinaryCached(binary).then((d) => { if (alive) setDiagnosis(d); });
    return () => { alive = false; };
  }, [binary]);
  return diagnosis;
}

export function copyAliasScript(d: BinaryDiagnosis): void {
  if (!d.aliasDefinition) return;
  void navigator.clipboard?.writeText(scriptFromAlias(d.binary, d.aliasDefinition));
  useToastStore.getState().addToast('success', `Script for ${d.binary} copied`, {
    detail: `Save it as ~/.local/bin/${d.binary}, chmod +x it, and remove the alias from your .zshrc.`,
    durationMs: 8000,
  });
}

/** What the diagnosis says, in one sentence, for a program a run could not find. */
export function DiagnosisLine({ diagnosis }: { diagnosis: BinaryDiagnosis }) {
  const { binary, login, interactive, path } = diagnosis;
  if (interactive === 'alias') {
    return (
      <div className="flex flex-col gap-1">
        <span>
          <code className="font-mono">{binary}</code> is an <strong>alias</strong> of your .zshrc — your terminal has it, a background action does not.
        </span>
        <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded bg-[var(--theme-bg-base)] px-2 py-1 font-mono text-[10.5px] text-[var(--theme-text-secondary)]">
          {diagnosis.aliasDefinition}
        </pre>
      </div>
    );
  }
  if (interactive === 'function') {
    return <span><code className="font-mono">{binary}</code> is a zsh <strong>function</strong> defined in your .zshrc — a background action does not load it.</span>;
  }
  if (login === 'missing' && interactive === 'missing') {
    return <span><code className="font-mono">{binary}</code> is not installed, or not on the PATH.</span>;
  }
  return (
    <span>
      <code className="font-mono">{binary}</code> exists{path ? <> (<code className="font-mono">{path}</code>)</> : null} but was not found when the action ran — check its working directory or the PATH it sets.
    </span>
  );
}

export interface RunHintCardProps {
  hint: RunHint;
  /** Offered when the hint suggests it and the caller can do it. */
  onRunInTerminal?: () => void;
  onAlwaysTerminal?: () => void;
  className?: string;
}

/**
 * Why a run failed and what to do: shown above the output in the logs, under
 * "Try" and under "Test the probe". For "not found", the program is diagnosed
 * at once — an alias of .zshrc gets its definition and a script to copy.
 */
export function RunHintCard({ hint, onRunInTerminal, onAlwaysTerminal, className }: RunHintCardProps) {
  const wantsDiagnosis = hint.suggest.includes('diagnose-binary') ? hint.binary : undefined;
  const diagnosis = useBinaryDiagnosis(wantsDiagnosis);
  const hue = hint.code === 'cancelled' ? 'gray' : 'yellow';

  return (
    <div role="note" aria-label={hint.title} className={cn('flex flex-col gap-1.5 rounded-lg px-3 py-2.5 text-[11.5px]', tint(hue), className)}>
      <div className={cn('flex items-center gap-1.5 font-semibold', tintText(hue))}>
        <span aria-hidden>⚠</span>
        {hint.title}
      </div>
      {hint.detail && <p className="text-[var(--theme-text-secondary)]">{hint.detail}</p>}
      {diagnosis && (
        <div className="text-[var(--theme-text-secondary)]">
          <DiagnosisLine diagnosis={diagnosis} />
        </div>
      )}
      {(onRunInTerminal || onAlwaysTerminal || diagnosis?.aliasDefinition) && (
        <div className="mt-0.5 flex flex-wrap gap-1.5">
          {onRunInTerminal && hint.suggest.includes('run-in-terminal') && (
            <Button size="sm" variant="secondary" onClick={onRunInTerminal}>Run in a terminal</Button>
          )}
          {onAlwaysTerminal && hint.suggest.includes('always-terminal') && (
            <Button size="sm" variant="ghost" onClick={onAlwaysTerminal}>Always run in a terminal</Button>
          )}
          {diagnosis?.aliasDefinition && (
            <Button size="sm" variant="ghost" onClick={() => copyAliasScript(diagnosis)}>Copy an equivalent script</Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Debounce delay before diagnosing what the user typed. */
export const BINARY_CHECK_DELAY_MS = 600;

/**
 * Under a command field: warns as soon as the command's program is an alias or
 * a function of .zshrc — it works in the user's terminal and will fail as a
 * background action. Never blocks saving.
 */
export function CommandBinaryWarning({ command, onRunInTerminal }: { command: string; onRunInTerminal?: () => void }) {
  const [binary, setBinary] = useState<string | undefined>(undefined);
  useEffect(() => {
    const next = extractBinaries(command)[0];
    const timer = setTimeout(() => setBinary(next), BINARY_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [command]);
  const diagnosis = useBinaryDiagnosis(binary);
  if (!diagnosis || diagnosis.binary !== extractBinaries(command)[0]) return null;
  if (diagnosis.login !== 'missing' || (diagnosis.interactive !== 'alias' && diagnosis.interactive !== 'function')) return null;

  return (
    <div role="alert" className={cn('mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2.5 py-1.5 text-[11.5px]', tint('yellow'))}>
      <span className="min-w-0 flex-1">
        <code className="font-mono">{diagnosis.binary}</code> is {diagnosis.interactive === 'alias' ? 'an alias' : 'a function'} of your .zshrc — it will not be found here.
      </span>
      {onRunInTerminal && <Button size="sm" variant="ghost" onClick={onRunInTerminal}>Run in terminal mode</Button>}
      {diagnosis.aliasDefinition && <Button size="sm" variant="ghost" onClick={() => copyAliasScript(diagnosis)}>Copy a script</Button>}
    </div>
  );
}
