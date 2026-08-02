import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { useContextMenuPopover, usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';
import { foldAccents } from '../../lib/normalize';
import {
  PrimitiveIcon,
  PRIMITIVE_META,
  PRIMITIVE_KINDS,
  type PrimitiveKind,
} from '../../lib/primitives';
import { tintClasses, tintSolid } from '../../lib/tints';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import {
  useFrequentLaunchStore,
  buildMostUsedItems,
  type FrequentSource,
} from '../../stores/frequentLaunchStore';
import { usePanelStore } from '../../stores/panelStore';
import { useSkillStore } from '../../stores/skillStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { Modal } from '../ui/Modal';

import { CreateAgentModal } from './CreateAgentModal';
import { CreatePanelModal } from './CreatePanelModal';
import { CreateSkillModal } from './CreateSkillModal';
import { CreateWorkflowModal } from './CreateWorkflowModal';
import { ModelBadge } from './ModelBadge';

type FilterKey = 'all' | PrimitiveKind;

/**
 * The Primitives sidebar — the unified home for the four launchable building
 * blocks (Personas, Skills, Panels, Workflows). Header + count, accent-
 * insensitive search, per-type filter chips, a "★ Most Used" shortcut block and
 * the grouped, glyph-led list. Every per-type glyph/hue comes from the
 * `primitives.tsx` referential so the visual language stays coherent app-wide.
 */
export function AgentListPanel() {
  const navigate = useNavigate();
  const personas = useAgentPersonaStore((s) => s.personas);
  const personasLoaded = useAgentPersonaStore((s) => s.loaded);
  const loadPersonas = useAgentPersonaStore((s) => s.loadPersonas);
  const selectedPersonaId = useAgentPersonaStore((s) => s.selectedPersonaId);
  const executionStatuses = useAgentPersonaStore((s) => s.executionStatuses);
  const deletePersona = useAgentPersonaStore((s) => s.deletePersona);
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);
  const skills = useSkillStore((s) => s.skills);
  const skillsLoaded = useSkillStore((s) => s.loaded);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const selectedSkillId = useSkillStore((s) => s.selectedSkillId);
  const selectSkill = useSkillStore((s) => s.selectSkill);
  const deleteSkill = useSkillStore((s) => s.deleteSkill);
  const panels = usePanelStore((s) => s.panels);
  const selectedPanelId = usePanelStore((s) => s.selectedPanelId);
  const panelsLoaded = usePanelStore((s) => s.loaded);
  const loadPanels = usePanelStore((s) => s.loadPanels);
  const deletePanelAction = usePanelStore((s) => s.deletePanel);
  const selectPanel = usePanelStore((s) => s.selectPanel);
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const selectedWorkflowId = useWorkflowTemplateStore((s) => s.selectedWorkflowId);
  const selectWorkflow = useWorkflowTemplateStore((s) => s.selectWorkflow);
  const removeWorkflow = useWorkflowTemplateStore((s) => s.remove);
  const statsStats = useFrequentLaunchStore((s) => s.stats);
  const loadStats = useFrequentLaunchStore((s) => s.load);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [panelModalOpen, setPanelModalOpen] = useState(false);
  const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; kind: PrimitiveKind } | null>(null);
  // Per-group collapse state (point 7 — each group can be folded away).
  const [collapsed, setCollapsed] = useState<Record<PrimitiveKind, boolean>>({
    persona: false,
    skill: false,
    panel: false,
    workflow: false,
  });
  const toggleCollapsed = (kind: PrimitiveKind) =>
    setCollapsed((c) => ({ ...c, [kind]: !c[kind] }));
  // Delete is irreversible, so it is always funnelled through a confirm dialog.
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    kind: PrimitiveKind;
    name: string;
  } | null>(null);

  const {
    open: menuOpen,
    openAt,
    close: closeMenu,
    refs: menuRefs,
    floatingStyles: menuStyles,
    getFloatingProps: getMenuProps,
  } = useContextMenuPopover();

  const {
    open: createOpen,
    setOpen: setCreateOpen,
    refs: createRefs,
    floatingStyles: createStyles,
    getReferenceProps: getCreateReferenceProps,
    getFloatingProps: getCreateFloatingProps,
  } = usePopover({ placement: 'bottom-end' });

  const openContextMenu = (e: React.MouseEvent, id: string, kind: PrimitiveKind) => {
    e.preventDefault();
    setContextMenu({ id, kind });
    openAt(e.clientX, e.clientY);
  };

  // Ensure the four collections + run stats are loaded so the list and the
  // "Most Used" block are complete even when this panel mounts standalone.
  useEffect(() => {
    if (!personasLoaded) loadPersonas();
  }, [personasLoaded, loadPersonas]);
  useEffect(() => {
    if (!skillsLoaded) loadSkills();
  }, [skillsLoaded, loadSkills]);
  useEffect(() => {
    if (!panelsLoaded) loadPanels();
  }, [panelsLoaded, loadPanels]);
  useEffect(() => {
    useWorkflowTemplateStore.getState().refresh();
  }, []);
  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const q = foldAccents(search.trim());
  const isSearching = q !== '';

  const matchedPersonas = useMemo(
    () => personas.filter((p) => !q || foldAccents(`${p.displayName} ${p.name}`).includes(q)),
    [personas, q],
  );
  const matchedSkills = useMemo(
    () =>
      skills.filter(
        (s) => !q || foldAccents(`${s.displayName} ${s.name} ${s.commandName}`).includes(q),
      ),
    [skills, q],
  );
  const matchedPanels = useMemo(
    () => panels.filter((p) => !q || foldAccents(`${p.displayName} ${p.name}`).includes(q)),
    [panels, q],
  );
  const matchedWorkflows = useMemo(
    () => templates.filter((t) => !q || foldAccents(`${t.name} ${t.slug}`).includes(q)),
    [templates, q],
  );

  const counts: Record<PrimitiveKind, number> = {
    persona: matchedPersonas.length,
    skill: matchedSkills.length,
    panel: matchedPanels.length,
    workflow: matchedWorkflows.length,
  };
  const totalCount = personas.length + skills.length + panels.length + templates.length;
  const matchedTotal = counts.persona + counts.skill + counts.panel + counts.workflow;

  // "Most Used" resolves the run leaderboards against the CURRENT assets, so a
  // deleted/renamed primitive drops out automatically.
  const source: FrequentSource = useMemo(
    () => ({
      skills: skills.map((s) => ({
        id: s.id,
        displayName: s.displayName,
        commandName: s.commandName,
      })),
      templates: templates.map((t) => ({ id: t.id, name: t.name, slug: t.slug, emoji: t.emoji })),
      panels: panels.map((p) => ({ id: p.id, displayName: p.displayName, name: p.name })),
      personas: personas.map((p) => ({ id: p.id, displayName: p.displayName })),
    }),
    [skills, templates, panels, personas],
  );
  const mostUsed = useMemo(() => buildMostUsedItems(statsStats, source, 5), [statsStats, source]);
  // Shown only on the unfiltered, non-search view; hidden on fetch failure /
  // zero usage (buildMostUsedItems returns []).
  const showMostUsed = !isSearching && filter === 'all' && mostUsed.length > 0;

  const selectPrimitive = (kind: PrimitiveKind, id: string) => {
    switch (kind) {
      case 'persona':
        navigate(`/agents/${id}`, { replace: true });
        break;
      case 'skill':
        selectSkill(id);
        navigate(`/agents/skill/${id}`, { replace: true });
        break;
      case 'panel':
        selectPanel(id);
        navigate(`/agents/panel/${id}`, { replace: true });
        break;
      case 'workflow':
        selectWorkflow(id);
        navigate(`/agents/workflow/${id}`, { replace: true });
        break;
    }
  };

  const isSelected = (kind: PrimitiveKind, id: string): boolean => {
    switch (kind) {
      case 'persona':
        return selectedPersonaId === id;
      case 'skill':
        return selectedSkillId === id;
      case 'panel':
        return selectedPanelId === id;
      case 'workflow':
        return selectedWorkflowId === id;
    }
  };

  const openCreateFor = (kind: PrimitiveKind) => {
    setCreateOpen(false);
    if (kind === 'persona') setModalOpen(true);
    else if (kind === 'skill') setSkillModalOpen(true);
    else if (kind === 'panel') setPanelModalOpen(true);
    else setWorkflowModalOpen(true);
  };

  const sectionVisible = (kind: PrimitiveKind) => filter === 'all' || filter === kind;

  const nameFor = (kind: PrimitiveKind, id: string): string => {
    switch (kind) {
      case 'persona':
        return personas.find((p) => p.id === id)?.displayName ?? 'this persona';
      case 'skill':
        return skills.find((s) => s.id === id)?.displayName ?? 'this skill';
      case 'panel':
        return panels.find((p) => p.id === id)?.displayName ?? 'this panel';
      case 'workflow':
        return templates.find((t) => t.id === id)?.name ?? 'this workflow';
    }
  };

  const performDelete = () => {
    if (!deleteTarget) return;
    const { id, kind } = deleteTarget;
    if (kind === 'persona') deletePersona(id);
    else if (kind === 'skill') deleteSkill(id);
    else if (kind === 'panel') deletePanelAction(id);
    else removeWorkflow(id);
    setDeleteTarget(null);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-[var(--theme-border)] px-4"
        style={{ height: 'var(--header-height)' }}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Agentic Catalog
          </span>
          <span className="text-[10px] font-medium text-[var(--theme-text-faint)]">
            {totalCount}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            ref={createRefs.setReference}
            {...getCreateReferenceProps()}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            title="Create a primitive"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
          </button>
          <button
            onClick={toggleContentPanel}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            title="Collapse panel"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
              <line x1="6" y1="1.5" x2="6" y2="14.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Create menu */}
      {createOpen && (
        <FloatingPortal>
          <div
            ref={createRefs.setFloating}
            style={createStyles}
            {...getCreateFloatingProps()}
            className="z-50 min-w-[160px] rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-lg"
          >
            {PRIMITIVE_KINDS.map((kind) => (
              <button
                key={kind}
                onClick={() => openCreateFor(kind)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]"
              >
                <PrimitiveIcon kind={kind} size={15} />
                New {PRIMITIVE_META[kind].label}
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}

      {/* Search */}
      <div className="px-3 pt-3">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--theme-text-faint)]"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search primitives…"
            className="w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-base)] py-1.5 pl-7 pr-7 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]"
              title="Clear"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1 px-3 pt-2 pb-1">
        <FilterChip
          label="Tous"
          count={matchedTotal}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        {PRIMITIVE_KINDS.map((kind) => (
          <FilterChip
            key={kind}
            label={PRIMITIVE_META[kind].pluralLabel}
            count={counts[kind]}
            active={filter === kind}
            onClick={() => setFilter(kind)}
          />
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto pb-2">
        {/* Most Used */}
        {showMostUsed && (
          <div className="px-3 pt-2 pb-1">
            <div className="flex items-center gap-1 px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">
              <span className={tintClasses('yellow').solidText}>★</span> Most Used
            </div>
            <div className="flex flex-col gap-0.5">
              {mostUsed.map((item) => (
                <button
                  key={item.key}
                  onClick={() => selectPrimitive(item.kind, item.id)}
                  className={cn(
                    'flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left transition-colors',
                    isSelected(item.kind, item.id)
                      ? 'bg-[var(--theme-bg-hover)]'
                      : 'hover:bg-[var(--theme-bg-hover)]',
                  )}
                >
                  <PrimitiveIcon kind={item.kind} size={15} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--theme-text-primary)]">
                    {item.displayName}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-[var(--theme-text-faint)]">
                    {item.usageCount}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Global empty (search yielded nothing across all sections) */}
        {isSearching && matchedTotal === 0 && (
          <div className="px-4 py-10 text-center text-xs text-[var(--theme-text-muted)]">
            No primitive matches “{search.trim()}”.
          </div>
        )}

        {/* Personas */}
        {sectionVisible('persona') && (
          <Section
            kind="persona"
            count={counts.persona}
            collapsed={!isSearching && collapsed.persona}
            onToggle={() => toggleCollapsed('persona')}
          >
            {matchedPersonas.length === 0
              ? !isSearching && <EmptySection kind="persona" onCreate={() => setModalOpen(true)} />
              : matchedPersonas.map((persona) => {
                  const status = executionStatuses[persona.id];
                  const running = status?.running ?? false;
                  return (
                    <PrimitiveRow
                      key={persona.id}
                      kind="persona"
                      selected={selectedPersonaId === persona.id}
                      running={running}
                      title={persona.displayName}
                      subtitle={`@agent:${persona.name}`}
                      right={<ModelBadge modelId={persona.model} size="compact" />}
                      onClick={() => selectPrimitive('persona', persona.id)}
                      onContextMenu={(e) => openContextMenu(e, persona.id, 'persona')}
                      onDelete={() =>
                        setDeleteTarget({
                          id: persona.id,
                          kind: 'persona',
                          name: persona.displayName,
                        })
                      }
                    />
                  );
                })}
          </Section>
        )}

        {/* Skills */}
        {sectionVisible('skill') && (
          <Section
            kind="skill"
            count={counts.skill}
            collapsed={!isSearching && collapsed.skill}
            onToggle={() => toggleCollapsed('skill')}
          >
            {matchedSkills.length === 0
              ? !isSearching && (
                  <EmptySection kind="skill" onCreate={() => setSkillModalOpen(true)} />
                )
              : matchedSkills.map((skill) => (
                  <PrimitiveRow
                    key={skill.id}
                    kind="skill"
                    selected={selectedSkillId === skill.id}
                    disabled={!skill.enabled}
                    title={skill.displayName}
                    subtitle={`/${skill.commandName}`}
                    onClick={() => selectPrimitive('skill', skill.id)}
                    onContextMenu={(e) => openContextMenu(e, skill.id, 'skill')}
                    onDelete={() =>
                      setDeleteTarget({ id: skill.id, kind: 'skill', name: skill.displayName })
                    }
                  />
                ))}
          </Section>
        )}

        {/* Panels */}
        {sectionVisible('panel') && (
          <Section
            kind="panel"
            count={counts.panel}
            collapsed={!isSearching && collapsed.panel}
            onToggle={() => toggleCollapsed('panel')}
          >
            {matchedPanels.length === 0
              ? !isSearching && (
                  <EmptySection kind="panel" onCreate={() => setPanelModalOpen(true)} />
                )
              : matchedPanels.map((panel) => (
                  <PrimitiveRow
                    key={panel.id}
                    kind="panel"
                    selected={selectedPanelId === panel.id}
                    disabled={!panel.enabled}
                    title={panel.displayName}
                    subtitle={`@panel:${panel.name}`}
                    right={<ModelBadge modelId={panel.orchestratorModel} size="compact" />}
                    onClick={() => selectPrimitive('panel', panel.id)}
                    onContextMenu={(e) => openContextMenu(e, panel.id, 'panel')}
                    onDelete={() =>
                      setDeleteTarget({ id: panel.id, kind: 'panel', name: panel.displayName })
                    }
                  />
                ))}
          </Section>
        )}

        {/* Workflows */}
        {sectionVisible('workflow') && (
          <Section
            kind="workflow"
            count={counts.workflow}
            collapsed={!isSearching && collapsed.workflow}
            onToggle={() => toggleCollapsed('workflow')}
          >
            {matchedWorkflows.length === 0
              ? !isSearching && (
                  <EmptySection kind="workflow" onCreate={() => setWorkflowModalOpen(true)} />
                )
              : matchedWorkflows.map((template) => (
                  <PrimitiveRow
                    key={template.id}
                    kind="workflow"
                    selected={selectedWorkflowId === template.id}
                    disabled={!template.enabled}
                    title={template.name}
                    subtitle={`@workflow:${template.slug}`}
                    right={
                      <span className="shrink-0 rounded bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--theme-text-muted)]">
                        {template.steps.length} {template.steps.length === 1 ? 'step' : 'steps'}
                      </span>
                    }
                    onClick={() => selectPrimitive('workflow', template.id)}
                    onContextMenu={(e) => openContextMenu(e, template.id, 'workflow')}
                    onDelete={() =>
                      setDeleteTarget({ id: template.id, kind: 'workflow', name: template.name })
                    }
                  />
                ))}
          </Section>
        )}
      </div>

      {/* Context menu */}
      {menuOpen && contextMenu && (
        <FloatingPortal>
          <div
            ref={menuRefs.setFloating}
            style={menuStyles}
            {...getMenuProps()}
            className="z-50 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-lg"
          >
            <button
              className={`flex w-full items-center gap-2 px-4 py-1.5 text-xs ${tintClasses('red').text} hover:bg-[var(--theme-bg-hover)]`}
              onClick={() => {
                setDeleteTarget({
                  id: contextMenu.id,
                  kind: contextMenu.kind,
                  name: nameFor(contextMenu.kind, contextMenu.id),
                });
                closeMenu();
                setContextMenu(null);
              }}
            >
              Delete
            </button>
          </div>
        </FloatingPortal>
      )}

      <CreateAgentModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <CreateSkillModal open={skillModalOpen} onClose={() => setSkillModalOpen(false)} />
      <CreatePanelModal open={panelModalOpen} onClose={() => setPanelModalOpen(false)} />
      <CreateWorkflowModal open={workflowModalOpen} onClose={() => setWorkflowModalOpen(false)} />

      {/* Delete confirmation — deleting a primitive is irreversible. */}
      <Modal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} maxWidth="max-w-sm">
        {deleteTarget && (
          <>
            <div className="flex items-center gap-2">
              <PrimitiveIcon kind={deleteTarget.kind} size={18} />
              <h3 className="text-sm font-semibold text-[var(--theme-text-primary)]">
                Delete {PRIMITIVE_META[deleteTarget.kind].label.toLowerCase()}
              </h3>
            </div>
            <p className="mt-2 text-xs text-[var(--theme-text-secondary)]">
              Are you sure you want to delete{' '}
              <span className="font-medium text-[var(--theme-text-primary)]">
                {deleteTarget.name}
              </span>
              ? This action is irreversible.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md px-3 py-1.5 text-xs text-[var(--theme-text-secondary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs transition-colors',
                  tintClasses('red').onSolid,
                  tintClasses('red').solid,
                  tintClasses('red').hoverSolid,
                )}
                onClick={performDelete}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

/** Small pill toggling the visible primitive kind, with a live match count. */
function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
        active
          ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
          : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      {label}
      <span
        className={cn('tabular-nums', active ? 'opacity-80' : 'text-[var(--theme-text-faint)]')}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Section header + body wrapper, sharing the plural label from the referential.
 * The header is a toggle that collapses/expands the group's listing.
 */
function Section({
  kind,
  count,
  collapsed,
  onToggle,
  children,
}: {
  kind: PrimitiveKind;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand group' : 'Collapse group'}
        className="flex w-full items-center justify-between px-4 pt-4 pb-1 text-[var(--theme-text-faint)] transition-colors hover:text-[var(--theme-text-muted)]"
      >
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
          <svg
            width="10"
            height="10"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('transition-transform', collapsed && '-rotate-90')}
          >
            <polyline points="4,6 8,10 12,6" />
          </svg>
          {PRIMITIVE_META[kind].pluralLabel}
        </span>
        <span className="text-[10px] tabular-nums">{count}</span>
      </button>
      {!collapsed && children}
    </div>
  );
}

/** One list row: glyph + name + mention token + optional right badge. */
function PrimitiveRow({
  kind,
  selected,
  disabled = false,
  running = false,
  title,
  subtitle,
  right,
  onClick,
  onContextMenu,
  onDelete,
}: {
  kind: PrimitiveKind;
  selected: boolean;
  disabled?: boolean;
  running?: boolean;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDelete: () => void;
}) {
  return (
    <button
      className={cn(
        'group flex min-w-0 w-full items-center gap-3 py-2.5 pl-4 pr-3 text-left transition-colors border-l-2',
        selected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
        disabled && 'opacity-50',
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="relative shrink-0">
        <PrimitiveIcon kind={kind} size={18} />
        {/* Only a running persona pulses (yellow). No pending/blue dot. */}
        {running && (
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full animate-pulse',
              tintSolid('yellow'),
            )}
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-[var(--theme-text-primary)]">
          {title}
        </div>
        <div className="truncate text-xs text-[var(--theme-text-muted)]">{subtitle}</div>
      </div>
      {right}
      {/* Delete affordance — hidden until the row is hovered, pinned far right;
          opens a confirm dialog (delete is irreversible). Nested-interactive
          span pattern (role="button") mirrors SessionItem's hover actions. */}
      <span
        role="button"
        tabIndex={-1}
        title="Delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={cn(
          'hidden shrink-0 items-center justify-center rounded p-0.5 text-[var(--theme-text-faint)] transition-colors group-hover:flex',
          tintClasses('red').hoverText,
        )}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </span>
    </button>
  );
}

/** Per-type empty state with the referential glyph + a create shortcut. */
function EmptySection({ kind, onCreate }: { kind: PrimitiveKind; onCreate: () => void }) {
  const meta = PRIMITIVE_META[kind];
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center text-[var(--theme-text-muted)]">
      <span className="text-[var(--theme-text-faint)]">
        <PrimitiveIcon kind={kind} size={26} tinted={false} />
      </span>
      <p className="text-xs">No {meta.pluralLabel.toLowerCase()} yet</p>
      <button onClick={onCreate} className="text-xs text-[var(--theme-accent)] hover:underline">
        Create your first {meta.label.toLowerCase()}
      </button>
    </div>
  );
}
