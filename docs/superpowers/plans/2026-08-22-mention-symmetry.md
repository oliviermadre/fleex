# Symétrie des mentions — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Les huit formes de mention se rendent et se proposent sur toutes les surfaces markdown de Fleex, avec des puces de référence hors commentaires et les mentions actionnables préservées dans les commentaires.

**Architecture:** Un composant `PrimitiveRefChip` résout un nom de primitive vers son entité de store et navigue vers sa page de configuration. Les deux préprocesseurs markdown fusionnent en un seul, ce qui allume les puces sur toutes les surfaces d'un coup. Un hook `useAllMentionOptions` construit la liste des huit primitives une fois, consommée par les trois éditeurs qui ont un sélecteur.

**Tech Stack:** TypeScript, React 19, Zustand, react-markdown, Vitest, monorepo Bun workspaces.

**Spec:** `docs/superpowers/specs/2026-08-22-mention-symmetry-design.md`

## Global Constraints

- **Code et commentaires de code en anglais.** Ce plan et la spec sont en français ; le code produit ne l'est pas.
- **Tests web** : `bun run --filter '@fleex/web' test -- --run <motif>` ; suite complète `bun run --filter '@fleex/web' test`. **Typecheck** : `bun run --filter '@fleex/web' build`.
- **Baseline à préserver** : 77 fichiers / 658 tests verts avant ce chantier. Aucun test supprimé, sauté ni affaibli.
- **Le rendu des commentaires ne change pas.** `TicketComments` garde son override `a` et ses `MentionSpan` actionnables (défini localement à `TicketComments.tsx:126`). Le seul changement autorisé côté commentaires est l'ajout de `@scratchpad:` à son sélecteur.
- **Une référence dans un code span ou une clôture reste ignorée** — acquis du chantier précédent, à ne pas régresser.
- **Ne jamais modifier une migration déjà commitée.** Ce chantier n'en crée aucune.
- **Ne pas toucher à `docs/superpowers/`.**
- Commits fréquents, message conventionnel en anglais.

## Détail qui piège, à connaître avant de commencer

`preprocessMentions` encode `@agent:catalyst` en `[@agent:catalyst](#fleex-agent:agent:catalyst)` — le `.slice(1)` ne retire que le `@` et **garde le préfixe du kind**. Deux tests préexistants verrouillent ce comportement (`mentions.test.ts:55` et `:173`) et `TicketComments.tsx:239` le décode ainsi. Donc la valeur après `#fleex-agent:` est `agent:catalyst`, pas `catalyst`. Toute nouvelle branche de rendu doit retirer ce préfixe. Ne « corrigez » pas l'encodage.

---

## Structure des fichiers

**Créés**
- `packages/web/src/components/markdown/PrimitiveRefChip.tsx` — la puce de référence pour les cinq primitives : résolution nom → entité, navigation, dégradation.
- `packages/web/src/components/markdown/PrimitiveRefChip.test.tsx`
- `packages/web/src/components/markdown/useAllMentionOptions.ts` — la liste des huit primitives, construite une fois.
- `packages/web/src/components/markdown/useAllMentionOptions.test.ts`
- `packages/web/src/components/markdown/MarkdownRenderer.primitives.test.tsx` — le rendu des huit formes sur une surface générique.

**Modifiés**
- `packages/web/src/components/ui/MentionTypeBadge.tsx` — `MentionTargetType` gagne `routine`, `MENTION_TYPE_META` gagne son entrée.
- `packages/web/src/components/markdown/mentions.ts` — fusion des deux préprocesseurs en un.
- `packages/web/src/components/markdown/mentions.test.ts` — libellés des `describe` mis à jour.
- `packages/web/src/components/scratchpad/MarkdownRenderer.tsx` — sept nouvelles branches d'href.
- `packages/web/src/components/tickets/TicketComments.tsx` — passe au hook partagé, gagne `@scratchpad:`.
- `packages/web/src/components/tickets/TicketComments.test.tsx` — un cas pour `@scratchpad:` dans le sélecteur.
- `packages/web/src/components/scratchpad/ScratchpadMainView.tsx` — passe au hook partagé.
- `packages/web/src/components/scratchpad/ScratchpadMainView.mentions.test.tsx` — les huit kinds.
- `packages/web/src/components/tickets/TicketDetail.tsx` — sélecteur sur la description.
- `README.md`

---

### Task 1: La routine gagne une identité de mention

Prérequis de tout le reste : sans elle, ni la puce ni le sélecteur ne peuvent typer une routine.

**Files:**
- Modify: `packages/web/src/components/ui/MentionTypeBadge.tsx:9,16-24`
- Test: `packages/web/src/components/ui/MentionTypeBadge.test.tsx`

**Interfaces:**
- Consumes: rien.
- Produces: `MentionTargetType` inclut `'routine'` ; `MENTION_TYPE_META.routine = { letter: 'R', hue: 'indigo' }`.

- [ ] **Step 1: Write the failing test**

Ajouter à `packages/web/src/components/ui/MentionTypeBadge.test.tsx`, dans le style du fichier :

```tsx
  it('renders a routine badge with its own letter and hue', () => {
    // A routine is not a launchable primitive, so it has no glyph — the lettered
    // badge is its identity, and it must not collide with another type's hue.
    const { container } = render(<MentionTypeBadge type="routine" />);
    expect(container.textContent).toBe('R');
  });

  it('gives every mention type a distinct letter', () => {
    const letters = Object.values(MENTION_TYPE_META).map((m) => m.letter);
    expect(new Set(letters).size).toBe(letters.length);
  });

  it('gives every mention type a distinct hue', () => {
    const hues = Object.values(MENTION_TYPE_META).map((m) => m.hue);
    expect(new Set(hues).size).toBe(hues.length);
  });
```

