# Design — Ticket Workflows (DAG agentique)

> **Status** — Draft for review.
> **Ticket** — #127 _Ticket Workflows — chainage d'étapes agent avec branching sur statut_
> **Prototype inspiration** — `../fleex-lovable-workflow/` (Lovable, React Flow, mockups).

## 1. Objectif

Permettre à un ticket Fleex de porter un **workflow** : un DAG de steps typés (agent, skill, panel, human_gate) reliés par des edges conditionnelles, qui s'exécutent séquentiellement, branchent selon l'output structuré de chaque step, et se mettent en pause pour intervention humaine quand nécessaire.

Le workflow devient la 4ᵉ ressource agentique de Fleex, à côté d'**agents** (personas), **panels** et **skills**. La création/édition se fait via un éditeur visuel React Flow ; le déclenchement par mention `@workflow:slug` dans un commentaire ou via le `SmartSessionButton`.

## 2. Scope V0

**5 livrables** couverts par un seul plan d'implémentation :

- **A — Domain & persistance** : entités `WorkflowTemplate`, `WorkflowRun`, `StepRun` ; migration `017_add_workflows.ts` ; ports + repositories Supabase/SQLite.
- **B — Orchestrateur** : `RunWorkflowStepUseCase` + 4 step executor adapters ; `EdgeEvaluator` ; refactor ciblé de `ExecuteAgentUseCase` pour rendre l'`outputFormat` paramétrable.
- **C — Trigger** : mention `@workflow:slug`, handler dans `domain-event-listener.ts`, intégration `SmartSessionButton`.
- **D — UI runtime** : nouvel onglet `Workflow` dans `TicketDetail`, rendu DAG read-only via `@xyflow/react`, panneau de détail step avec actions `human_gate` (outcomes nommés).
- **E — UI éditeur** : 4ᵉ section "Workflows" dans `AgentListPanel` ; `WorkflowEditorView` plein écran (drag-and-drop palette + canvas + config panel) + `CreateWorkflowModal`.

**Hors scope V0** :

- Default-workflow-per-board
- Runs concurrents sur le même ticket
- Fan-out / fan-in (steps parallèles)
- Builder visuel pour `outputSchema` (V0 = textarea JSON Schema)
- Widget global "Active Pipelines" (image 1 du mockup)
- Versioning explicite des templates au-delà du snapshot run
- CLI dédié `fleex workflow start`
- Retry automatique sur step failure
- Timeout configurable par step
- Templates partagés / marketplace
- Compound conditions (AND/OR) sur edges
- Sub-workflows

## 3. Domain model

### 3.1 `WorkflowTemplateEntity`

Template éditable, persisté. Source des nouveaux runs.

```ts
{
  id: string                       // UUID
  name: string                     // ex. "Feature Delivery"
  slug: string                     // ex. "feature-delivery" — unique, utilisé dans @workflow:feature-delivery
  emoji: string
  description: string
  steps: WorkflowStep[]            // JSONB
  edges: WorkflowEdge[]            // JSONB
  entryStepId: string              // pointe vers steps[].id
  enabled: boolean                 // si false, n'apparait pas dans le SmartSessionButton ni résolu par mention
  createdAt: Date
  updatedAt: Date
}
```

### 3.2 `WorkflowStep` (inline, pas une table)

```ts
{
  id: string                              // unique au sein du template
  name: string                            // ex. "Triage", "Code Review"
  executorType: 'agent' | 'skill' | 'panel' | 'human_gate'
  executorRef: string                     // selon le type :
                                          //   agent      → persona.name
                                          //   skill      → skill.commandName
                                          //   panel      → panel.name
                                          //   human_gate → "" (ignoré)
  mode?: 'talk' | 'plan' | 'edit'         // override du mode persona/skill par défaut
  outputSchema?: JsonSchema               // JSON Schema décrivant les champs custom au-delà des standards (deliverable/comment/mentionStatus)
  humanGateOutcomes?: string[]            // pour executorType='human_gate' uniquement ; ex. ["approve","reject","request_changes"] ; min 1
  position: { x: number; y: number }      // pour React Flow
}
```

### 3.3 `WorkflowEdge`

```ts
{
  id: string
  source: string                          // step.id source
  target: string                          // step.id cible
  isDefault: boolean                      // edge fallback si aucune condition ne match
  condition?: {
    field: string                         // ex. "path", "outcome", "deliverable.status" (path pointé supporté)
    operator: 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'contains'
    value: string | string[]              // string[] uniquement pour 'in'
  }
  label?: string                          // affiché sur l'edge dans la vue runtime
}
```

### 3.4 `WorkflowRunEntity`

Instance live ou archivée. Snapshot du template au démarrage (immutable).

```ts
{
  id: string
  ticketId: string                        // FK vers tickets.id
  templateId: string                      // FK vers workflow_templates.id (référence informative)
  templateSnapshot: {                     // JSONB — snapshot complet utilisé par le run
    name: string
    emoji: string
    steps: WorkflowStep[]
    edges: WorkflowEdge[]
    entryStepId: string
  }
  status: 'running' | 'blocked' | 'needs_review' | 'completed' | 'failed' | 'cancelled'
  currentStepId: string | null            // null avant démarrage / après complétion
  triggeredBy: string                     // userName | personaName | "@workflow:slug"
  triggeredFrom: string                   // "comment:<id>" | "smart-button" | "api"
  startedAt: Date
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
```

