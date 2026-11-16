import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { useWorkflowTemplateStore } from '../stores/workflowTemplateStore';
import { cn } from '../lib/cn';
import type { Clip } from './layoutOps';
import { FactoryView, type ViewState } from './renderer';
import { planFromWorkflow, type WorkflowPlan } from './workflowPlan';

/** The plan, drawn by the floor's own renderer: what is shown is what will be put down. */
function PlanPreview({ plan }: { plan: WorkflowPlan }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const view = new FactoryView(cv), layout = { w: plan.clip.w, h: plan.clip.h, machines: plan.clip.machines };
    const state: ViewState = { layout, tickets: [], arms: new Map(), selMachine: null, selMany: [], marquee: null, selTicket: null, hoverMachine: null, edit: false, ghost: null, drag: null };
    let raf = 0, last = performance.now(), fitted = '';
    const frame = (ts: number) => {
      const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
      /* frame the whole plan, again whenever the window changes size */
      const size = `${cv.clientWidth}x${cv.clientHeight}`;
      if (size !== fitted && cv.clientWidth > 0) {
        view.cam.z = Math.max(4, Math.min(40, Math.min(cv.clientWidth / (plan.clip.w + 2), cv.clientHeight / (plan.clip.h + 2))));
        view.cam.x = plan.clip.w / 2; view.cam.y = plan.clip.h / 2; fitted = size;
      }
      view.draw(state, dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [plan]);
  return <canvas ref={ref} className="h-full w-full rounded-md" aria-label="Preview of the plan" />;
}

/**
 * Import a plan: choose a workflow, see the machines it becomes and what could
 * not be carried over, then put it down. Nothing is changed until the plan is
 * placed on the floor, and placing it is an edit like any other (it can be
 * undone).
 */
export function FactoryPlanModal({ onPlace, onClose }: { onPlace: (clip: Clip, name: string) => void; onClose: () => void }) {
  const templates = useWorkflowTemplateStore((s) => s.templates), loading = useWorkflowTemplateStore((s) => s.loading), error = useWorkflowTemplateStore((s) => s.error);
  const [picked, setPicked] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { void useWorkflowTemplateStore.getState().refresh(); }, []);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...templates].sort((a, b) => a.name.localeCompare(b.name)).filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.slug.toLowerCase().includes(needle));
  }, [templates, q]);
  const template = templates.find((t) => t.id === picked) ?? null;
  useEffect(() => { if (!picked && shown.length) setPicked(shown[0]!.id); }, [picked, shown]);
  const plan = useMemo(() => (template ? planFromWorkflow(template) : null), [template]);
  const empty = !plan || plan.counts.stations === 0 && plan.clip.machines.filter((m) => m.kind === 'zone').length <= 1;

  return (
    <Modal open onClose={onClose} maxWidth="max-w-6xl">
      <div className="flex h-[84vh] flex-col gap-3">
        <div className="flex flex-none items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-[var(--theme-text-primary)]">Import a plan</div>
            <p className="text-xs text-[var(--theme-text-muted)]">A workflow becomes machines: a station for each step, an arm for each way out, the belts between them. Once on the floor they are ordinary machines; the workflow itself is not changed, and nothing links the two afterwards.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" disabled={!template || !plan || empty} onClick={() => { if (template && plan) onPlace(plan.clip, template.name); }} title="Close this window, then click on the floor where the plan should go">Place on the floor…</Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-2">
            <Input id="factory-plan-search" placeholder="Find a workflow" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a workflow" />
            <div className="min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Workflows">
              {loading && templates.length === 0 && <div className="flex justify-center py-8"><Spinner /></div>}
              {error && <p className="py-4 text-xs text-[var(--theme-danger)]">Could not load the workflows: {error}</p>}
              {!loading && !error && shown.length === 0 && <p className="py-6 text-center text-xs text-[var(--theme-text-muted)]">{templates.length ? 'No workflow matches.' : 'No workflow yet: build one in Workflows first.'}</p>}
              {shown.map((t) => (
                <button key={t.id} type="button" role="option" aria-selected={t.id === picked} onClick={() => setPicked(t.id)}
                  className={cn('mb-1 flex w-full flex-col rounded-md border px-2 py-1.5 text-left', t.id === picked ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]' : 'border-[var(--theme-border)] hover:bg-[var(--theme-bg-overlay)]')}>
                  <span className="truncate text-xs font-medium text-[var(--theme-text-primary)]">{t.emoji ? `${t.emoji} ` : ''}{t.name}</span>
                  <span className="truncate text-[11px] text-[var(--theme-text-muted)]">{t.steps.length} step{t.steps.length === 1 ? '' : 's'} · {t.edges.length} connection{t.edges.length === 1 ? '' : 's'}{t.enabled ? '' : ' · disabled'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-2">
            <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-base)]">
              {plan && !empty ? <PlanPreview plan={plan} /> : <div className="grid h-full place-items-center text-xs text-[var(--theme-text-muted)]">{template ? 'This workflow has no step to turn into machines.' : 'Choose a workflow to see its plan.'}</div>}
            </div>
            {plan && template && !empty && (
              <div className="flex max-h-[30%] flex-none flex-col gap-1.5 overflow-y-auto">
                <div className="font-mono text-[11px] text-[var(--theme-text-secondary)]">
                  {plan.counts.stations} station{plan.counts.stations === 1 ? '' : 's'} · {plan.counts.arms} arms · {plan.counts.belts} belt tiles{plan.counts.bridges ? ` · ${plan.counts.bridges} bridge${plan.counts.bridges === 1 ? '' : 's'}` : ''} · {plan.clip.w} × {plan.clip.h} tiles
                </div>
                {plan.warnings.length === 0
                  ? <p className="text-xs text-[var(--theme-text-muted)]">Every step and every connection is carried over. Tickets come in by the zone on the left and gather in the one on the right.</p>
                  : (
                    <div className="flex flex-col gap-1" role="status">
                      <div className="text-xs font-medium text-[var(--theme-warning)]">{plan.warnings.length} thing{plan.warnings.length === 1 ? '' : 's'} to look at once it is placed</div>
                      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-[var(--theme-text-secondary)]">{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