Importer `MENTION_TYPE_META` en plus de ce que le fichier importe déjà.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@fleex/web' test -- --run MentionTypeBadge`
Expected: FAIL — `type="routine"` ne typecheck pas et le badge rend vide.

- [ ] **Step 3: Add the type and its meta entry**

Dans `packages/web/src/components/ui/MentionTypeBadge.tsx`, ligne 9 :

```ts
export type MentionTargetType = 'agent' | 'human' | 'panel' | 'skill' | 'workflow' | 'ticket' | 'scratchpad' | 'routine';
```

Et dans `MENTION_TYPE_META`, après `scratchpad` :

```ts
  routine: { letter: 'R', hue: 'indigo' },
```

`indigo` est libre : `teal` est pris par `scratchpad`, et les six autres teintes le sont par les types préexistants. Mettre à jour le commentaire de doc du type pour mentionner les routines aux côtés des cibles de mention du serveur.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter '@fleex/web' test -- --run MentionTypeBadge`
Expected: PASS. Les deux tests d'unicité sont le garde-fou : ils échoueront si quelqu'un réutilise une lettre ou une teinte plus tard.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/ui/MentionTypeBadge.tsx packages/web/src/components/ui/MentionTypeBadge.test.tsx
git commit -m "feat(web): give routines a mention identity"
```

---

### Task 2: La puce de référence

**Files:**
- Create: `packages/web/src/components/markdown/PrimitiveRefChip.tsx`
- Create: `packages/web/src/components/markdown/PrimitiveRefChip.test.tsx`

**Interfaces:**
- Consumes: `MentionTargetType` incluant `routine` (Task 1) ; `MentionTypeIcon` de `../../lib/primitives`.
- Produces:
  - `type PrimitiveRefKind = 'agent' | 'panel' | 'skill' | 'workflow' | 'routine'`
  - `PrimitiveRefChip({ kind, name }: { kind: PrimitiveRefKind; name: string })`

**Champs de résolution, vérifiés dans les stores** — n'en inventez aucun :

| kind | store · sélecteur | champ mentionné | libellé affiché |
|---|---|---|---|
| `agent` | `useAgentPersonaStore` · `s.personas` | `name` | `name` |
| `panel` | `usePanelStore` · `s.panels` | `name` | `name` |
| `skill` | `useSkillStore` · `s.skills` | `commandName` | `commandName` |
| `workflow` | `useWorkflowTemplateStore` · `s.templates` | `slug` | `name` |
| `routine` | `useRoutineStore` · `s.routines` | `slug` | `name` |

