import { useEffect, useState } from 'react';
import type { ActionsAiDraftStage } from '@fleex/shared';
import { cn } from '../../../lib/cn';
import { tint } from '../../../lib/tints';
import * as api from '../../../services/api';
import { useActionsSettingsStore } from '../../../stores/actionsSettingsStore';
import { useUIStore, type ActionsScope } from '../../../stores/uiStore';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { statusDotClass } from '../../actions/actionStatus';
import { COMPOSE_IDEAS, blankDraft, defaultIconColors, newId, type AiField } from './actionModel';
import { AI_BUTTON, Kbd, SparkIcon } from './shared';

const STAGES: { key: ActionsAiDraftStage; label: string }[] = [
  { key: 'intent', label: 'Understanding the intent' },
  { key: 'command', label: 'Writing the command and checking the tools' },
  { key: 'probe', label: 'Writing the status probe' },
  { key: 'icon', label: 'Finding the icon (Iconify)' },
];

/**
 * "Describe an action" (⌘K): one sentence → a full draft (name, icon, command,
 * probe, rules), opened in the detail screen as a new, unsaved action. The
 * model never saves or runs anything.
 */
export function ComposeActionModal({ scope }: { scope: ActionsScope }) {
  const open = useActionsSettingsStore((s) => s.composeOpen);
  const setOpen = useActionsSettingsStore((s) => s.setComposeOpen);
  const setPendingNew = useActionsSettingsStore((s) => s.setPendingNew);
  const openActionSettings = useUIStore((s) => s.openActionSettings);
  const [text, setText] = useState('');
  const [stage, setStage] = useState<ActionsAiDraftStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStage(null);
      setError(null);
    }
  }, [open]);

  const busy = stage !== null;
  const reached = stage ? STAGES.findIndex((s) => s.key === stage) : -1;

  const generate = async () => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setError(null);
    setStage('intent');
    try {
      const result = await api.draftActionWithAi({ prompt, scope }, setStage);
      const aiFields: AiField[] = ['label', 'actionValue'];
      if (result.icon) aiFields.push('icon');
      if (result.draft.status) aiFields.push('status');
      if (result.draft.conditionalActions?.length) aiFields.push('conditionalActions');
      setPendingNew({
        draft: {
          ...blankDraft(),
          ...result.draft,
          id: newId(),
          ...(result.icon ? { icon: result.icon.svg, iconType: 'svg' as const, iconColors: defaultIconColors({ icon: result.icon.svg, iconType: 'svg' }) } : {}),
        },
        aiFields,
        fromAi: true,
        ...(result.notes ? { notes: result.notes } : {}),
      });
      setOpen(false);
      setText('');
      openActionSettings(scope, 'new');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStage(null);
    }
  };

  return (
    <Modal open={open} onClose={() => !busy && setOpen(false)} maxWidth="max-w-xl" className="overflow-hidden p-0">
      <div className="flex items-center gap-2.5 px-5 pb-1.5 pt-4">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', tint('purple'))}><SparkIcon size={15} /></span>
        <div>
          <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">Describe the action you want</h2>
          <p className="text-xs text-[var(--theme-text-muted)]">Haiku prepares a full draft (name, icon, command, probe, rules). You review it before saving.</p>
        </div>
      </div>
      {busy ? (
        <div className="flex flex-col gap-2 px-5 pb-4 pt-2">
          <p className="pb-1 text-[13px] text-[var(--theme-text-secondary)]">“{text.trim()}”</p>
          {STAGES.filter((s) => scope === 'pinned' || s.key !== 'probe').map((s) => {
            const i = STAGES.findIndex((x) => x.key === s.key);
            const done = i < reached;
            const active = i === reached;
            return (
              <div key={s.key} className={cn('flex items-center gap-2.5 text-xs', done ? 'text-[var(--theme-text-secondary)]' : active ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-faint)]')}>
                <span className={cn('flex h-4 w-4 items-center justify-center rounded-full text-[9px]', done ? statusDotClass('ok') : active ? 'animate-pulse border border-current' : 'border border-current')}>{done ? '✓' : ''}</span>
                {s.label}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <textarea
            autoFocus
            className="min-h-[96px] w-full resize-none bg-transparent px-5 py-2.5 text-[15px] leading-normal text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:outline-none"
            placeholder="e.g. “A button that tells me whether I'm connected to the staging cluster, and connects or disconnects me in one click with platool”"
            aria-label="Describe the action"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void generate();
              }
            }}
          />
          <div className="flex flex-wrap gap-1.5 px-5 pb-3.5">
            {COMPOSE_IDEAS[scope].map((idea) => (
              <button key={idea} type="button" className="rounded-full border border-[var(--theme-border-input)] px-2.5 py-1 text-[11.5px] text-[var(--theme-text-secondary)] hover:border-[var(--tint-purple-border)]" onClick={() => setText(idea)}>
                {idea}
              </button>
            ))}
          </div>
          {error && <p className={cn('mx-5 mb-3 rounded border px-2.5 py-1.5 text-xs', tint('red'))}>{error}</p>}
        </>
      )}
      <div className="flex items-center gap-2.5 border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] py-2.5 pl-5 pr-3">
        <span className="text-[11px] text-[var(--theme-text-muted)]">{scope === 'pinned' ? 'Top bar' : 'Ticket'} · claude-haiku-5-5</span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        <button type="button" className={AI_BUTTON} disabled={busy || !text.trim()} onClick={() => void generate()}>
          <SparkIcon /> Generate <Kbd>⌘⏎</Kbd>
        </button>
      </div>
    </Modal>
  );
}
