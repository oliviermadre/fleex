import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClaudeCodeSkill, ClaudeCodeSkillOrigin, ClaudeCodeSkillStatus } from '@fleex/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { cn } from '../../lib/cn';
import { tint, type TintHue } from '../../lib/tints';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSkillStore } from '../../stores/skillStore';
import { toast } from '../../lib/toast';
import * as api from '../../services/api';

const ORIGIN_HUE: Record<ClaudeCodeSkillOrigin, TintHue> = { user: 'green', project: 'orange', plugin: 'blue', synced: 'pink' };
const STATUS_HUE: Record<ClaudeCodeSkillStatus, TintHue> = { present: 'gray', missing: 'gray', invalid: 'red', conflict: 'yellow' };
const SYSTEM_PERSONA_NAME = 'claude-code';

const chip = (hue: TintHue) => cn('inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium', tint(hue));

/**
 * Admin of the Claude Code skills (SKILL.md) found on the machine running this
 * Fleex server. Everything arrives disabled; the user opts in what Fleex may run.
 */
export function ClaudeCodeSkillsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const personas = useAgentPersonaStore((s) => s.personas);
  const reloadRunnable = useSkillStore((s) => s.loadClaudeCodeSkills);

  const [skills, setSkills] = useState<ClaudeCodeSkill[]>([]);
  const [hostId, setHostId] = useState('');
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<'' | ClaudeCodeSkillOrigin>('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.fetchClaudeCodeSkills();
      setSkills(res.skills);
      setHostId(res.hostId);
    } catch (err) {
      toast.error(`Chargement des skills Claude Code impossible : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const afterChange = async () => {
    await Promise.all([refresh(), reloadRunnable()]);
  };

  const rescan = async () => {
    setScanning(true);
    try {
      const r = await api.scanClaudeCodeSkills();
      toast.success(`Scan terminé : ${r.added} ajouté(s), ${r.changed} modifié(s), ${r.missing} manquant(s), ${r.back} revenu(s), ${r.invalid} invalide(s)`);
      await afterChange();
    } catch (err) {
      toast.error(`Scan impossible : ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setScanning(false);
    }
  };

  const patch = async (id: string, req: Parameters<typeof api.updateClaudeCodeSkill>[1]) => {
    try {
      await api.updateClaudeCodeSkill(id, req);
      await afterChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const bulk = async (enabled: boolean) => {
    const ids = [...selected];
    const { updated } = await api.bulkSetClaudeCodeSkillsEnabled(ids, enabled);
    setSelected(new Set());
    toast.success(`${enabled ? 'Activé(s)' : 'Désactivé(s)'} : ${updated} skill(s)`);
    await afterChange();
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((s) =>
      (!q || `${s.commandName} ${s.nativeName} ${s.description}`.toLowerCase().includes(q))
      && (!origin || s.origin === origin)
      && (!status
        || (status === 'enabled' && s.enabled)
        || (status === 'disabled' && !s.enabled)
        || (status === 'modified' && s.modifiedSinceActivation)
        || s.status === status));
  }, [skills, query, origin, status]);

  const overridePersonas = personas.filter((p) => p.name !== SYSTEM_PERSONA_NAME);
  const personaLabel = (id: string | null) => personas.find((p) => p.id === id)?.displayName ?? 'Claude Code';
  const detail = skills.find((s) => s.id === detailId) ?? null;
  const selectable = visible.filter((s) => s.status === 'present');
  const allSelected = selectable.length > 0 && selectable.every((s) => selected.has(s.id));

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-6xl" className="flex max-h-[85vh] flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-[var(--theme-text-primary)]">Skills Claude Code détectés</h2>
        <span className={chip('orange')}>{skills.length}</span>
        <span className="text-xs text-[var(--theme-text-faint)]" title="host_id = FLEEX_INSTANCE_ID ?? hostname">machine : {hostId || '…'}</span>
        <div className="flex-1" />
        <Button size="sm" onClick={() => void rescan()} disabled={scanning}>{scanning ? 'Scan…' : '⟳ Re-scanner'}</Button>
        <Button size="sm" variant="ghost" onClick={onClose}>Fermer</Button>
      </div>
      <p className="text-xs text-[var(--theme-text-muted)]">
        Les <code>SKILL.md</code> de cette machine (<code>~/.claude/skills</code>, plugins activés, skills synchronisés, <code>.claude/skills</code> des repos).
        Ils arrivent désactivés : coche ceux que Fleex peut lancer. Ils s'exécutent par défaut avec la persona système « Claude Code », via le tool <code>Skill</code> natif.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filtrer…"
          className="w-44 rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-2 py-1 text-[var(--theme-text-primary)]"
        />
        <select value={origin} onChange={(e) => setOrigin(e.target.value as '' | ClaudeCodeSkillOrigin)} className="rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-2 py-1 text-[var(--theme-text-primary)]">
          <option value="">Toutes origines</option>
          <option value="user">user</option>
          <option value="project">project</option>
          <option value="plugin">plugin</option>
          <option value="synced">synced</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-2 py-1 text-[var(--theme-text-primary)]">
          <option value="">Tous statuts</option>
          <option value="enabled">Activés</option>
          <option value="disabled">Désactivés</option>
          <option value="modified">Modifiés depuis l'activation</option>
          <option value="present">present</option>
          <option value="missing">missing</option>
          <option value="invalid">invalid</option>
          <option value="conflict">conflict</option>
        </select>
        <div className="flex-1" />
        {selected.size > 0 && <span className="text-[var(--theme-text-muted)]">{selected.size} sélectionné(s)</span>}
        <Button size="sm" variant="primary" disabled={selected.size === 0} onClick={() => void bulk(true)}>Activer la sélection</Button>
        <Button size="sm" disabled={selected.size === 0} onClick={() => void bulk(false)}>Désactiver</Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--theme-border)]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[var(--theme-bg-surface)] text-left text-[10px] uppercase tracking-wider text-[var(--theme-text-faint)]">
            <tr>
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  aria-label="Tout sélectionner"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((s) => s.id)) : new Set())}
                />
              </th>
              <th className="px-2 py-2">Commande</th>
              <th className="px-2 py-2">Origine</th>
              <th className="px-2 py-2">Description</th>
              <th className="px-2 py-2">Persona</th>
              <th className="px-2 py-2">Statut</th>
              <th className="px-2 py-2">Actif</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => {
              const activatable = s.status === 'present';
              return (
                <tr
                  key={s.id}
                  onClick={() => setDetailId(s.id === detailId ? null : s.id)}
                  className={cn(
                    'cursor-pointer border-t border-[var(--theme-border)] hover:bg-[var(--theme-bg-overlay)]',
                    s.status === 'missing' && 'opacity-50',
                    s.id === detailId && 'bg-[var(--theme-bg-overlay)]',
                  )}
                >
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      disabled={!activatable}
                      checked={selected.has(s.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(s.id); else next.delete(s.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <div className="font-mono text-[var(--theme-text-primary)]">@skill:{s.commandName}</div>
                    <div className="font-mono text-[10px] text-[var(--theme-text-faint)]">{s.nativeName}{s.realPath && s.realPath !== s.sourcePath ? ' · ↪ symlink' : ''}</div>
                  </td>
                  <td className="px-2 py-2">
                    <span className={chip(ORIGIN_HUE[s.origin])}>{s.origin}</span>
                    {(s.repo || s.plugin) && <div className="mt-0.5 text-[10px] text-[var(--theme-text-faint)]">{s.repo ?? s.plugin?.split('@')[0]}</div>}
                  </td>
                  <td className="max-w-xs truncate px-2 py-2 text-[var(--theme-text-muted)]" title={s.parseError ?? s.description}>
                    {s.status === 'invalid' ? <span className={chip('red')}>{s.parseError}</span> : s.description}
                  </td>
                  <td className="px-2 py-2 text-[var(--theme-text-secondary)]">
                    {personaLabel(s.personaId)}{!s.personaId && <span className="ml-1 text-[10px] text-[var(--theme-text-faint)]">(défaut)</span>}
                  </td>
                  <td className="px-2 py-2">
                    {s.modifiedSinceActivation
                      ? <span className={chip('yellow')}>modifié depuis l'activation</span>
                      : <span className={chip(STATUS_HUE[s.status])}>{s.status}</span>}
                  </td>
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <Toggle
                      on={s.enabled}
                      disabled={!activatable && !s.enabled}
                      title={activatable ? undefined : `Non activable (${s.status})`}
                      onClick={() => void patch(s.id, { enabled: !s.enabled })}
                    />
                  </td>
                </tr>
              );
            })}
            {!loading && visible.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-6 text-center text-[var(--theme-text-faint)]">
                {skills.length === 0 ? 'Aucun skill Claude Code trouvé sur cette machine. Lance un re-scan.' : 'Aucun skill pour ces filtres.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <SkillDetail
          skill={detail}
          personas={overridePersonas}
          onPersona={(personaId) => void patch(detail.id, { personaId })}
          onRevalidate={() => void patch(detail.id, { revalidate: true })}
        />
      )}
    </Modal>
  );
}

