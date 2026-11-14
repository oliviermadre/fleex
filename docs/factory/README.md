# Factory

Maquette interactive d'une vue « usine » pour Fleex : le pipeline agentique vu comme un atelier, de l'intake à l'expédition.
Ouvrir [`prototype.html`](./prototype.html) dans un navigateur. Toutes les données sont simulées ; rien n'est branché sur un serveur Fleex.

Le but : voir d'un coup d'œil le débit, la dépense par poste et les goulots, puis régler la chaîne (modèles, parallélisme, contrôles humains) et mesurer l'effet.

## Ce que représente chaque élément

| Dans l'usine | Dans Fleex | Remarque |
|---|---|---|
| Quais d'intake | Sources de tickets | Gmail, Slack, Meeting notes, GitHub, Linear, Routines, CLI · MCP. Aujourd'hui seuls `github_issue`, `github_pr` et `slack_message` existent (`shared/src/sources`). |
| Pièce brute, puis pièce colorée | Ticket avant et après le tri | Couleur = `TicketType` (`build`, `fix`, `think`, `lead`, `ops`). |
| Poste de tri | Étape `agent` qui type le ticket et choisit son workflow | Un routage ambigu donne un `awaiting_routing`. |
| Ligne | `WorkflowTemplate` | Cinq lignes d'exemple : Ideation, Specification, Feature Delivery, Feature Autopilot, Bugfix. |
| Poste | `WorkflowStep` | `executorType` : `agent`, `skill`, `panel`, `native`. Chaque case allumée est un `StepRun` en cours. |
| Poste rayé jaune | `human_gate` | La pièce attend sur l'étagère (`needs_review`). |
| Convoyeur ambre | Arête de retour | `ko` d'un contrôle ou `request_changes` d'une gate. |
| Slots agents | `agentMaxConcurrency` (`SdkConcurrencyLimiter`) | La seule file d'attente côté agents, commune à toute l'usine, premier arrivé premier servi. |
| Opérateur | L'utilisateur | Une personne, une intervention à la fois, aux heures de bureau. |
| Drones | `ticket.create` d'une étape `native` | Les sous-tickets repartent à l'intake. |
| Quai d'expédition | Tickets `done` | PR mergées, PRD, specs. |

Fleex lance tout en parallèle : une file sur un convoyeur n'apparaît donc que dans deux cas, quand les slots agents sont
saturés (lampe bleue, « file N ») ou quand une pièce attend un humain (étagère d'une gate, lampe ambre). C'est le parti pris
de la maquette : la ressource rare n'est presque jamais la machine, c'est l'opérateur.

## Ce qu'on peut faire

- **Calques** (`O`) : Débit par convoyeur, Coût par poste, Temps passé par poste, Attente humaine.
- **Goulots** : classement de ce qui freine ou coûte le plus sur 12 h (attente humaine, questions et erreurs, capacité, coût, qualité),
  avec un réglage en un clic. Chaque réglage appliqué est journalisé avec son effet mesuré (débit, Focus, autonomie, coût par ticket).
- **Focus** : la même file que la vue Focus (`gate`, `question`, `error`, plus le routage) ; approuver, demander des changements,
  rejeter, répondre, relancer.
- **Inspecteur** : cliquer un poste (modèle, statistiques, runs en cours), une gate (politique humain / échantillonné / automatique),
  une ligne (chaîne de valeur par poste), un quai (volume, injection), les slots agents (`agentMaxConcurrency`), un ticket
  (runs d'étapes, coût, suivi caméra).
- **Objectifs** : sept paliers qui poussent vers une usine plus autonome sans laisser filer la qualité.
- **Production** (`P`) : entrées et sorties par heure, dépense par poste, répartition du temps d'un ticket, tableau par workflow.
- **Banc d'essai** : incident prod, opérateur en réunion, gros PRD, panne API.
- **Visite guidée** : sept étapes, proposée à l'ouverture et depuis le bouton `?`.
- **Poste actif** : un contrôle ou un panel peut être désactivé (`skipped`) pour mesurer ce que donne la ligne sans lui.

Raccourcis : `Espace` pause, `1`–`4` vitesse, `F` toute l'usine, `Échap` désélectionner.

## Hypothèses de la simulation

Tout est dans `src/sim.js`, sans dépendance au DOM.

- 1 s réelle = 2 min simulées à vitesse 1×. La maquette démarre un mardi à 10 h 15, après 34 h simulées à blanc.
- Durées et coûts par étape : valeurs plausibles, pas des mesures. Les modèles changent la durée, le coût et le taux de défauts.
  Le multiplicateur de coût de Fable 5.2 est une supposition (pas de tarif dans `MODEL_PRICING`).
- Un `panel` occupe 3 slots. Une étape `native` n'en occupe aucun.
- Chaque étape qui produit (Plan, Spec, Development, Fix…) fixe un risque de défaut ; les contrôles en aval en attrapent une part
  et renvoient la pièce. Un défaut qui passe jusqu'à l'expédition revient plus tard comme ticket `fix` (« défaut échappé »).
- Politique d'une gate : `humain` (comportement actuel de Fleex), `échantillonné` (un agent juge laisse passer les tickets à faible
  risque) et `automatique` sont des propositions, pas des fonctions existantes.
- Opérateur simulé : 9:00–12:30 et 13:30–18:30, questions et erreurs d'abord, puis la gate la plus ancienne.

## Brancher sur de vraies données

| Besoin de la vue | Source existante |
|---|---|
| Lignes et postes | `WorkflowTemplate.steps` / `edges` |
| Position d'un ticket | `WorkflowRun.currentStepId`, `StepRun.status` |
| File Focus | `GET /api/focus` |
| Coût et durée par run | `AgentExecution.costUsd`, `durationMs`, `ExecutionKind = workflow_step` |
| Débit, lead time, coût par workflow | `GET /api/statistics` |
| Slots | `agentMaxConcurrency` et la file du `SdkConcurrencyLimiter` |

Ce qui manque côté serveur : des agrégats par étape (coût, durée, attente, taux de `ko`) et le temps d'attente dans la file
du limiteur.

## Fichiers

- `prototype.html` : la maquette, un seul fichier autonome. Ne pas l'éditer à la main.
- `src/sim.js` (simulation), `src/render.js` (canvas), `src/ui.js` (HUD et panneaux), `src/style.css`, `src/body.html`.
- `./build.sh` assemble `prototype.html` à partir de `src/`.

Comme les autres prototypes, c'est une intention visuelle : pour l'intégrer à `packages/web`, reprendre les primitives existantes
(`toast()`, `Modal`, tints) au lieu de copier le balisage (voir `packages/web/CLAUDE.md`).