**Invariant** : au plus un `WorkflowRun` avec `status IN ('running', 'blocked', 'needs_review')` par `ticketId`. Vérifié dans `CreateWorkflowRunUseCase` (renvoie 409 sinon).

### 3.5 `StepRunEntity` (append-only)

Une row par exécution d'un step. Les retries créent une nouvelle row avec `attempt = max + 1`.

```ts
{
  id: string;
  workflowRunId: string; // FK vers workflow_runs.id
  stepId: string; // matché contre templateSnapshot.steps[].id
  attempt: number; // 1 pour le premier essai, 2 pour retry, etc.
  status: 'queued' | 'running' | 'completed' | 'failed' | 'needs_review' | 'cancelled' | 'skipped';
  result: 'ok' | 'needs_review' | 'ko' | null;
  output: StepOutput | null; // JSONB — l'output mergé (cf. §5)
  nextEdgeId: string | null; // l'edge emprunté à la sortie
  executionId: string | null; // lie aux agent_events pour les agent/skill/panel
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}
```

### 3.6 Tables & migrations

Migration unique `017_add_workflows.ts` (numéro suivant après `016_global_display_id.ts`) :

```sql
CREATE TABLE workflow_templates (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  steps JSONB NOT NULL,
  edges JSONB NOT NULL,
  entry_step_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES workflow_templates(id),
  template_snapshot JSONB NOT NULL,
  status TEXT NOT NULL,
  current_step_id TEXT,
  triggered_by TEXT NOT NULL,
  triggered_from TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_workflow_runs_ticket_status ON workflow_runs(ticket_id, status);

CREATE TABLE step_runs (
  id UUID PRIMARY KEY,
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  attempt INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  result TEXT,
  output JSONB,
  next_edge_id TEXT,
  execution_id UUID,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_step_runs_run_step ON step_runs(workflow_run_id, step_id);

-- Supabase RLS (suivant le pattern CLAUDE.md du projet)
-- Exécuté uniquement si ctx.adapter === 'supabase'
ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_workflow_templates" ON workflow_templates FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_workflow_runs" ON workflow_runs FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE step_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_step_runs" ON step_runs FOR ALL USING (true) WITH CHECK (true);
```

Le ticket lui-même n'ajoute aucune colonne — la relation est inversée (`workflow_runs.ticket_id` → `tickets.id`). Match le pattern existant (`ticket_mentions`, `ticket_comments`, `ticket_deliverables`).

## 4. Trigger & lifecycle d'un run

### 4.1 Mention `@workflow:slug`

Ajout d'un 5ᵉ pattern dans `packages/server/src/domain/entities/ticket-comment.entity.ts` :

```ts
const WORKFLOW_MENTION_PATTERN = /@workflow:([a-zA-Z0-9_-]+)/g;
```

- `static extractWorkflowMentions(body)` qui suit le pattern des trois extracteurs existants (skip struck-through `~~@workflow:xxx~~`).

Le type `MentionTargetType` dans `@fleex/shared` gagne la valeur `'workflow'` à côté de `agent | human | panel | skill`.

**Cycle de vie d'une `@workflow:` mention** : la `TicketMentionEntity` est créée comme pour les autres types (audit trail conservé), `targetAgent` reçoit le `slug`. Le handler `handleAutoTriggerWorkflow` réagit à `mention.created` : si le template existe et est `enabled`, crée le `WorkflowRun` puis appelle `resolveMention` (mention → `resolved`). Si le template est introuvable ou désactivé, la mention est marquée `resolved` silencieusement (cohérent avec le pattern `@skill:` désactivé, cf. `handleAutoTriggerSkill` lignes 234-242). Aucune transition `acknowledged` car le travail est délégué à l'orchestrateur indépendant.

### 4.2 Handler dans `domain-event-listener.ts`

Ajout aux côtés de `handleAutoTriggerAgent` / `handleAutoTriggerPanel` / `handleAutoTriggerSkill` :

```ts
bus.on('mention.created', (e) => this.handleAutoTriggerWorkflow(e as MentionCreatedEvent));

private async handleAutoTriggerWorkflow(event: MentionCreatedEvent): Promise<void> {
  if (event.targetType !== 'workflow') return;

  const template = await this.deps.workflowTemplateStore.getBySlug(event.targetAgent);
  if (!template || !template.enabled) {
    // Inconnu ou désactivé → resolve silencieusement la mention
    await this.deps.resolveMention.execute(event.mentionId);
    return;
  }

  this.deps.createWorkflowRun.execute({
    ticketId: event.ticketId,
    templateId: template.id,
    triggeredBy: event.sourceAgent,
    triggeredFrom: `comment:${event.commentId}`,
  }).catch((err) => {
    this.deps.logger.error('Workflow auto-trigger failed', {
      slug: event.targetAgent,
      ticketId: event.ticketId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
```