function Toggle({ on, disabled, title, onClick }: { on: boolean; disabled?: boolean; title?: string; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'relative h-5 w-9 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        on ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-text-faint)]/30',
      )}
    >
      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-[var(--theme-bg-surface)] transition-all', on ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

function SkillDetail({ skill, personas, onPersona, onRevalidate }: {
  skill: ClaudeCodeSkill;
  personas: { id: string; displayName: string }[];
  onPersona: (personaId: string | null) => void;
  onRevalidate: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(null);
    setError(null);
    api.fetchClaudeCodeSkillContent(skill.id)
      .then((r) => setContent(r.content))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [skill.id, skill.updatedAt]);

  return (
    <div className="grid max-h-[40vh] grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4 overflow-hidden border-t border-[var(--theme-border)] pt-3 text-xs">
      <div className="flex flex-col gap-2 overflow-auto">
        {skill.status === 'missing' && <p className="text-[var(--theme-text-muted)]">Absent au dernier scan : non lançable. Ses réglages sont conservés s'il réapparaît.</p>}
        {skill.status === 'conflict' && <p className={cn('rounded p-2', tint('yellow'))}>Un skill Fleex natif utilise déjà <code>{skill.commandName}</code> : il garde la priorité.</p>}
        {skill.modifiedSinceActivation && (
          <div className={cn('flex items-center gap-2 rounded p-2', tint('yellow'))}>
            <span className="flex-1">Le SKILL.md a changé depuis l'activation. Le skill reste actif.</span>
            <Button size="sm" onClick={onRevalidate}>Re-valider</Button>
          </div>
        )}
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
          <dt className="text-[var(--theme-text-faint)]">native_name</dt><dd className="break-all font-mono">{skill.nativeName}</dd>
          <dt className="text-[var(--theme-text-faint)]">Source</dt><dd className="break-all font-mono">{skill.repo ? `${skill.repo} : ` : ''}{skill.sourcePath}</dd>
          {skill.realPath && skill.realPath !== skill.sourcePath && (<><dt className="text-[var(--theme-text-faint)]">realpath</dt><dd className="break-all font-mono">{skill.realPath}</dd></>)}
          {skill.plugin && (<><dt className="text-[var(--theme-text-faint)]">Plugin</dt><dd className="font-mono">{skill.plugin}</dd></>)}
          <dt className="text-[var(--theme-text-faint)]">allowed-tools</dt>
          <dd>{skill.allowedTools?.length ? <><span className="font-mono">{skill.allowedTools.join(', ')}</span> <span className="text-[var(--theme-text-faint)]">(appliqué par Claude Code)</span></> : '—'}</dd>
        </dl>
        <label className="mt-1 block text-[var(--theme-text-muted)]">
          Persona qui exécute ce skill
          <select
            value={skill.personaId ?? ''}
            onChange={(e) => onPersona(e.target.value || null)}
            className="mt-1 block w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-2 py-1 text-[var(--theme-text-primary)]"
          >
            <option value="">Claude Code (système, par défaut)</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
      </div>
      <pre className="overflow-auto whitespace-pre-wrap rounded border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] p-3 font-mono text-[11px] text-[var(--theme-text-secondary)]">
        {error ? `Lecture impossible : ${error}` : content ?? 'Chargement…'}
      </pre>
    </div>
  );
}