Attention : le store des workflows expose `templates`, **pas** `workflowTemplates`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/markdown/PrimitiveRefChip.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { PrimitiveRefChip } from './PrimitiveRefChip';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { useSkillStore } from '../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useUIStore } from '../../stores/uiStore';

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAgentPersonaStore.setState({ personas: [{ id: 'p1', name: 'catalyst' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  usePanelStore.setState({ panels: [{ id: 'pa1', name: 'squad' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useSkillStore.setState({ skills: [{ id: 's1', commandName: 'commit' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useWorkflowTemplateStore.setState({ templates: [{ id: 'w1', slug: 'deploy', name: 'Deploy' }] as any });
  useRoutineStore.setState({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    routines: [{ id: 'r1', slug: 'daily', name: 'Daily recap' }] as any,
    // Stubbed: the real action is async and fetches run history, which in jsdom
    // would leave an unhandled rejection and make this flaky for a reason that
    // has nothing to do with the chip. Which panel opens is what matters here.
    select: async () => {},
  });
});

afterEach(cleanup);

// A reference chip points somewhere; it never dispatches. These cases pin the
// destination for each kind, because four of the five share a panel and one
// does not.
describe('PrimitiveRefChip — navigation', () => {
  it('opens an agent in the agents panel', () => {
    const { getByRole } = render(<PrimitiveRefChip kind="agent" name="catalyst" />);
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('agents');
    expect(useAgentPersonaStore.getState().selectedPersonaId).toBe('p1');
  });

  it('opens a panel', () => {
    const { getByRole } = render(<PrimitiveRefChip kind="panel" name="squad" />);
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('agents');
    expect(usePanelStore.getState().selectedPanelId).toBe('pa1');
  });

  it('opens a skill by its command name', () => {
    const { getByRole } = render(<PrimitiveRefChip kind="skill" name="commit" />);
    fireEvent.click(getByRole('button'));
    expect(useSkillStore.getState().selectedSkillId).toBe('s1');
  });

  it('opens a workflow by its slug', () => {
    const { getByRole } = render(<PrimitiveRefChip kind="workflow" name="deploy" />);
    fireEvent.click(getByRole('button'));
    expect(useWorkflowTemplateStore.getState().selectedWorkflowId).toBe('w1');
  });

  it('opens a routine in the routines panel, not the agents one', () => {
    // The routine is the exception: its own panel, and `select` is async because
    // it loads the run history.
    const { getByRole } = render(<PrimitiveRefChip kind="routine" name="daily" />);
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('routines');
  });
});

describe('PrimitiveRefChip — label and degradation', () => {
  it('shows the readable name, never the raw syntax', () => {
    const { container } = render(<PrimitiveRefChip kind="agent" name="catalyst" />);
    expect(container.textContent).toContain('catalyst');
    expect(container.textContent).not.toContain('@agent:');
  });

  it('prefers a workflow display name over its slug', () => {
    const { container } = render(<PrimitiveRefChip kind="workflow" name="deploy" />);
    expect(container.textContent).toContain('Deploy');
  });

  it('degrades an unknown name to the text the author typed', () => {
    // Primitives are deletable; a chip leading nowhere is worse than the syntax.
    const { container, queryByRole } = render(<PrimitiveRefChip kind="agent" name="deleted" />);
    expect(container.textContent).toBe('@agent:deleted');
    expect(queryByRole('button')).toBeNull();
  });

  it('carries no remove affordance', () => {
    // The comment surface's actionable mention has one; a reference must not,
    // or it reads as something that can be cancelled.
    const { container } = render(<PrimitiveRefChip kind="agent" name="catalyst" />);
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@fleex/web' test -- --run PrimitiveRefChip`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the chip**

Create `packages/web/src/components/markdown/PrimitiveRefChip.tsx`:

```tsx
import { MentionTypeIcon } from '../../lib/primitives';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useSkillStore } from '../../stores/skillStore';
import { useUIStore } from '../../stores/uiStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';

/**
 * Inline chip for a primitive reference on a surface where nothing dispatches.
 *
 * The comment composer renders these same mentions as *actionable* — tied to a
 * run record, with a cross to cancel it. Everywhere else the mention is a
 * pointer, so this chip is outlined rather than filled and carries no cross: the
 * reader can tell the two apart without reading them side by side.
 *
 * Clicking opens the primitive's configuration view. Four of the five kinds live
 * in the `agents` panel; the routine has its own, and its `select` is async.
 */
export type PrimitiveRefKind = 'agent' | 'panel' | 'skill' | 'workflow' | 'routine';

interface Resolved {
  id: string;
  label: string;
}

export function PrimitiveRefChip({ kind, name }: { kind: PrimitiveRefKind; name: string }) {
  // Every store is read unconditionally: a hook cannot sit behind a branch, and
  // a zustand selector returning the store's own array reference is cheap.
  const personas = useAgentPersonaStore((s) => s.personas);
  const panels = usePanelStore((s) => s.panels);
  const skills = useSkillStore((s) => s.skills);
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const routines = useRoutineStore((s) => s.routines);

  const resolved = resolve(kind, name, { personas, panels, skills, templates, routines });

  // A name no store knows degrades to the text the author typed. Primitives are
  // deletable, and a chip that leads nowhere is worse than the raw syntax.
  if (!resolved) return <span>@{kind}:{name}</span>;

  const open = () => {
    if (kind === 'routine') {
      useUIStore.getState().setActivePanel('routines');
      // Async because it loads the run history — the only one of the five.
      void useRoutineStore.getState().select(resolved.id);
      return;
    }
    useUIStore.getState().setActivePanel('agents');
    if (kind === 'agent') useAgentPersonaStore.getState().selectPersona(resolved.id);
    else if (kind === 'panel') usePanelStore.getState().selectPanel(resolved.id);
    else if (kind === 'skill') useSkillStore.getState().selectSkill(resolved.id);
    else useWorkflowTemplateStore.getState().selectWorkflow(resolved.id);
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      title={`${kind}: ${resolved.label}`}
      className="inline-flex max-w-full items-baseline gap-1 rounded-sm border border-[var(--theme-border)] px-1 py-px align-baseline text-[var(--theme-text-secondary)] transition-colors hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
    >
      <MentionTypeIcon type={kind} size="sm" className="self-center" />
      <span className="truncate">{resolved.label}</span>
    </button>
  );
}

/**
 * Match the mentioned name against the field each kind is mentioned by.
 *
 * The fields differ per kind — a skill is mentioned by its command name, a
 * workflow and a routine by their slug — so this cannot be one generic lookup.
 * The displayed label prefers a human name where the entity has one.
 */
function resolve(
  kind: PrimitiveRefKind,
  name: string,
  stores: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    personas: any[]; panels: any[]; skills: any[]; templates: any[]; routines: any[];
  },
): Resolved | null {
  switch (kind) {
    case 'agent': {
      const hit = stores.personas.find((p) => p.name === name);
      return hit ? { id: hit.id, label: hit.name } : null;
    }
    case 'panel': {
      const hit = stores.panels.find((p) => p.name === name);
      return hit ? { id: hit.id, label: hit.name } : null;
    }
    case 'skill': {
      const hit = stores.skills.find((s) => s.commandName === name);
      return hit ? { id: hit.id, label: hit.commandName } : null;
    }
    case 'workflow': {
      const hit = stores.templates.find((t) => t.slug === name);
      return hit ? { id: hit.id, label: hit.name || hit.slug } : null;
    }
    case 'routine': {
      const hit = stores.routines.find((r) => r.slug === name);
      return hit ? { id: hit.id, label: hit.name || hit.slug } : null;
    }
  }
}
```

Note sur le style : la bordure reste neutre et c'est le glyphe qui porte la teinte du kind. Cinq puces dans un paragraphe avec cinq bordures colorées transformeraient le texte en arc-en-ciel ; le glyphe suffit à identifier le kind.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run --filter '@fleex/web' test -- --run PrimitiveRefChip`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/markdown/PrimitiveRefChip.tsx packages/web/src/components/markdown/PrimitiveRefChip.test.tsx
git commit -m "feat(web): add a reference chip for the five primitives"
```

---

### Task 3: Fusionner les préprocesseurs et allumer les puces

Un seul livrable : la fusion sans les branches de rendu produirait des liens morts, et les branches sans la fusion seraient du code jamais atteint. Les deux ensemble sont testables de bout en bout.

**Files:**
- Modify: `packages/web/src/components/markdown/mentions.ts`
- Modify: `packages/web/src/components/markdown/mentions.test.ts:6,117`
- Modify: `packages/web/src/components/scratchpad/MarkdownRenderer.tsx`
- Create: `packages/web/src/components/markdown/MarkdownRenderer.primitives.test.tsx`

**Interfaces:**
- Consumes: `PrimitiveRefChip`, `PrimitiveRefKind` (Task 2).
- Produces: `preprocessMentions(body: string): string` est le **seul** préprocesseur ; `preprocessReferences` et `REFERENCE_MENTION` n'existent plus.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/markdown/MarkdownRenderer.primitives.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MarkdownRenderer } from '../scratchpad/MarkdownRenderer';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { useSkillStore } from '../../stores/skillStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useUIStore } from '../../stores/uiStore';

const noop = () => {};

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useAgentPersonaStore.setState({ personas: [{ id: 'p1', name: 'catalyst' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useSkillStore.setState({ skills: [{ id: 's1', commandName: 'commit' }] as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useRoutineStore.setState({ routines: [{ id: 'r1', slug: 'daily', name: 'Daily recap' }] as any });
});

afterEach(cleanup);

// The generic renderer backs notes, the ticket description, deliverables, the
// assistant transcript and all of mobile — so a primitive resolved here is
// resolved on every one of them.
describe('MarkdownRenderer — primitive references', () => {
  it('renders an agent reference as a chip that navigates', () => {
    const { getByRole } = render(
      <MarkdownRenderer content="ask @agent:catalyst about it" onToggleCheckbox={noop} />,
    );
    fireEvent.click(getByRole('button'));
    expect(useUIStore.getState().activePanel).toBe('agents');
    expect(useAgentPersonaStore.getState().selectedPersonaId).toBe('p1');
  });

  it('renders a skill reference', () => {
    const { container } = render(
      <MarkdownRenderer content="run @skill:commit first" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('commit');
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders a routine reference with its display name', () => {
    const { container } = render(
      <MarkdownRenderer content="see @routine:daily" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('Daily recap');
  });

  it('renders a struck mention as strikethrough, not a link', () => {
    const { container } = render(
      <MarkdownRenderer content="~~@agent:catalyst~~ is done" onToggleCheckbox={noop} />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('catalyst');
  });

  it('renders a human mention as a pill that does not navigate', () => {
    const before = useUIStore.getState().activePanel;
    const { container } = render(
      <MarkdownRenderer content="asked @olivier" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('@olivier');
    expect(container.querySelector('a')).toBeNull();
    expect(useUIStore.getState().activePanel).toBe(before);
  });

  it('leaves a primitive inside a code span alone', () => {
    const { container, queryByRole } = render(
      <MarkdownRenderer content="write `@agent:catalyst` verbatim" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('@agent:catalyst');
    expect(queryByRole('button')).toBeNull();
  });

  it('degrades an unknown primitive to plain text', () => {
    const { container, queryByRole } = render(
      <MarkdownRenderer content="ask @agent:deleted" onToggleCheckbox={noop} />,
    );
    expect(container.textContent).toContain('@agent:deleted');
    expect(queryByRole('button')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@fleex/web' test -- --run MarkdownRenderer.primitives`
Expected: FAIL — la surface générique n'encode pas encore ces mentions, donc aucune puce.

- [ ] **Step 3: Delete the second preprocessor**

Dans `packages/web/src/components/markdown/mentions.ts` :

- Supprimer `REFERENCE_MENTION` et `preprocessReferences` entièrement.
- Garder `ALL_MENTIONS` et `preprocessMentions` tels quels — ils encodent déjà les huit formes.
- Réécrire le commentaire d'en-tête du fichier : il décrit deux points d'entrée, il n'y en a plus qu'un. Dire que la fonction sert **toutes** les surfaces, et que la différence entre elles est désormais dans leur override `a`, pas dans l'encodage.

- [ ] **Step 4: Rename the stale test describes**

Dans `packages/web/src/components/markdown/mentions.test.ts`, les blocs des lignes 6 et 117 nomment `preprocessReferences`. Remplacer l'import et les appels par `preprocessMentions`, et renommer les deux `describe` :

- ligne 6 → `describe('preprocessMentions — tickets and notes', () => {`
- ligne 117 → `describe('preprocessMentions — note references on a generic surface', () => {`

**Les attentes ne changent pas** sauf là où l'ancien générique laissait quelque chose verbatim que le processeur unique encode désormais. Faites tourner le fichier et corrigez uniquement les attentes réellement invalidées par la fusion — pour chacune, notez dans le rapport laquelle et pourquoi. Une attente modifiée sans justification est un défaut.

- [ ] **Step 5: Add the seven branches to the shared renderer**

Dans `packages/web/src/components/scratchpad/MarkdownRenderer.tsx`, remplacer l'import de `preprocessReferences` par `preprocessMentions`, ajouter :

```ts
import { PrimitiveRefChip, type PrimitiveRefKind } from '../markdown/PrimitiveRefChip';
```

et, au-dessus du composant :

```ts
/**
 * Href prefix per primitive kind.
 *
 * The encoded value keeps its own kind prefix — `#fleex-agent:agent:catalyst` —
 * because the encoder strips only the `@`. Two pre-existing tests and the comment
 * renderer depend on that, so the name is recovered by stripping it here.
 */
const PRIMITIVE_HREF: Array<[string, PrimitiveRefKind]> = [
  ['#fleex-agent:', 'agent'],
  ['#fleex-panel:', 'panel'],
  ['#fleex-skill:', 'skill'],
  ['#fleex-workflow:', 'workflow'],
  ['#fleex-routine:', 'routine'],
];
```

Puis, dans l'override `a`, après la branche `#fleex-scratchpad:` :

```tsx
      // Struck mention — the comment surface means "resolved/removed"; here it is
      // simply what a strikethrough looks like.
      if (href?.startsWith('#fleex-struck:')) {
        return (
          <span className="line-through text-[var(--theme-text-muted)] opacity-60">{children}</span>
        );
      }
      // Human mention — there is no person page to open, so it stays a pill.
      if (href?.startsWith('#fleex-human:')) {
        return (
          <span className="rounded-sm bg-[var(--theme-bg-overlay)] px-1 py-px text-[var(--theme-text-secondary)]">
            {children}
          </span>
        );
      }
      // Primitive reference — a pointer to a configuration page, never a trigger.
      for (const [prefix, kind] of PRIMITIVE_HREF) {
        if (href?.startsWith(prefix)) {
          const name = href.slice(prefix.length).replace(/^[a-z]+:/, '');
          return <PrimitiveRefChip kind={kind} name={name} />;
        }
      }
```

Mettre à jour le commentaire au-dessus du memo `processed` : il parle de `@ticket:` et `@scratchpad:` ; il couvre désormais les huit formes.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run --filter '@fleex/web' test -- --run MarkdownRenderer.primitives`
Expected: PASS, 7 tests.

Run: `bun run --filter '@fleex/web' test -- --run mentions`
Expected: PASS.

Run: `bun run --filter '@fleex/web' test`
Expected: PASS, suite entière. La baseline est 77 fichiers / 658 tests ; vous ajoutez un fichier et sept tests. **Le filet le plus important de ce chantier** : `TicketComments` doit rester intégralement vert, parce que la fusion touche le préprocesseur qu'il utilise.

Run: `bun run --filter '@fleex/web' build`
Expected: succès.

- [ ] **Step 7: Commit**

```bash
git add -A packages/web/src/components/markdown packages/web/src/components/scratchpad
git commit -m "feat(web): render every mention type on every markdown surface

The two preprocessors were identical but for their vocabulary. One
remains, and the shared renderer grew the branches it was missing —
so a note can now cite an agent, a skill, a panel, a workflow or a
routine, each pointing at its configuration page."
```

---

### Task 4: La liste des options, construite une fois

**Files:**
- Create: `packages/web/src/components/markdown/useAllMentionOptions.ts`
- Create: `packages/web/src/components/markdown/useAllMentionOptions.test.ts`
- Modify: `packages/web/src/components/tickets/TicketComments.tsx` (bloc `allMentionOptions`, vers 625-680)
- Modify: `packages/web/src/components/tickets/TicketComments.test.tsx`

**Interfaces:**
- Consumes: `MentionOption` de `./MentionMenu` ; `MentionTargetType` incluant `routine` (Task 1).
- Produces: `useAllMentionOptions(): MentionOption[]` — les huit kinds, tickets et notes marqués `deferred`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/components/markdown/useAllMentionOptions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAllMentionOptions } from './useAllMentionOptions';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { useSkillStore } from '../../stores/skillStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTicketStore } from '../../stores/ticketStore';

beforeEach(() => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  useAgentPersonaStore.setState({ personas: [{ id: 'p1', name: 'catalyst', enabled: true }] as any });
  usePanelStore.setState({ panels: [{ id: 'pa1', name: 'squad', enabled: true }] as any });
  useSkillStore.setState({ skills: [{ id: 's1', commandName: 'commit', enabled: true }] as any });
  useWorkflowTemplateStore.setState({ templates: [{ id: 'w1', slug: 'deploy', name: 'Deploy', enabled: true }] as any });
  useRoutineStore.setState({ routines: [{ id: 'r1', slug: 'daily', name: 'Daily recap' }] as any });
  useScratchpadStore.setState({ scratchpadList: [{ key: '__global__', label: 'Global', lineCount: 3 }] as any });
  useTicketStore.setState({ tickets: [{ id: 't1', displayId: 42, title: 'Tokens expire' }] as any });
  // The hook only offers a human option when this setting is present, so the
  // eighth kind is untestable without it.
  useSettingsStore.setState({
    settings: { ...useSettingsStore.getState().settings, humanMentionName: 'olivier' } as any,
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});

describe('useAllMentionOptions', () => {
  it('offers all eight kinds', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    const kinds = new Set(result.current.map((o) => o.type));
    expect(kinds).toEqual(new Set(['agent', 'panel', 'skill', 'workflow', 'routine', 'scratchpad', 'ticket', 'human']));
  });

  it('spells the global note `global`, never its storage key', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    const note = result.current.find((o) => o.type === 'scratchpad');
    expect(note?.insertText).toBe('@scratchpad:global');
  });

  it('marks tickets deferred so a bare @ does not dump them all', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    expect(result.current.find((o) => o.type === 'ticket')?.deferred).toBe(true);
  });

  it('does not defer the primitives, which are few', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    for (const kind of ['agent', 'panel', 'skill', 'workflow', 'routine']) {
      expect(result.current.find((o) => o.type === kind)?.deferred).not.toBe(true);
    }
  });

  it('inserts a skill by its command name and a workflow by its slug', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    expect(result.current.find((o) => o.type === 'skill')?.insertText).toBe('@skill:commit');
    expect(result.current.find((o) => o.type === 'workflow')?.insertText).toBe('@workflow:deploy');
  });

  it('inserts a routine by its slug and labels it by its name', () => {
    const { result } = renderHook(() => useAllMentionOptions());
    const routine = result.current.find((o) => o.type === 'routine');
    expect(routine?.insertText).toBe('@routine:daily');
    expect(routine?.label).toBe('Daily recap');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@fleex/web' test -- --run useAllMentionOptions`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Write the hook**

Create `packages/web/src/components/markdown/useAllMentionOptions.ts`. Reprendre la construction existante de `TicketComments` — y compris ses filtres `enabled` et son emoji de workflow — et y ajouter les notes et les routines :

```ts
import { useMemo } from 'react';
import { GLOBAL_NOTE_KEY } from '@fleex/shared';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { usePanelStore } from '../../stores/panelStore';
import { useRoutineStore } from '../../stores/routineStore';
import { useScratchpadStore } from '../../stores/scratchpadStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSkillStore } from '../../stores/skillStore';
import { useTicketStore } from '../../stores/ticketStore';
import { useWorkflowTemplateStore } from '../../stores/workflowTemplateStore';
import type { MentionOption } from './MentionMenu';

/**
 * Every mention a Fleex editor can offer, in one place.
 *
 * Built once and shared, because three editors need the same list and three
 * copies of it would drift. What each *surface* does with a mention still
 * differs — a comment dispatches, a note points — but that is the renderer's
 * business, not the picker's.
 *
 * Tickets and notes are `deferred`: they can be numerous, so they stay hidden
 * until the user types a query and are capped by the autocomplete.
 */
export function useAllMentionOptions(): MentionOption[] {
  const personas = useAgentPersonaStore((s) => s.personas);
  const panels = usePanelStore((s) => s.panels);
  const skills = useSkillStore((s) => s.skills);
  const templates = useWorkflowTemplateStore((s) => s.templates);
  const routines = useRoutineStore((s) => s.routines);
  const scratchpadList = useScratchpadStore((s) => s.scratchpadList);
  const tickets = useTicketStore((s) => s.tickets);
  const humanMentionName = useSettingsStore(
    (s) => (s.settings as unknown as Record<string, unknown>)['humanMentionName'] as string | undefined,
  );

  return useMemo<MentionOption[]>(() => {
    const opts: MentionOption[] = [];

    for (const p of personas) {
      opts.push({ insertText: `@agent:${p.name}`, label: p.displayName || p.name, type: 'agent' });
    }
    for (const panel of panels) {
      if (panel.enabled === false) continue;
      opts.push({ insertText: `@panel:${panel.name}`, label: panel.displayName || panel.name, type: 'panel' });
    }
    for (const skill of skills) {
      if (skill.enabled === false) continue;
      opts.push({ insertText: `@skill:${skill.commandName}`, label: skill.displayName || skill.commandName, type: 'skill' });
    }
    for (const wf of templates) {
      if (wf.enabled === false) continue;
      opts.push({ insertText: `@workflow:${wf.slug}`, label: wf.emoji ? `${wf.emoji} ${wf.name}` : wf.name, type: 'workflow' });
    }
    for (const r of routines) {
      opts.push({ insertText: `@routine:${r.slug}`, label: r.emoji ? `${r.emoji} ${r.name}` : r.name, type: 'routine' });
    }
    for (const note of scratchpadList) {
      // The reference syntax spells the global note `global`; `__global__` is a
      // storage key and must never reach the document.
      opts.push({
        insertText: `@scratchpad:${note.key === GLOBAL_NOTE_KEY ? 'global' : note.key}`,
        label: note.label,
        type: 'scratchpad',
        deferred: true,
      });
    }
    if (humanMentionName) {
      opts.push({ insertText: `@${humanMentionName}`, label: humanMentionName, type: 'human' });
    }
    for (const t of tickets) {
      opts.push({ insertText: `@ticket:${t.displayId}`, label: `#${t.displayId} ${t.title}`, type: 'ticket', deferred: true });
    }
    return opts;
  }, [personas, panels, skills, templates, routines, scratchpadList, tickets, humanMentionName]);
}
```

Le test `offers all eight kinds` avec une seule note attend `scratchpad` présent : `deferred` n'exclut pas de la liste, il conditionne seulement l'affichage. Si le test échoue, c'est le test qui a raison — vérifiez que rien ne filtre les `deferred` à la construction.

- [ ] **Step 4: Rewire TicketComments onto the hook**

Remplacer le `useMemo` `allMentionOptions` et les sept lectures de store qui l'alimentent par :

```ts
  const allMentionOptions = useAllMentionOptions();
```

Supprimer les lectures de store devenues inutilisées — mais **seulement celles-là**. `TicketComments` lit `personas`, `panels`, `skills` et `templates` pour d'autres raisons (le garde de repo manquant, les cartes de mention) : vérifiez chaque symbole avant de le retirer. `packages/web/tsconfig.json` a `noUnusedLocals: false`, donc le build ne vous le dira pas.

- [ ] **Step 5: Add the comment-surface test**

Dans `packages/web/src/components/tickets/TicketComments.test.tsx`, ajouter au bloc existant :

```tsx
  it('renders a @scratchpad: reference in a comment as a chip', () => {
    renderBody('conventions in @scratchpad:acme/app');
    const chip = screen.getByText('@scratchpad:acme/app');
    expect(chip.closest('a')).toBeNull();
  });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run --filter '@fleex/web' test -- --run useAllMentionOptions`
Expected: PASS, 6 tests.

Run: `bun run --filter '@fleex/web' test -- --run TicketComments`
Expected: PASS. **C'est la non-régression qui compte** : les mentions actionnables des commentaires doivent être intactes.

Run: `bun run --filter '@fleex/web' test && bun run --filter '@fleex/web' build`
Expected: les deux verts.

- [ ] **Step 7: Commit**

```bash
git add -A packages/web/src/components/markdown packages/web/src/components/tickets
git commit -m "refactor(web): build the mention option list once

Three editors need the same eight kinds; three copies would drift. The
comment composer gains @scratchpad: on the way, which it rendered but
never suggested."
```

---

### Task 5: Les trois sélecteurs

**Files:**
- Modify: `packages/web/src/components/scratchpad/ScratchpadMainView.tsx`
- Modify: `packages/web/src/components/scratchpad/ScratchpadMainView.mentions.test.tsx`
- Modify: `packages/web/src/components/tickets/TicketDetail.tsx` (l'appel `MarkdownEditor` de l'onglet description, vers 281)

**Interfaces:**
- Consumes: `useAllMentionOptions` (Task 4) ; `useMentionAutocomplete` et `MentionMenu` (chantier précédent).
- Produces: rien.

- [ ] **Step 1: Write the failing test**

Dans `packages/web/src/components/scratchpad/ScratchpadMainView.mentions.test.tsx`, remplacer le cas `offers no agent, skill, panel or workflow` — la décision produit s'est inversée — par :

```tsx
  it('offers the primitives too, now that a note can cite them', () => {
    const { container, getByText } = render(<ScratchpadMainView scratchpadKey="__global__" />);
    typeAt(container.querySelector('textarea')!, '@');
    expect(getByText('catalyst')).toBeTruthy();
    expect(getByText('commit')).toBeTruthy();
  });
```

et alimenter les stores de primitives dans le `beforeEach` du fichier, dans le style déjà présent :

```tsx
  /* eslint-disable @typescript-eslint/no-explicit-any */
  useAgentPersonaStore.setState({ personas: [{ id: 'p1', name: 'catalyst' }] as any });
  useSkillStore.setState({ skills: [{ id: 's1', commandName: 'commit' }] as any });
  /* eslint-enable @typescript-eslint/no-explicit-any */
```

Ajouter aussi un test pour la description de ticket. Créer le fichier
`packages/web/src/components/tickets/TicketDetail.mentions.test.tsx` en suivant le harnais du fichier de test des notes — s'il faut plus de contexte de store que le composant n'en tolère, dites-le dans le rapport plutôt que de contourner en affaiblissant le test :

```tsx
  it('opens the mention menu in the description editor', () => {
    // The description never had a picker, on any primitive.
    // …render TicketDetail, type '@' in the description textarea,
    //   assert the menu lists at least one primitive.
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --filter '@fleex/web' test -- --run ScratchpadMainView`
Expected: FAIL — le menu ne propose que notes et tickets.

- [ ] **Step 3: Switch the note editor to the shared list**

Dans `packages/web/src/components/scratchpad/ScratchpadMainView.tsx`, remplacer le `useMemo` `mentionOptions` et les lectures `scratchpadList` / `tickets` qui l'alimentent par :

```ts
  const mentionOptions = useAllMentionOptions();
```

Garder `scratchpadList`, `scratchpadListLoaded`, `loadScratchpadList` et `resolvedRepositories` : l'effet qui charge la liste des notes en dépend toujours, et c'est lui qui garantit que le hook a des notes à offrir quand la sidebar n'est pas montée. Supprimer l'import `GLOBAL_NOTE_KEY` **seulement** s'il n'est plus utilisé — il l'est encore par la ligne `label`.

- [ ] **Step 4: Wire the ticket description**

Dans `packages/web/src/components/tickets/TicketDetail.tsx`, le `descTextareaRef` existe déjà. Ajouter le hook et brancher l'éditeur, en miroir de `ScratchpadMainView` :

```ts
  const descMentionOptions = useAllMentionOptions();
  const descMentionAc = useMentionAutocomplete({
    options: descMentionOptions,
    value: description,
    onChange: handleDescriptionChange,
    textareaRef: descTextareaRef,
  });
```

puis sur l'appel `MarkdownEditor` de l'onglet description :

```tsx
                textareaProps={{
                  onChange: descMentionAc.onScan,
                  onKeyDown: (e) => { descMentionAc.onKeyDown(e); },
                  onBlur: () => { setTimeout(descMentionAc.close, 150); },
                }}
                overlay={
                  descMentionAc.open && descMentionAc.filtered.length > 0 ? (
                    <MentionMenu
                      options={descMentionAc.filtered}
                      selectedIndex={descMentionAc.index}
                      onSelect={descMentionAc.accept}
                      position={{ bottom: 8, left: 8 }}
                    />
                  ) : null
                }
```

`MarkdownEditor` compose `textareaProps.onChange` après le sien, donc la description continue de se sauvegarder pendant que `onScan` tourne. Le prop `overlay` est rendu par les deux variantes depuis le chantier précédent — c'est ce qui rend ce câblage possible.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run --filter '@fleex/web' test -- --run ScratchpadMainView`
Expected: PASS.

Run: `bun run --filter '@fleex/web' test -- --run TicketDetail`
Expected: PASS.

Run: `bun run --filter '@fleex/web' test && bun run --filter '@fleex/web' build`
Expected: les deux verts.

- [ ] **Step 6: Commit**

```bash
git add -A packages/web/src/components/scratchpad packages/web/src/components/tickets
git commit -m "feat(web): offer every mention in the note and description editors

The description never had a picker on any primitive; the note editor
had one on two of eight."
```

---

### Task 6: Documentation et balayage de régression

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: rien.

- [ ] **Step 1: Confirm no consumer of the deleted preprocessor survives**

```bash
grep -rn "preprocessReferences\|REFERENCE_MENTION" packages/
```

Expected: aucune sortie. S'il en reste, un consommateur a été oublié à la tâche 3.

- [ ] **Step 2: Confirm the comment surface still renders its own way**

```bash
grep -n "MentionSpan\|onRemoveMention" packages/web/src/components/tickets/TicketComments.tsx | head -5
```

Expected: présents. Les mentions actionnables des commentaires doivent avoir survécu à tout le chantier — c'est la contrainte que la spec protège.

- [ ] **Step 3: Update the README**

La phrase actuelle dit que le sélecteur `@` vit dans l'éditeur de notes principal. C'est désormais faux dans l'autre sens : il vit dans trois éditeurs, et les puces s'affichent partout. Réécrire le paragraphe pour dire :

- la syntaxe des huit formes, avec un exemple par famille (`@agent:`, `@scratchpad:`, `@ticket:`) ;
- qu'un `@` ouvre le sélecteur dans une note, une description de ticket et un commentaire ;
- que hors commentaire une mention de primitive est une **référence** qui ouvre sa page de config, et que dans un commentaire elle **déclenche** — c'est la distinction que l'utilisateur doit connaître, et elle n'est documentée nulle part.

Garder le registre du README et rester à deux ou trois phrases.

- [ ] **Step 4: Full verification**

Run: `bun run --filter '@fleex/web' test`
Expected: PASS, tous fichiers. Baseline avant ce chantier : 77 / 658.

Run: `bun run --filter '@fleex/web' build && bun run --filter '@fleex/server' test`
Expected: verts. Le serveur n'est pas touché par ce chantier ; sa suite est là pour le prouver.

- [ ] **Step 5: Manual end-to-end, written out for the controller**

Vous n'avez pas de navigateur. **Ne tentez pas cette étape et ne la simulez pas.** Écrivez dans votre rapport les gestes exacts à jouer, pour que le contrôleur les exécute :

- dans une note, taper `@` et vérifier que les huit familles apparaissent ;
- choisir un agent, passer en aperçu, cliquer la puce → la page de config de l'agent s'ouvre ;
- refaire avec une routine → c'est le panneau `routines` qui s'ouvre, pas `agents` ;
- dans un commentaire, taper `@` et vérifier que `@scratchpad:` est proposé ;
- dans un commentaire, mentionner un agent et vérifier que ça **déclenche toujours** et que la croix d'annulation est là ;
- dans la description d'un ticket, taper `@` → le menu s'ouvre.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document the eight mention forms and the two modes"
```

---

## Auto-revue

**Couverture de la spec** — §1 vocabulaire → T3 (rendu) et T4 (sélecteur). §2 navigation non uniforme → T2, testée explicitement pour la routine. §3 résolution nom → entité → T2, avec la table des champs vérifiés. §4 le composant unique et les deux lacunes de données → T1 (identité de la routine) et T2 (le composant). §5 fusion des préprocesseurs → T3. §6 branches du renderer → T3. §7 les trois sélecteurs → T4 (commentaires) et T5 (notes, description). §8 rendu des commentaires inchangé → contrainte globale, plus les vérifications de T4 step 6 et T6 step 2. §9 tests → répartis, un bloc par tâche.

**Cohérence des types** — `PrimitiveRefKind` est défini une fois (T2) et consommé sous ce nom en T3. `MentionOption` vient de `MentionMenu`, inchangé. `MentionTargetType` gagne `routine` en T1, avant son premier usage en T2. `useAllMentionOptions` est produit en T4 et consommé en T4 et T5. Les sélecteurs de store sont ceux vérifiés : `s.templates` pour les workflows, **pas** `s.workflowTemplates`.

**Un point où le plan demande du jugement, assumé.** À la tâche 5 step 1, le test de la description de ticket est décrit plutôt qu'écrit : `TicketDetail` est un composant lourd dont le harnais de test n'existe pas encore, et deviner ses dépendances de store produirait un test faux plutôt qu'un test utile. L'implémenteur doit l'écrire d'après le harnais du fichier de notes et **signaler** si le composant demande plus de contexte qu'il n'est raisonnable — auquel cas la couverture de cette surface se limite au typecheck et à la vérification manuelle de T6 step 5. C'est le seul endroit du plan sans code exact, et c'est délibéré.

**Une attente à surveiller à la tâche 3.** La fusion peut invalider des attentes de `mentions.test.ts` là où l'ancien processeur générique laissait une mention verbatim. Le plan exige que chaque attente modifiée soit justifiée nommément dans le rapport, précisément pour que personne ne « répare » un test en le vidant.