### 4.3 `SmartSessionButton`

`packages/web/src/components/dashboard/SmartSessionButton.tsx` charge déjà `useSkillStore`. On ajoute `useWorkflowTemplateStore` et on rend une section "Workflows" dans le dropdown, sous "Skills" (lignes ~170-185 du composant existent comme template visuel). Selection → `POST /api/workflows/runs {ticketId, templateId, triggeredFrom: 'smart-button'}`.

### 4.4 Lifecycle d'un run

```
[create]      POST /api/workflows/runs {ticketId, templateId, triggeredBy, triggeredFrom}
                ↓
              CreateWorkflowRunUseCase :
                1. Vérifie qu'aucun run sur ticketId n'a status ∈ {running, blocked, needs_review}
                   → 409 sinon
                2. Charge le template, snapshot {steps, edges, entryStepId, name, emoji}
                3. Crée le WorkflowRun (status='running', currentStepId=entryStepId)
                4. Émet workflow.run_created
                5. Enqueue orchestrator.runStep(run.id, entryStepId)

[step exec]   RunWorkflowStepUseCase (§5)

[gate]        Quand un step termine avec result='needs_review' ou type='human_gate' :
                stepRun.status='needs_review' ; run.status='needs_review'
                Attente d'une mutation API (Approve/Reject/Choose outcome)

[advance]     À la fin réussie d'un step :
                EdgeEvaluator.resolve(stepRun.output, step.outgoingEdges) → edge ou null
                  - edge trouvé : run.currentStepId=edge.target, enqueue runStep
                  - null        : run.status='completed', run.completedAt=now, currentStepId=null

[fail]        Si l'adapter throw / SDK error / max retries :
                stepRun.status='failed' ; run.status='failed' ; run.completedAt=now

[cancel]      DELETE /api/workflows/runs/:id
                Cancel le step en cours (AbortController) ; stepRun.status='cancelled' ;
                run.status='cancelled' ; run.completedAt=now
```

## 5. Orchestrateur — `RunWorkflowStepUseCase`

### 5.1 Algorithme

```
execute(workflowRunId, stepId) :
  1. Charge run + step (depuis run.templateSnapshot)
  2. Crée un StepRun (attempt = max(existing pour ce stepId) + 1, status='running', startedAt=now)
     Émet workflow.step_started
  3. Résout l'executor selon step.executorType :
       agent      → AgentStepExecutor
       skill      → SkillStepExecutor
       panel      → PanelStepExecutor
       human_gate → HumanGateStepExecutor
  4. executor.execute(StepExecutionInput) → StepOutput
  5. stepRun.output = StepOutput
     stepRun.completedAt = now
     stepRun.result = StepOutput.result
     stepRun.status = (result === 'needs_review' ? 'needs_review' : 'completed')
     Émet workflow.step_completed
  6. Si status === 'needs_review' :
       run.status = 'needs_review' ; persist ; STOP
     Sinon :
       EdgeEvaluator.resolve(StepOutput, outgoingEdges) → edge | null
         - edge : stepRun.nextEdgeId = edge.id ; run.currentStepId = edge.target ;
                  enqueue runStep(runId, edge.target)
         - null : run.status = 'completed' ; run.completedAt = now ; STOP
```

Erreurs non-recouvrables (executor throw, SDK crash, timeout) : `stepRun.status='failed'`, `run.status='failed'`, `run.completedAt=now`, log + broadcast `workflow.run_failed`.

### 5.2 Contrat des adapters

```ts
interface StepExecutor {
  execute(input: StepExecutionInput): Promise<StepOutput>;
}

type StepExecutionInput = {
  ticketId: string;
  workflowRunId: string;
  stepRunId: string;
  step: WorkflowStep;
  workflowContext: {
    workflowName: string;
    stepName: string;
    outgoingEdges: {
      id: string;
      label?: string;
      condition?: Edge['condition'];
      targetName: string;
    }[];
    previousOutputs: Record<string /* stepId */, Record<string, unknown> /* output mergé */>;
  };
};

type StepOutput = {
  deliverable?: { title: string; markdown: string; type: string; status: 'draft' | 'final' } | null;
  comment?: string | null;
  mentionStatus?: 'resolved' | 'waiting_for_info';
  schemaFields: Record<string, unknown>; // champs custom du step.outputSchema
  outcome?: string; // pour human_gate uniquement
  result: 'ok' | 'needs_review' | 'ko';
};
```

`StepOutput` est sérialisé dans `step_runs.output` directement.

### 5.3 Adapters

**`AgentStepExecutor`** — délègue à `ExecuteAgentUseCase` avec :

- Persona résolue depuis `step.executorRef` (par nom)
- Mode `step.mode ?? persona.executionMode`
- `outputFormat` = `mergeOutputSchemas(STANDARD_SCHEMA, step.outputSchema)` (cf. §5.4)
- User prompt enrichi du `workflowContext` (cf. §5.5)
- Retour : structured output du SDK décortiqué → `StepOutput` (déterminer `result` : si `mentionStatus='waiting_for_info'` → `needs_review`, sinon `ok`)

**`SkillStepExecutor`** — délègue à `ExecuteAgentUseCase.executeForSkill` avec une variante qui accepte `outputFormat` paramétrable et `workflowContext`. Skill résolu par `commandName` depuis `step.executorRef`. Mapping identique au `AgentStepExecutor`.

**`PanelStepExecutor`** — délègue à `RunPanelUseCase` avec panel résolu par `name` depuis `step.executorRef`. Le panel a sa propre logique d'orchestration ; l'adapter passe le `workflowContext` au panel via un nouveau champ optionnel `extraContext`. Le retour de `RunPanelUseCase` doit être adapté pour produire un `StepOutput` (le panel produit déjà un deliverable + comment final ; on convertit + extrait `schemaFields` du structured output du dernier agent du panel).

**`HumanGateStepExecutor`** — ne lance rien. Algorithme :

1. Validation : `step.humanGateOutcomes.length >= 1`
2. Crée un commentaire sur le ticket : « Workflow X is awaiting human decision on step "Y". Outcomes : `approve | reject | …` »
3. Retourne `{ result: 'needs_review', schemaFields: { outcomes: step.humanGateOutcomes } }` sans `outcome` (sera rempli par la mutation API)
4. L'orchestrateur passe `step_run.status='needs_review'`, `run.status='needs_review'`

L'avancement se fait par mutation API explicite (cf. §6).

### 5.4 Output schema merging

L'`OUTPUT_FORMAT_SCHEMA` actuel d'`execute-agent.ts:37-68` devient une **constante "standard"**. Pour un workflow step, on construit dynamiquement :

```ts
function mergeOutputSchemas(standard: JsonSchema, custom?: JsonSchema): JsonSchema {
  if (!custom) return standard;
  return {
    ...standard,
    schema: {
      ...standard.schema,
      properties: {
        ...standard.schema.properties,
        ...custom.properties, // champs custom au top-level
      },
      required: [...(standard.schema.required ?? []), ...(custom.required ?? [])],
    },
  };
}
```

L'agent voit donc un schéma avec `deliverable`, `comment`, `mentionStatus` **plus** les champs custom du step (ex. `path`, `priority`). Sa sortie JSON contient tout au top-level. À la réception, on sépare :

- Champs standards (deliverable/comment/mentionStatus) → posted/persisted comme aujourd'hui
- Champs custom → `schemaFields` du `StepOutput`

### 5.5 Workflow context dans le user prompt

Variante de `composeUserPrompt` (cf. `execute-agent.ts:1588`) pour les workflow steps :

```
# Ticket: ...
Status: ... | Priority: ...

## Description ...
## Comments ...
## Deliverables ...

---

## Workflow Context

You are executing step **{stepName}** of workflow **{workflowName}**.

**Expected output fields** (in addition to the standard `deliverable`/`comment`/`mentionStatus`):
- `path` (enum: standard, hotfix, doc_only) — Routing path for the next step
- `priority` (enum: low, medium, high, critical) — Detected priority

**Branching from this step**:
- If `path == "standard"` → next step: "Product Spec"
- If `path == "hotfix"`   → next step: "Development"
- If `path == "doc_only"` → next step: "Doc Update"

**Previous step outputs** (read-only context for your decision) :
- Triage: { path: "standard", priority: "high" }

---

(usual mention prompt)
```

Permet à l'agent d'aligner ses choix avec les branches du DAG.

## 6. Endpoints HTTP

| Méthode  | Route                                              | Description                                                                                                                                                                                                                                                                                                                                                |
| -------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/workflows/templates`                         | Liste tous les templates (filtres : `?enabled=true`)                                                                                                                                                                                                                                                                                                       |
| `GET`    | `/api/workflows/templates/:id`                     | Détail d'un template                                                                                                                                                                                                                                                                                                                                       |
| `POST`   | `/api/workflows/templates`                         | Create un template (validation : slug unique, entry valide, edges cohérents, JSON Schema parsable)                                                                                                                                                                                                                                                         |
| `PUT`    | `/api/workflows/templates/:id`                     | Update (full replace)                                                                                                                                                                                                                                                                                                                                      |
| `DELETE` | `/api/workflows/templates/:id`                     | Soft delete (`enabled=false`) ; reject si run actif                                                                                                                                                                                                                                                                                                        |
| `GET`    | `/api/workflows/runs?ticketId=X`                   | Liste les runs d'un ticket (actif + historique)                                                                                                                                                                                                                                                                                                            |
| `GET`    | `/api/workflows/runs/:id`                          | Détail run + tous les step_runs                                                                                                                                                                                                                                                                                                                            |
| `POST`   | `/api/workflows/runs`                              | Démarre un run `{ticketId, templateId, triggeredFrom?}`                                                                                                                                                                                                                                                                                                    |
| `DELETE` | `/api/workflows/runs/:id`                          | Cancel un run actif                                                                                                                                                                                                                                                                                                                                        |
| `POST`   | `/api/workflows/runs/:id/steps/:stepRunId/resolve` | Body : `{outcome: string, notes?: string}`. Résout un step `human_gate` en `needs_review`. Écrit `step_run.output.schemaFields.outcome = body.outcome` et, si fourni, `step_run.output.schemaFields.notes = body.notes`. Passe `step_run.status='completed'`, puis déclenche l'edge resolution (les edges sortantes peuvent matcher sur `field='outcome'`) |
| `POST`   | `/api/workflows/runs/:id/steps/:stepRunId/retry`   | Crée un nouveau StepRun (attempt+1) sur le même step ; status='queued' ; orchestrator re-déclenche                                                                                                                                                                                                                                                         |

## 7. Edge resolution — `EdgeEvaluator`

```ts
EdgeEvaluator.resolve(
  output: { deliverable?, comment?, ...schemaFields, outcome? },
  edges: WorkflowEdge[]            // edges sortantes du step terminé
): WorkflowEdge | null
```

Algorithme :

1. Split `edges` en `conditional` (avec `condition`) et `defaults` (avec `isDefault=true`).
2. Pour chaque `edge ∈ conditional` (ordre stable par `edge.id`) :
   - Extrait `actual = getByPath(output, edge.condition.field)` (supporte `"a.b.c"`)
   - Compare via `edge.condition.operator` :
     - `eq` : `actual === value`
     - `neq` : `actual !== value`
     - `in` : `Array.isArray(value) && value.includes(actual)`
     - `gt`/`lt` : `Number(actual) > / < Number(value)` (NaN → false)
     - `contains` : `typeof actual === 'string' && actual.includes(value)`
   - Si match : retourne cette edge immédiatement.
3. Aucun match : retourne la première `default` edge (si plusieurs : log warning, prendre la première par ordre `id`).
4. Aucune `default` : retourne `null` → workflow se termine ici.

## 8. UI runtime — onglet "Workflow" sur `TicketDetail`

### 8.1 Plug-in point

`packages/web/src/components/tickets/TicketDetail.tsx` (lignes 215-352 d'après l'exploration) a un système d'onglets. On ajoute un onglet `Workflow` qui s'affiche conditionnellement si `useWorkflowRunStore.getByTicket(ticketId).length > 0`.

### 8.2 Composants

**`<TicketWorkflowTab ticketId>`** — top-level :

- Charge l'actif via `workflowRunStore.activeByTicket(ticketId)` (subscribe WS).
- Charge l'historique via `workflowRunStore.historyByTicket(ticketId)`.
- Si actif présent : `<WorkflowRunView run={active} />`.
- Sinon : sélecteur historique en haut + `<WorkflowRunView run={selectedHistorical} />`.

**`<WorkflowRunView run>`** — 3 zones :

1. **Header bar** — emoji + nom + status badge + `X/N completed` + bouton "Cancel run" si actif.
2. **Canvas React Flow read-only** — `<ReactFlow>` configuré `nodesDraggable={false}`, `nodesConnectable={false}`, `elementsSelectable={true}`, avec :
   - Nodes : `<StepRunNode>` (custom node) — réplique le rendu du prototype : icône executor type colorée, nom, executorLabel, status icon, summary courte, highlight si `currentStepId`.
   - Edges : default = ligne pleine, conditional = pointillée, label affiché si présent. Animation sur l'edge active (sortant du current).
3. **Panel détail step (collapsible, à droite)** — quand un nœud est sélectionné :
   - Métadonnées : `executorType`, `executorRef`, status, attempts, durations.
   - Output JSON pretty-printed.
   - Liens : "View comment" (si comment posté), "View deliverable" (si deliverable créé), "View agent events" (si executionId).
   - Si `needs_review` et `human_gate` :
     - Section "Resolve gate" avec un bouton par outcome (`humanGateOutcomes`).
     - Textarea optionnelle "Notes" (injectée dans `previousOutputs[stepId].notes` pour le step suivant).
     - Bouton "Retry previous step" → si edge `condition.field='outcome' AND operator='eq' AND value='retry'` n'existe pas, fallback : POST `/steps/:prevStepRunId/retry`.

### 8.3 WS broadcasts

Étendre `domain-event-listener.ts` pour broadcaster sur le channel `tickets:{ticketId}` :

- `workflow:run_created`
- `workflow:step_started`
- `workflow:step_completed`
- `workflow:run_completed`
- `workflow:run_failed`
- `workflow:run_cancelled`
- `workflow:needs_review`

Les composants subscribent via le `appWs` existant et patch local ou refetch ciblé.

## 9. UI éditeur — `AgentListPanel` + `WorkflowEditorView`

### 9.1 `AgentListPanel.tsx`

Ajout d'une 4ᵉ section "Workflows" sous les Skills. Liste : pour chaque template, emoji + nom + slug + nb de runs total + toggle enabled.

Bouton "+ New workflow" → ouvre `CreateWorkflowModal` (champs : nom, slug, emoji, description) → crée un template vide avec un seul step `entry` placeholder de type `agent` + persona par défaut + `entryStepId` pointant dessus.

Click sur un template → navigue vers `WorkflowEditorView`.

### 9.2 `<WorkflowEditorView templateId>`

Layout 3 colonnes :

- **Palette gauche (sticky, ~200px)** — 4 cartes draggables (Agent / Panel / Skill / Human Gate) avec icône et description. Drag dans le canvas crée un nœud "unconfigured" (executorType set, executorRef vide, outputSchema vide, position au point de drop).
- **Canvas centre** — `<ReactFlow>` avec `Background`, `Controls`, `MiniMap`. Nodes custom `<EditorStepNode>` (réplique le prototype : border colorée par type, icône, nom éditable inline, badge "Unconfigured" si executorRef vide). Connect entre handles crée une edge (default par défaut, configurable via le panel droit).
- **Panel droit (~320px)** — affiche selon la sélection :
  - **Nothing selected** : description du template + boutons "Validate" et "Save".
  - **Node selected (`<StepConfigPanel>`)** : nom du step, executorType (read-only), executorRef (combobox : autocomplete depuis le store correspondant — personaStore pour `agent`, skillStore pour `skill`, panelStore pour `panel`, vide pour `human_gate`), mode override dropdown, JSON Schema textarea pour `outputSchema` (avec validation et highlighting), pour `human_gate` : tags input pour `humanGateOutcomes`.
  - **Edge selected (`<EdgeConfigPanel>`)** : toggle `isDefault`, si non-default : `field` (text), `operator` (dropdown), `value` (text ou tags pour `in`), `label` (text).

### 9.3 Sauvegarde et validation

Bouton "Save Pipeline" → `PUT /api/workflows/templates/:id` avec le payload complet.

**Validations server-side** (réplique côté client pour UX) :

- Au moins 1 step
- `entryStepId` pointe vers un step existant
- Chaque edge `source` et `target` pointent vers des steps existants
- `outputSchema` parse comme un JSON Schema valide (ou `null`/`undefined`)
- `slug` matche `^[a-z0-9_-]+$` et est unique
- Pour `human_gate` : `humanGateOutcomes.length >= 1`
- `executorRef` non-vide pour `agent | skill | panel` (validé contre le store correspondant)

Si un run actif existe sur ce template au moment du save → toast warning : "X runs en cours utilisent l'ancienne version (snapshot). Les nouveaux runs utiliseront la nouvelle version."

## 10. Sécurité, observabilité, performance

### 10.1 Sécurité

- Toutes les nouvelles tables ont **RLS enabled** sur Supabase (cf. CLAUDE.md du repo).
- Le modèle d'auth général de Fleex est conservé (actuellement instance locale single-user → pas d'auth utilisateur en V0). Les nouvelles routes héritent du middleware existant des autres routes de l'API.
- L'`EdgeEvaluator` n'évalue **jamais** de code arbitraire — uniquement les opérateurs énumérés. Pas d'eval, pas de regex user-controlled (sauf `contains` qui est `String.prototype.includes`).
- Les `outputSchema` user-defined sont validés au PUT comme **JSON Schema valide** (via Zod, aligné avec le reste du codebase) — refus si invalide.
- L'API `resolve` (human_gate) vérifie que `outcome` ∈ `step.humanGateOutcomes` du snapshot, sinon 400.

### 10.2 Observabilité

- Chaque step exécuté par un agent/skill/panel reçoit un `executionId` qui lie aux `agent_events` existants. Le DAG view propose un lien "View agent events" pour ouvrir le timeline.
- Logs structurés (via le logger Fleex) sur : run created, step started, step completed, edge resolved, run completed/failed.
- WS broadcast pour chaque transition.
- Compteurs (à ajouter dans le dashboard plus tard, hors V0) : runs créés par template, taux de complétion, temps moyen par step.

### 10.3 Performance

- Les requêtes principales sont :
  - `workflow_runs WHERE ticket_id = X AND status IN (running, blocked, needs_review)` — couverte par `idx_workflow_runs_ticket_status`.
  - `step_runs WHERE workflow_run_id = X` — couverte par `idx_step_runs_run_step`.
- `templateSnapshot` est stocké au démarrage du run → pas de JOIN à chaque transition.
- L'éditeur React Flow charge le full template via une seule requête.

## 11. Testing strategy

| Couche                       | Quoi tester                                                                                                                | Outil                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Domain entities**          | Transitions (`run.start`, `run.complete`, `stepRun.markRunning`), invariants (status valides, attempt unique par retry)    | Vitest unit                         |
| **EdgeEvaluator**            | Chaque opérateur, default fallback, no match, path pointé, NaN handling, `in` avec array                                   | Vitest unit, ~30 cas                |
| **CreateWorkflowRunUseCase** | Rejet 409 si run actif, snapshot correct, currentStepId initial                                                            | Vitest avec stores mockés           |
| **RunWorkflowStepUseCase**   | Avec chaque adapter mocké : stepRun créé, output mergé, edge résolu, next step enqueued, handling de `needs_review`        | Vitest, ~10 scénarios               |
| **Adapters**                 | Chaque adapter isolément : mock `ExecuteAgentUseCase` / `RunPanelUseCase`, vérif call shape + retour mappé en `StepOutput` | Vitest                              |
| **HumanGateExecutor**        | Outcomes vides → throw ; commentaire posté ; status `needs_review`                                                         | Vitest                              |
| **Resolve endpoint**         | Outcome valide / outcome invalide / edge matching `outcome == X` / pas d'edge → completion                                 | Vitest integration (server)         |
| **Mention parsing**          | `@workflow:slug` extracted, struck-through skipped, mélangé avec autres mentions                                           | Vitest (ticket-comment.entity test) |
| **Migration `017`**          | Up + down sur SQLite et Postgres ; RLS policies créées sur Supabase                                                        | Migration tests existants           |
| **UI éditeur**               | Validation : entry step manquant, JSON Schema malformé, slug doublonné. Pas de drag-and-drop visual test                   | Vitest + Testing Library            |
| **UI runtime**               | Smoke : mock run → DAG render → click step → details. WS broadcast → patch local                                           | Vitest + Testing Library            |

**Tests manuels** via `fleex start` couvrent les chemins UI complets (création template, démarrage run, exécution, human_gate, completion).

## 12. Risques & inconnues

| Risque                                                                                                                                                | Mitigation                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Le SDK Claude Agent ne respecte pas le `outputFormat` pour les champs custom au top-level                                                             | Le fallback parser texte existant attrape déjà les cas non-conformes ; logger un warning et marquer `result='ko'`                              |
| `PanelStepExecutor` doit extraire les champs custom de `outputSchema` depuis un panel multi-agents                                                    | À clarifier en implémentation : peut-être que seul l'agent "orchestrateur" du panel produit l'output structuré, et les autres sont contextuels |
| L'éditeur React Flow peut avoir des perfs dégradées sur les gros templates (>50 nodes)                                                                | V0 = pas de limite explicite, à monitorer ; le prototype gère bien quelques dizaines                                                           |
| Migration `017` sur Supabase doit gérer la RLS sans break les bases existantes                                                                        | Pattern testé sur les migrations précédentes, ajout simple                                                                                     |
| Versioning des templates : si un user édite un template pendant qu'un run tourne, l'`outputSchema` peut diverger entre le snapshot et l'agent context | Le snapshot est la source de vérité ; l'agent reçoit le schema du snapshot, pas le live                                                        |

## 13. Stack & dépendances

- **Backend** — pure TS, suit les patterns DDD du codebase (entités, ports, repos, use-cases, domain events).
- **Frontend** — `@xyflow/react` (≈ React Flow 12+) à ajouter à `packages/web/package.json`. Le prototype a déjà identifié cette dépendance.
- **Validation JSON Schema** — `ajv` (compact, déjà transitivement présent dans le repo via d'autres deps) ou validation manuelle Zod (préférée pour rester aligné avec le reste du codebase, qui utilise déjà Zod).
- **Aucune nouvelle DB dépendance** : Supabase + SQLite suffisent.

## 14. Décisions tracées

| Décision                | Choix                                                                     | Pourquoi                                                                  |
| ----------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Storage du template     | Entité séparée `workflow_templates`                                       | Réutilisabilité across tickets, éditabilité, audit                        |
| Modèle de step          | 4 types (agent, skill, panel, human_gate) avec executorType + executorRef | Match prototype, expressif, extensible                                    |
| Edges conditionnels     | Schema field-based avec opérateurs énumérés                               | Plus puissant que `on.{done                                               | question | failure}`, déterministe, audit-able |
| Runs concurrents        | 1 actif max par ticket                                                    | UX et débogage plus simples ; histoire queryable comble le besoin "audit" |
| Trigger                 | Mention `@workflow:slug` + SmartSessionButton                             | Réutilise l'infra de mentions, UX cohérente avec skills                   |
| Workflow conscient      | Oui : workflow context injecté dans le user prompt                        | Meilleur alignement des outputs avec les branches                         |
| Architecture            | Orchestrateur + 4 adapters (option C)                                     | Réutilise `ExecuteAgent`/`RunPanel` sans les tordre                       |
| Output contract         | `outputFormat` SDK = merge(standard, step.outputSchema) au top-level      | Backward compat, agent voit un schéma unifié                              |
| Human gate              | Outcomes nommés par step                                                  | Uniforme avec les conditional edges, plus expressif que 3 boutons fixes   |
| Output schema authoring | Textarea JSON Schema brut + validation                                    | Le plus rapide à livrer pour V0 ; builder visuel reporté V1               |
| Versioning              | Snapshot du template au démarrage du run                                  | Pas de surprise sur les runs en cours, audit propre                       |
| Étapes parallèles       | Non, séquentiel strict                                                    | V0 simpler ; fan-out V1+                                                  |
| Runtime UI              | Nouvel onglet "Workflow" dans `TicketDetail`                              | Surface dédiée pour le DAG plein écran                                    |
| Éditeur UI              | 4ᵉ section dans `AgentListPanel` (à côté agents/panels/skills)            | Cohérent avec le modèle de ressources agentiques existant                 |
| Default-per-board       | Hors scope V0                                                             | Pas dans le prototype, complexité supplémentaire non justifiée            |

## 15. Annexes

### 15.1 Exemple complet d'un template (JSON)

```json
{
  "id": "wf-template-feature-delivery",
  "name": "Feature Delivery",
  "slug": "feature-delivery",
  "emoji": "🏭",
  "description": "Full delivery pipeline with conditional routing after triage",
  "entryStepId": "triage",
  "enabled": true,
  "steps": [
    {
      "id": "triage",
      "name": "Triage",
      "executorType": "agent",
      "executorRef": "the-sentinel",
      "mode": "plan",
      "outputSchema": {
        "type": "object",
        "properties": {
          "path": { "type": "string", "enum": ["standard", "hotfix", "doc_only"] },
          "priority": { "type": "string", "enum": ["low", "medium", "high", "critical"] }
        },
        "required": ["path", "priority"]
      },
      "position": { "x": 0, "y": 200 }
    },
    {
      "id": "spec",
      "name": "Product Spec",
      "executorType": "panel",
      "executorRef": "les-big-tech",
      "position": { "x": 300, "y": 100 }
    },
    {
      "id": "doc-update",
      "name": "Doc Update",
      "executorType": "skill",
      "executorRef": "doc-writer",
      "position": { "x": 300, "y": 400 }
    },
    {
      "id": "human-review",
      "name": "Human Review",
      "executorType": "human_gate",
      "executorRef": "",
      "humanGateOutcomes": ["approve", "request_changes", "reject"],
      "position": { "x": 600, "y": 100 }
    },
    {
      "id": "development",
      "name": "Development",
      "executorType": "agent",
      "executorRef": "jeff-bezos",
      "mode": "edit",
      "position": { "x": 900, "y": 200 }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "source": "triage",
      "target": "spec",
      "condition": { "field": "path", "operator": "eq", "value": "standard" },
      "label": "standard"
    },
    {
      "id": "e2",
      "source": "triage",
      "target": "doc-update",
      "condition": { "field": "path", "operator": "eq", "value": "doc_only" },
      "label": "doc_only"
    },
    {
      "id": "e3",
      "source": "triage",
      "target": "development",
      "condition": { "field": "path", "operator": "eq", "value": "hotfix" },
      "label": "hotfix"
    },
    { "id": "e4", "source": "spec", "target": "human-review", "isDefault": true },
    { "id": "e5", "source": "doc-update", "target": "development", "isDefault": true },
    {
      "id": "e6",
      "source": "human-review",
      "target": "development",
      "condition": { "field": "outcome", "operator": "eq", "value": "approve" },
      "label": "approved"
    },
    {
      "id": "e7",
      "source": "human-review",
      "target": "spec",
      "condition": { "field": "outcome", "operator": "eq", "value": "request_changes" },
      "label": "changes"
    }
  ]
}
```

### 15.2 Pseudocode du flow d'un run complet

```
USER posts comment: "@workflow:feature-delivery let's start"
  → ticket-comment-created → mention.created (targetType='workflow', targetAgent='feature-delivery')
  → handleAutoTriggerWorkflow → CreateWorkflowRunUseCase
    → resolve template "feature-delivery"
    → snapshot, run row inserted (status='running', currentStepId='triage')
    → enqueue RunWorkflowStepUseCase(run.id, 'triage')

ORCHESTRATOR runStep('triage')
  → load run + step
  → create stepRun (attempt=1, status='running')
  → AgentStepExecutor.execute({step, workflowContext})
    → ExecuteAgentUseCase (variant) with merged outputFormat
    → SDK returns: { deliverable: null, comment: "Triaged as standard high-priority", mentionStatus: "resolved", path: "standard", priority: "high" }
    → StepOutput: { comment, schemaFields: {path:'standard', priority:'high'}, result:'ok' }
  → stepRun.output, completed
  → EdgeEvaluator.resolve(output, [e1,e2,e3])
    → e1 matches (path == "standard")
  → stepRun.nextEdgeId='e1', run.currentStepId='spec'
  → enqueue RunWorkflowStepUseCase(run.id, 'spec')

ORCHESTRATOR runStep('spec')
  → PanelStepExecutor.execute(...)
    → RunPanelUseCase with workflowContext
    → returns deliverable + comment
  → StepOutput { deliverable, comment, schemaFields:{}, result:'ok' }
  → no conditional edges, default e4 → 'human-review'

ORCHESTRATOR runStep('human-review')
  → HumanGateStepExecutor.execute(...)
    → post comment "Awaiting human decision: approve | request_changes | reject"
    → return { result:'needs_review', schemaFields:{outcomes:[...]} }
  → stepRun.status='needs_review', run.status='needs_review'
  → STOP, await human action

USER clicks "approve" button in UI
  → POST /workflows/runs/:id/steps/:stepRunId/resolve { outcome: "approve" }
  → stepRun.output.schemaFields.outcome = "approve", stepRun.status='completed'
  → EdgeEvaluator.resolve(output, [e6,e7])
    → e6 matches (outcome == "approve")
  → run.currentStepId='development', run.status='running'
  → enqueue RunWorkflowStepUseCase(run.id, 'development')

ORCHESTRATOR runStep('development')
  → AgentStepExecutor.execute(...) (mode='edit', persona='jeff-bezos')
  → no outgoing edges
  → run.status='completed', run.completedAt=now
```

---

_End of spec._
