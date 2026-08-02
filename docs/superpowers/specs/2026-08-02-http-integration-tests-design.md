# Tests d'intégration HTTP — Spec

**Date** : 2026-08-02
**Ticket** : Tests d'intégration HTTP
**Statut** : final — prêt pour build

---

## 1. Problème

`packages/server` compte 72 fichiers de tests, tous unitaires (`tests/unit/**`).
**Zéro test** sur `src/infrastructure/http/**` et `src/infrastructure/ws/**`.

Sont donc entièrement non couverts :

| Zone | Volume | Risque |
|---|---|---|
| Routes HTTP | 39 fichiers, ~6 960 lignes, **215 endpoints** | Un renommage de route ou un changement de statut passe en prod sans alerte |
| `auth-middleware.ts` | 3 modes d'auth imbriqués | Une régression ouvre l'API en grand ou verrouille tout le monde |
| `agent-auth.hook.ts` | Auth Bearer de toute l'API agent | Idem, sur la surface la plus automatisée |
| `error-handler.ts` | Table `code → statut` | Un code d'erreur non mappé retombe silencieusement en 500 |
| `main.ts` | Ordre d'enregistrement des plugins | L'auth s'applique par `addHook` **après** `authRoutes` : l'ordre est la sécurité |
| `ws/*.ts` | 3 fichiers, 609 lignes | Auth WS par query param, jamais vérifiée |

**Bug déjà identifié par cette analyse** (voir §7.2) : 12 codes `DomainError` sur 32 ne sont pas dans la table de mapping, donc `GET /api/personas/{inconnu}` renvoie **500** au lieu de 404.

---

## 2. Objectif

Construire un **filet de sécurité** : une suite de tests d'intégration qui tourne le vrai serveur Fastify en mémoire (`app.inject()`), sur un container à stockage local isolé, et qui **casse** dès qu'un statut HTTP, un chemin de route ou une règle d'auth change sur une route couverte.

### Non-objectifs

- Pas de tests E2E navigateur.
- Pas de couverture des 215 endpoints en phase 1 — on couvre les ~30 les plus utilisés + un snapshot d'inventaire qui couvre les 215 en surface.
- Pas de correction du bug de mapping d'erreurs. **On verrouille le comportement actuel** et on le documente (§7.2). Corriger dans le même lot rendrait impossible de distinguer « le filet marche » de « le fix marche ».
- Pas de tests des drivers `pgsql` / `supabase` (nécessitent une base réelle).

---

## 3. Décisions tranchées

| # | Question | Décision | Raison |
|---|---|---|---|
| D1 | Driver de stockage | **`json`** sur un `tmpdir` par fichier de test | Driver par défaut en prod, tourne sous Node (donc dans `bun run test`, la CI principale). `sqlite` impose `bun:sqlite` → `*.bun.test.ts`, runtime séparé. |
| D2 | FS en mémoire ou disque ? | **Disque, dans `mkdtemp()`** via un `NodeHostFs` de test | Le runner de migrations écrit `_migrations.json` avec `node:fs` en direct — un FS en mémoire ne l'intercepterait pas. Le disque évite toute divergence de sémantique (`readdir`, `stat`, `mkdir -p`). |
| D3 | Réutiliser `createContainer()` ? | **Non** — un `createTestContainer()` dédié | `createContainer()` fait des appels HTTP au host-gateway (`RemoteHostFs`, `remoteExec`), démarre le `HubClient`, appelle `executeAgent.init()`. Non testable sans gateway. |
| D4 | Réutiliser le câblage de `main.ts` ? | **Oui** — on extrait `buildApp()` de `main.ts` | Sans ça, le test câble sa propre app et ne teste pas l'ordre réel des hooks. L'ordre `authRoutes → hookRoutes → addHook(auth) → routes` **est** le comportement à protéger. |
| D5 | `DomainEventListener` dans les tests ? | **Non enregistré** | Sinon poster un commentaire avec `@agent:x` déclenche une vraie exécution SDK. Le bus reste réel, avec un recorder. |
| D6 | Routes workflow | Templates : couvertes (fake store en mémoire). Runs : **non couvertes**, on teste la branche « stores absents » | `workflowRunStore` demande 3 stores + 4 use cases. Coût/valeur défavorable en phase 1. |
| D7 | Routes à effets externes (`/api/version`, `/api/repositories/*`, `/api/github/*`, `/api/dashboard`, `/api/models`, `/api/claude-usage`, `/api/exec`, `/api/github-image/*`, `/api/overlay-sync/*`) | **Hors périmètre handler** en phase 1, mais **dans le snapshot d'inventaire** | Elles font `execSync('git fetch')`, des appels GitHub/Anthropic, ou du remote exec. Non isolables sans refactor (voir §11). |
| D8 | WebSocket | Tests via `app.listen({ port: 0 })` + vrai client `ws` | `app.inject()` ne fait pas d'upgrade HTTP. |
| D9 | Statuts attendus | **Toujours asserter `res.statusCode` explicitement**, jamais via `res.ok` ou un helper qui l'avale | C'est le critère d'acceptation du ticket. |
| D10 | Nouvelle dépendance npm | **Aucune** | Le multipart est construit à la main. `ws` est déjà une dépendance. |

---

## 4. Architecture

### 4.1 Refactor préalable : extraire `buildApp()` de `main.ts`

C'est le seul changement de code de production de ce lot. Il est nécessaire : sans lui, les tests dupliquent le câblage et ne protègent rien.

```
AVANT                                  APRÈS

main.ts (304 l.)                       main.ts (~180 l.)
├── createContainer()                  ├── createContainer()
├── process.on(uncaughtException)      ├── process.on(uncaughtException)
├── discoverSessions()                 ├── discoverSessions()
├── Fastify() + cors/multipart/ws  ┐   ├── buildApp({container, heartbeat,
├── registerErrorHandler           │   │           modelService, serveStatic:true})
├── authRoutes / hookRoutes        │   ├── migrations repo-patterns
├── addHook(authMiddleware)        ├──►├── auto-resolve repos / bare clones
├── 23 x app.register(...)         │   ├── refresh scheduler
├── modelsRoutes                   │   ├── app.listen()
├── workflow routes (conditionnel) │   └── shutdown SIGINT/SIGTERM
├── scope /api/agents/v1 + authHook│
├── ws plugins                     │   src/infrastructure/http/build-app.ts (NOUVEAU)
├── static files + notFoundHandler ┘   └── buildApp(): tout le bloc extrait, à l'identique
├── startup side-effects
├── listen + shutdown                  tests/helpers/test-app.ts
                                       └── appelle buildApp() → même câblage
```

**Contrat** :

```ts
// src/infrastructure/http/build-app.ts
import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import type { WsHeartbeat } from '../ws/ws-heartbeat.js';
import type { ModelService } from '../../application/services/model.service.js';

export interface BuildAppOptions {
  container: Container;
  heartbeat: WsHeartbeat;
  modelService: ModelService;
  /**
   * Sert `packages/web/dist` et installe le notFoundHandler SPA.
   * `true` en prod. `false` en test — sinon la présence locale d'un `web/dist`
   * ferait diverger le comportement 404 entre poste dev et CI.
   */
  serveStatic: boolean;
  /**
   * Branché via `app.addHook('onRoute', …)` juste après `Fastify()`, donc avant
   * tout `register`. Seul moyen d'observer les 215 routes enregistrées (§8.1).
   * Non fourni en prod.
   */
  onRoute?: (route: import('fastify').RouteOptions) => void;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance>;
```

**Règles du refactor** :
1. Le corps de `buildApp()` est un **copier-coller** des lignes 75–241 de `main.ts`, dans le même ordre. Zéro changement de comportement.
2. `new ModelService(...)` et `new WsHeartbeat()` remontent dans `main.ts` (le heartbeat y est déjà utilisé au shutdown).
3. Le bloc statique de fin devient `if (opts.serveStatic && existsSync(webDistPath)) { ... }`.
4. Le reste de `main.ts` (side-effects de démarrage, scheduler, listen, shutdown) **ne bouge pas**.

### 4.2 `tests/helpers/node-host-fs.ts` (nouveau)

Implémentation réelle de `HostFs` (`src/infrastructure/host/types.ts`) sur `node:fs/promises`, enracinée sur un répertoire temporaire.

```ts
export class NodeHostFs implements HostFs {
  // readFile, writeFile, appendFile, readdir, stat, exists, mkdir (recursive), rm, readTail
}
export async function makeTempHome(): Promise<{ home: string; dispose(): Promise<void> }>;
// mkdtemp(join(tmpdir(), 'fleex-http-test-'))
```

> `FakeHostFs` dans `tests/helpers/fakes.ts` est insuffisant : pas d'`appendFile`, `stat()` renvoie `null`, `rm()` est un no-op. Le laisser tel quel (les tests unitaires existants en dépendent), ajouter `NodeHostFs` à côté.

### 4.3 `tests/helpers/test-container.ts` (nouveau)

```ts
export type TestAuthMode = 'none' | 'db-no-oauth' | 'full';

export interface TestContainerOptions {
  /** Défaut: 'none' (sessionManager = null → mode 1) */
  auth?: TestAuthMode;
  /** Défaut: true — injecte un InMemoryWorkflowTemplateStore */
  workflowTemplates?: boolean;
  /** Écrase n'importe quelle clé après construction */
  overrides?: Partial<Container>;
}

export interface TestContainerHandle {
  container: Container;
  home: string;
  /** Tous les events émis sur eventBus, dans l'ordre */
  events: AnyDomainEvent[];
  dispose(): Promise<void>;
}

export async function createTestContainer(
  opts?: TestContainerOptions,
): Promise<TestContainerHandle>;
```

**Composition — ce qui est réel vs stubbé** :

| Clé du container | Implémentation en test |
|---|---|
| `config` | **réel** `JsonConfigAdapter(stubExec, NodeHostFs, tmpHome)` + `.init()` |
| `ticketStore` | **réel** `CachedTicketStore(JsonTicketStore)` + `warmUp()` |
| `sessionStore` | **réel** `CachedSessionStore(JsonSessionStore)` + `warmUp()` |
| `personaStore` | **réel** `CachedPersonaStore(JsonPersonaStore)` + `warmUp()` |
| `agentEventStore` | **réel** `CachedAgentEventStore(JsonAgentEventStore)` + `warmUp()` |
| `agentTokenStore`, `commentStore`, `mentionStore`, `deliverableStore`, `skillStore`, `panelStore`, `domainEventLogStore`, `fileMetaStore`, `ticketGroupStore` | **réels** adaptateurs `Json*` sur `tmpHome` |
| `fileStore` | **réel** `DiskFileStoreAdapter(tmpHome)` |
| `kvStore` | `null` (comme le driver json) |
| `postComment`, `resolveMention`, `submitDeliverable`, `getTicketContext`, `getRelevantSummaries`, `manageDeliverableTypes`, `createPersona`/`update`/`delete`, `createSkill`/`update`/`delete`, `createPanel`/`update`/`delete`, `detectMerge`, `backfillPRTicket` | **réels** — pure orchestration sur les stores |
| `listSessions`, `killSession`, `createSession`, `renameSession`, `discoverSessions`, `getSessionGroups`, `processHookEvent`, `ingestCliSession` | **réels**, sur `FakeTmuxPort` + `FakeGitPort` |
| `eventBus` | **réel** `EventBus` + `on('*')` → push dans `events[]`. **Aucun `DomainEventListener` enregistré** (D5) |
| `remoteEventBus` | **réel**, vide |
| `tmux` | `FakeTmuxPort` (existant) |
| `git` | `FakeGitPort` (existant) |
| `logger` | `FakeLoggerPort` (existant) |
| `hostFs` | `NodeHostFs(tmpHome)` |
| `execFn` / `shellExecFn` | stub `async () => ({ stdout: '', stderr: '' })` |
| `executeAgent`, `runPanel`, `wakeWaitingAgents`, `autoReviewWorkflow`, `generateTicketSummary`, `generateCliSessionSummary`, `importGitHubIssue`, `importSlackMessage`, `createSessionFromTicket`, `createWorktree`, `reconcileWorktree`, `getClaudeUsage`, `enrichClaudeActivity` | **stubs `vi.fn()`** — coûteux et/ou externes |
| `githubGraphql`, `githubDiscovery`, `repositoryResolver`, `repositoryRefreshScheduler`, `repositoryCache`, `bareCloneManager`, `overlayManager`, `listRepositories`, `listWorktrees` | **stubs** |
| `pty` | stub |
| `hubClient` | `null` |
| `userStore` / `sessionManager` | selon `auth` (§6) |
| `workflowTemplateStore` | `InMemoryWorkflowTemplateStore` si `workflowTemplates !== false`, sinon `null` |
| `workflowRunStore`, `stepRunStore`, `createWorkflowRun`, `resolveHumanGate`, `retryStep`, `cancelWorkflowRun`, `workflowOrchestrator` | `null` (D6) |
| `*Broadcast` | no-ops (écrasés par les plugins WS) |

Le retour est typé `as unknown as Container`. C'est assumé : `Container` est un type structurel de 90+ clés, en fabriquer une version complète coûterait plus qu'il ne rapporte. Le tableau ci-dessus **est** le contrat ; il doit rester en tête de `test-container.ts` en commentaire.

`dispose()` : `rm(home, { recursive: true, force: true })`.

### 4.4 `tests/helpers/test-app.ts` (nouveau)

```ts
export interface TestAppHandle extends TestContainerHandle {
  app: FastifyInstance;
  /** Ferme l'app, stoppe le heartbeat, supprime le tmpdir */
  close(): Promise<void>;
}

export interface TestAppOptions extends TestContainerOptions {
  /** Transmis tel quel à buildApp() — voir §8.1 */
  onRoute?: (route: RouteOptions) => void;
}

export async function createTestApp(opts?: TestAppOptions): Promise<TestAppHandle>;
```

Implémentation :
```ts
const handle = await createTestContainer(opts);
const heartbeat = new WsHeartbeat();
const app = await buildApp({
  container: handle.container,
  heartbeat,
  modelService: { getModels: async () => ({ models: [] }) } as unknown as ModelService,
  serveStatic: false,
});
await app.ready();
```

`close()` doit appeler `heartbeat.stop()` **avant** `app.close()` — `WsHeartbeat` démarre un `setInterval` dans son constructeur et maintiendrait la boucle d'événements vivante.

### 4.5 `tests/helpers/fixtures.ts` (nouveau)

Helpers de seed, tous synchrones à écrire / async à exécuter :

```ts
seedBoard(c, { name? })                       → BoardEntity
seedTicket(c, { boardId, title?, status?, … })→ TicketEntity   // via createTicket() (assigne displayId)
seedComment(c, { ticketId, authorName, body })→ TicketCommentEntity
seedMention(c, { ticketId, targetAgent, … })  → TicketMentionEntity
seedDeliverable(c, { ticketId, … })           → DeliverableEntity
seedPersona(c, { name, displayName })         → AgentPersonaEntity
seedAgentToken(c, { name })                   → { entity, secret }   // ApiTokenEntity.create()
agentAuth(secret, agentName?)                 → { authorization: `Bearer ${secret}`, 'x-agent-name': agentName }
```

> Le `JsonTicketStore` **ne seed aucun board par défaut** (vérifié) : l'état initial est vide.

---

## 5. Arborescence des tests

```
packages/server/tests/
├── helpers/
│   ├── fakes.ts                    (existant, inchangé)
│   ├── node-host-fs.ts             ← nouveau
│   ├── test-container.ts           ← nouveau
│   ├── test-app.ts                 ← nouveau
│   └── fixtures.ts                 ← nouveau
└── integration/
    ├── http/
    │   ├── __snapshots__/route-inventory.txt   ← snapshot fichier, versionné
    │   ├── app-wiring.test.ts                  §8.1
    │   ├── auth-middleware.test.ts             §6.1
    │   ├── agent-auth-hook.test.ts             §6.2
    │   ├── error-handler.test.ts               §7
    │   ├── boards.routes.test.ts               §8.2
    │   ├── tickets.routes.test.ts              §8.2
    │   ├── comments.routes.test.ts             §8.2
    │   ├── deliverables.routes.test.ts         §8.2
    │   ├── mentions.routes.test.ts             §8.2
    │   ├── epics.routes.test.ts                §8.2
    │   ├── sessions.routes.test.ts             §8.2
    │   ├── personas-skills.routes.test.ts      §8.2
    │   ├── agent-tokens.routes.test.ts         §8.2
    │   ├── config-health.routes.test.ts        §8.2
    │   ├── files.routes.test.ts                §8.2
    │   ├── hook.routes.test.ts                 §8.2
    │   ├── workflow-templates.routes.test.ts   §8.2
    │   └── agent-v1.routes.test.ts             §8.3
    └── ws/
        ├── agent-ws.test.ts                    §9
        └── unified-ws.test.ts                  §9
```

`vitest.config.ts` inclut déjà `tests/**/*.test.ts` — **aucune modification de config nécessaire**.

Chaque fichier suit :
```ts
let h: TestAppHandle;
beforeEach(async () => { h = await createTestApp(); });
afterEach(async () => { await h.close(); });
```
`beforeEach` (et non `beforeAll`) : chaque test part d'un tmpdir vierge. Coût mesuré acceptable (création de ~14 fichiers JSON vides).

---

## 6. Matrice d'authentification

### 6.1 `auth-middleware.ts` — les 3 modes

`createAuthMiddleware()` capture `hasOAuth` **au moment de sa construction**, en lisant `process.env`. Donc : **stubber l'env avec `vi.stubEnv()` AVANT `createTestApp()`**, et `vi.unstubAllEnvs()` en `afterEach`.

| # | Mode | Setup | Requête | Attendu |
|---|---|---|---|---|
| 1 | Pas de DB | `auth: 'none'` (`sessionManager = null`) | `GET /api/boards` sans header | **200**, `request.userId === '00000000-…0000'` |
| 2 | DB sans OAuth | `auth: 'db-no-oauth'` | `GET /api/boards` sans header | **200**, userId par défaut |
| 3 | DB + OAuth, pas de cookie | `auth: 'full'` (+ `GITHUB_CLIENT_ID`/`SECRET` stubbés) | `GET /api/boards` sans header | **401** `{ error: 'Authentication required' }` |
| 4 | DB + OAuth, cookie invalide | idem | `Cookie: fleex_session=nope` | **401** `{ error: 'Session expired' }` |
| 5 | DB + OAuth, cookie valide | idem, session seedée dans le `FakeSessionManager` | `Cookie: fleex_session=<id>` | **200**, `userId === session.userId` |
| 6 | Bearer valide (PAT) | `auth: 'db-no-oauth'` + token seedé | `Authorization: Bearer <secret>` | **200** ; `lastUsedAt` du token mis à jour en base |
| 7 | Bearer invalide | `auth: 'db-no-oauth'` | `Authorization: Bearer wrong` | **401** `{ error: 'Invalid token' }` |
| 8 | Bypass `/auth/` | `auth: 'full'` | `GET /auth/status` sans cookie | **200** (pas de 401) |
| 9 | Bypass `/health` | `auth: 'full'` | `GET /health` sans cookie | **200** |
| 10 | Bypass `/internal/` | `auth: 'full'` | `GET /internal/whatever` | **404** (route absente) et **pas 401** — prouve que le préfixe est bien exempté |
| 11 | Ordre : `/api/hook` **n'est pas** exempté par le middleware, mais est enregistré **avant** `addHook` | `auth: 'full'` | `POST /api/hook` payload valide, sans cookie | **200** — le hook Claude Code doit rester joignable même en mode SSO |

Le cas 11 est la raison d'être du refactor `buildApp()` : il ne teste pas un handler mais **l'ordre d'enregistrement**. Il casse si quelqu'un déplace `app.addHook('preHandler', authMiddleware)` au-dessus de `hookRoutes`.

`FakeSessionManager` (dans `fakes.ts`) : `get(id)`, `create(userId)`, `destroy(id)` sur une `Map`.
`FakeUserStore` : `findById`, `upsertFromOAuth`.

### 6.2 `agent-auth.hook.ts` — API agent (`/api/agents/v1/*`)

Toutes les requêtes ci-dessous sur `GET /api/agents/v1/boards`, container en `auth: 'none'` (le middleware global laisse passer ; c'est bien le hook du scope qu'on isole).

| Cas | Header | Attendu |
|---|---|---|
| Pas de header | — | **401** `{ error: 'API_TOKEN_INVALID' }` |
| Schéma non-Bearer | `Authorization: Basic xxx` | **401** `API_TOKEN_INVALID` |
| Token inconnu | `Authorization: Bearer fleex_deadbeef` | **401** `API_TOKEN_INVALID` |
| Token valide | `Authorization: Bearer <secret>` | **200** |
| `x-agent-name` fourni | `Bearer <secret>` + `x-agent-name: builder` | Le nom porté par le handler est `builder`, pas le nom du token — vérifié via `GET /api/agents/v1/settings` → `{ name: 'builder', status: 'active' }` |
| `x-agent-name` absent | `Bearer <secret>` seul | `GET .../settings` → `{ name: <nom du token> }` |
| Isolation du scope | `GET /api/boards` (hors scope) sans Bearer | **200** — le hook agent ne fuit pas hors du scope `/api/agents/v1` |

Le 401 passe par `error-handler.ts` (le hook `throw` un `ApiTokenInvalidError`), donc le corps est `{ error: 'API_TOKEN_INVALID', message: 'Invalid or missing API token' }` et non `{ error: 'Invalid token' }`. Les deux formats coexistent — c'est le comportement actuel, on le verrouille tel quel.

---

## 7. Mapping d'erreurs

### 7.1 Comportement mappé (à verrouiller)

`error-handler.test.ts` monte une app de test et enregistre des routes jetables qui `throw` chaque erreur, puis vérifie le statut **et** le corps `{ error: <code>, message: <string> }`.

| Code | Statut | Déclencheur réel utilisable en test |
|---|---|---|
| `TICKET_NOT_FOUND` | 404 | `GET /api/agents/v1/tickets/inconnu` |
| `BOARD_NOT_FOUND` | 404 | `POST /api/agents/v1/tickets` avec `boardId` inconnu |
| `COMMENT_NOT_FOUND` | 404 | `PATCH /api/agents/v1/tickets/:id/comments/inconnu` |
| `MENTION_NOT_FOUND` | 404 | `PATCH /api/agents/v1/mentions/inconnu/acknowledge` |
| `DELIVERABLE_NOT_FOUND` | 404 | route deliverables agent |
| `SESSION_NOT_FOUND` | 404 | route jetable |
| `REPOSITORY_NOT_FOUND` | 404 | route jetable |
| `DELIVERABLE_TYPE_NOT_FOUND` | 404 | route jetable |
| `API_TOKEN_INVALID` | 401 | `/api/agents/v1/*` sans Bearer |
| `FORBIDDEN` | 403 | `PATCH /api/agents/v1/tickets/:id/comments/:cid` par un autre agent |
| `SESSION_ALREADY_EXISTS`, `SESSION_NAME_CONFLICT`, `DELIVERABLE_TYPE_CONFLICT`, `DELIVERABLE_TYPE_IN_USE` | 409 | routes jetables |
| `LAST_BOARD` | 422 | `DELETE /api/boards/:id` sur le dernier board |
| `SLACK_INVALID_URL`, `SLACK_INTEGRATION_UNAVAILABLE`, `SLACK_CONVERSATION_INACCESSIBLE`, `SLACK_CONVERSATION_EMPTY` | 422 | routes jetables |
| `WORKTREE_ERROR`, `INVALID_DELIVERABLE_TYPE` | 400 | routes jetables |
| `TMUX_NOT_AVAILABLE` | 503 | route jetable |
| Erreur JS quelconque (`new Error('boom')`) | 500 `{ error: 'INTERNAL_ERROR', message: 'boom' }` | route jetable |

### 7.2 Test de complétude — le vrai garde-fou

Un test dédié, `error-handler.test.ts › la table CODE_TO_STATUS couvre toutes les DomainError` :

1. `import * as errors from '../../../src/domain/errors.js'`
2. Instancier chaque export qui étend `DomainError` (avec des args factices), collecter les `.code`.
3. Comparer à une **table attendue codée en dur dans le test** :

```ts
const EXPECTED_STATUS_BY_CODE = {
  // mappés
  SESSION_NOT_FOUND: 404, /* … les 24 entrées de CODE_TO_STATUS … */

  // NON MAPPÉS — retombent en 500. Comportement actuel, volontairement verrouillé.
  // Voir la dette §11-F1 : ces codes devraient renvoyer 404/409/422.
  AGENT_PERSONA_NOT_FOUND:       500,  // devrait être 404
  AGENT_PERSONA_NAME_CONFLICT:   500,  // devrait être 409
  SKILL_NOT_FOUND:               500,  // devrait être 404
  SKILL_COMMAND_NAME_CONFLICT:   500,  // devrait être 409
  PANEL_NOT_FOUND:               500,  // devrait être 404
  PANEL_NAME_CONFLICT:           500,  // devrait être 409
  WORKFLOW_RUN_ALREADY_ACTIVE:   500,  // devrait être 409
  WORKFLOW_TEMPLATE_NOT_FOUND:   500,  // devrait être 404
  WORKFLOW_RUN_NOT_FOUND:        500,  // devrait être 404
  STEP_RUN_NOT_FOUND:            500,  // devrait être 404
  EXECUTION_CANCELLED:           500,
  INVALID_GATE_OUTCOME:          500,  // devrait être 400
} as const;
```

4. Assertion : l'ensemble des codes découverts === l'ensemble des clés de la table.
   → **Ajouter une nouvelle `DomainError` sans décider de son statut casse le test.**
5. Assertion complémentaire : pour au moins un code non mappé, un appel HTTP réel confirme le 500 (`GET /api/personas/inconnu` → 500). Ça rend la dette visible dans le rapport de test plutôt que dans un commentaire.

---

## 8. Endpoints couverts

Le ticket demande « les 25 endpoints les plus utilisés ». La liste ci-dessous en compte 57 : les 20 premiers couvrent l'essentiel du trafic web, les suivants l'API agent, qui porte tout le trafic automatisé et n'a aujourd'hui **aucun** test. Les tables sont numérotées pour pouvoir être découpées en lots si le volume l'impose — §8.2 lignes 1 à 21 et §8.3 lignes 37 à 51 sont le noyau incompressible.

### 8.1 `app-wiring.test.ts` — couverture de surface des 215 endpoints

Le hook `onRoute` doit être posé **avant** tout `register` — d'où l'option `onRoute` de `BuildAppOptions` (§4.1). `createTestApp()` accepte donc un `onRoute` optionnel qu'il transmet à `buildApp()`.

```ts
const routes: string[] = [];
const h = await createTestApp({ onRoute: (r) => {
  const methods = Array.isArray(r.method) ? r.method : [r.method];
  for (const m of methods) routes.push(`${m} ${r.url}`);
} });
await expect(routes.sort().join('\n') + '\n')
  .toMatchFileSnapshot('./__snapshots__/route-inventory.txt');
```

Trois lignes en prod, couverture des 215 endpoints en test.

Ce snapshot, versionné en clair, casse sur : route supprimée, chemin renommé, méthode changée, préfixe `/api/agents/v1` cassé, plugin non enregistré. Le diff est lisible en revue.

Il est produit avec les **options par défaut** (`workflowTemplates: true`, `workflowRunStore: null`) : il contient donc les 6 routes `/api/workflows/templates*` et **aucune** route `/api/workflows/runs*`. Les autres assertions du fichier construisent leurs propres apps avec des options explicites.

Autres assertions du fichier :
- `GET /route/inexistante` → **404** (et pas de handler SPA, car `serveStatic: false`).
- Container sans `workflowTemplateStore` (`workflowTemplates: false`) → `GET /api/workflows/templates` → **404**.
- Container sans `workflowRunStore` (toujours le cas) → `GET /api/workflows/runs` → **404** (D6).
- CORS : réponse à un `OPTIONS` cross-origin → header `access-control-allow-origin` présent.

### 8.2 Routes « humaines » — comportement

Chaque ligne = au moins un test qui assert le statut **et** une propriété du corps.

| # | Endpoint | Cas couverts |
|---|---|---|
| 1 | `GET /health` | 200, `{ status: 'ok', tmux: true, uptime: number }` |
| 2 | `GET /api/config` | 200, contient `basePath` ; `workspace` présent ssi `FLEEX_WORKSPACE` est set |
| 3 | `PUT /api/config` | 200 ; `basePath` et `workspace` du body sont **ignorés** ; les autres clés sont persistées (relire via `GET`) |
| 4 | `GET /api/boards` | 200, `[]` sur base vierge ; 200 avec le board seedé |
| 5 | `POST /api/boards` | 201 + corps board ; le board est relisible |
| 6 | `PATCH /api/boards/:id` | 200 nom/emoji modifiés ; id inconnu → **404 `BOARD_NOT_FOUND`** |
| 7 | `DELETE /api/boards/:id` | 204 quand ≥2 boards (et les tickets du board sont supprimés) ; **422 `LAST_BOARD`** sur le dernier |
| 8 | `GET /api/tickets` | 200 ; filtres `boardId`, `boardId`+`status`, `tag`, `epicId` ; chaque DTO porte un tableau `epics` |
| 9 | `POST /api/tickets` | 201 ; `displayId` attribué ; event `ticket.created` dans `h.events` |
| 10 | `GET /api/tickets/:id` | 200 par UUID ; **200 par `displayId`** (`/api/tickets/3` et `/api/tickets/%233`) ; inconnu → 404 |
| 11 | `PATCH /api/tickets/:id` | 200 ; `?silent=true` n'émet pas d'event `ticket.updated` |
| 12 | `DELETE /api/tickets/:id` | 204 |
| 13 | `POST /api/tickets/:id/archive` / `/unarchive` | statuts + `archivedAt` non nul / nul |
| 14 | `POST /api/tickets/:id/move` | statut ; event `ticket.moved` avec `fromStatus`/`toStatus` |
| 15 | `GET /api/tickets/:id/comments` | 200 ; ordre chronologique |
| 16 | `POST /api/tickets/:id/comments` | 201 ; `@agent:x` dans le corps crée une mention (visible via `GET .../mentions`) ; event `comment.posted` |
| 17 | `DELETE /api/tickets/:id/comments/:cid` | 204 |
| 18 | `GET /api/tickets/:id/deliverables` | 200 |
| 19 | `POST /api/tickets/:id/deliverables` | 201 ; type invalide → **400 `INVALID_DELIVERABLE_TYPE`** |
| 20 | `GET /api/tickets/:id/mentions` | 200 ; filtres `status` / `target_agent` |
| 21 | `GET /api/tickets/unread-counts` | 200, forme du corps |
| 22 | `GET /api/personas` / `POST` / `DELETE /:id` | 200 / 201 / 204 ; **`GET /api/personas/inconnu` → 500** (dette §7.2) |
| 23 | `GET /api/skills` / `POST` / `DELETE /:id` | 200 / 201 / 204 |
| 24 | `GET /api/agent-tokens` | 200 ; le `secret` **n'est jamais** dans la réponse (que `prefix`) |
| 25 | `POST /api/agent-tokens` | 201 ; le `secret` **est** présent, une seule fois ; body sans `name` → 400 |
| 26 | `DELETE /api/agent-tokens/:id` | 204 |
| 27 | `GET /api/sessions` | 200, `[]` |
| 28 | `POST /api/sessions` | `cwd` inexistant → **422 `CWD_NOT_FOUND`** ; `cwd` existant (déclaré dans `FakeTmuxPort`/`NodeHostFs`) → 201 + event `session.created` |
| 29 | `GET /api/sessions/:id` | 404 sur inconnu ; 200 sur seedé |
| 30 | `DELETE /api/sessions/:id` | 204 |
| 31 | `GET /api/epics` / `POST` / `DELETE /:id` | 200 / 201 / 204 |
| 32 | `POST /api/epics/:id/tickets/:tid` / `DELETE` | 201 / 204 ; `GET /api/epics/:id/tickets` reflète l'appartenance |
| 33 | `POST /api/hook` | payload valide + IP locale → **200 `{ accepted: true }`** ; `timestamp` vieux de 60 s → **200 `{ accepted:false, reason:'stale' }`** ; `timestamp` dans 60 s → `reason:'future'` ; IP non locale (`inject({ remoteAddress:'10.0.0.1' })`) → **403** ; `event` hors enum → **400** (validation de schéma Fastify) ; `cwd` manquant → **400** |
| 34 | `POST /api/files` | PNG valide (magic bytes `89 50 4E 47 …`) → 200 + `{ id, url, mimeType:'image/png' }` ; pas de fichier → **400** ; type interdit (ex. ELF/zip) → **400** ; corps multipart construit à la main (D10) |
| 35 | `GET /api/files/:id` | 200 + `content-type` + `X-Content-Type-Options: nosniff` ; inconnu → **404** |
| 36 | `GET /api/workflows/templates` | 200 avec le fake store ; `POST` → 201 ; slug dupliqué → **409** ; `GET /:id` inconnu → **404** (route gérée explicitement, pas via l'error-handler) |

Pour le cas 33 : `app.inject()` positionne `remoteAddress` à `127.0.0.1` par défaut, donc le chemin nominal passe sans configuration.

### 8.3 `agent-v1.routes.test.ts` — API agent

Toutes authentifiées via `agentAuth(secret, 'builder')`.

| # | Endpoint | Cas |
|---|---|---|
| 37 | `GET /api/agents/v1/boards` | 200 ; chaque board porte `ticketCounts` avec **toutes** les clés de `TICKET_STATUSES` |
| 38 | `GET /api/agents/v1/tickets` | 200 ; filtres `board_id` et `board_id`+`status` |
| 39 | `GET /api/agents/v1/tickets/:id` | 200 ; inconnu → 404 |
| 40 | `POST /api/agents/v1/tickets` | 201 ; board inconnu → 404 ; le ticket est inséré **en tête** (`position = min - 1`) ; activité `created` avec `actorName: 'builder'` |
| 41 | `PATCH /api/agents/v1/tickets/:id` | 200 ; activité `updated` seulement si le diff est non vide |
| 42 | `DELETE /api/agents/v1/tickets/:id` | 204 |
| 43 | `PATCH .../tickets/:id/claim` / `/unclaim` | 200 ; `assignee` = `builder` puis `null` |
| 44 | `PATCH .../tickets/:id/complete` | 200 ; `backlog → done` puis rappel `done → doing` (toggle) ; event `ticket.moved` |
| 45 | `GET .../tickets/next` | 200 `{ ticket: null }` si rien ; sinon `{ ticket: {...} }` |
| 46 | `GET .../tickets/pending` | 200, uniquement les tickets claim par `builder` |
| 47 | `GET /api/agents/v1/settings` | 200 `{ name: 'builder', status: 'active' }` |
| 48 | `GET .../tickets/:id/comments` | 200 ; un commentaire `private` destiné à un **autre** agent est filtré ; filtres `visibility`, `since`, `parentId`, `limit` |
| 49 | `POST .../tickets/:id/comments` | 201 ; `createdMentions` renvoyé ; ticket inconnu → 404 |
| 50 | `PATCH .../tickets/:id/comments/:cid` | 200 par l'auteur ; **403 `FORBIDDEN`** par un autre agent ; inconnu → 404 |
| 51 | `DELETE .../tickets/:id/comments/:cid` | 204 par l'auteur ; **403** sinon |
| 52 | `GET .../mentions/pending` | 200, uniquement celles ciblant `builder` ; filtre `ticket_id` |
| 53 | `PATCH .../mentions/:id/acknowledge` | 200 ; **403** si `targetAgent !== builder` ; inconnu → 404 |
| 54 | `PATCH .../mentions/:id/resolve` | 200, statut `resolved` |
| 55 | `PATCH .../mentions/:id/wait-for-info` | 200, statut `waiting_for_info` ; **403** si mauvais agent |
| 56 | `GET .../tickets/:id/context` | 200 ; contient ticket + commentaires + deliverables |
| 57 | `POST .../tickets/:id/deliverables` | 201 ; `GET .../deliverables` 200 ; `DELETE` 204 |

---

## 9. WebSocket

`app.inject()` ne fait pas d'upgrade : ces deux fichiers démarrent un vrai serveur.

```ts
const address = await h.app.listen({ port: 0, host: '127.0.0.1' });
const ws = new WebSocket(`${address.replace('http', 'ws')}${WS_AGENT_PATH}?token=${secret}`);
```

`agent-ws.test.ts` :

| Cas | Attendu |
|---|---|
| Connexion sans `?token` | Fermeture **code 4001**, raison `Missing token` |
| `?token=` inconnu | Fermeture **4001**, `Invalid token` |
| `?token=<valide>` | Connexion ouverte, reste ouverte |
| `?agent_name=x` | `container.agentBroadcast('mention:created', { targetAgent: 'x', ticketId })` → message reçu |
| Ciblage mention | `targetAgent: 'autre'` → **rien** reçu par `x` (assert par timeout court + compteur à 0) |
| `subscribe` | `{ action:'subscribe', ticketIds:[t1] }` puis broadcast `ticket.updated` sur `t1` → reçu ; sur `t2` → non reçu |
| `unsubscribe` | après désabonnement, plus rien sur `t1` |
| Message JSON malformé | Socket **non fermée**, pas de crash serveur |
| Commentaire privé | `privateRecipients: ['x']` → reçu par `x`, pas par `y` |

`unified-ws.test.ts` — périmètre minimal (le plugin est gros et couplé aux PTY) :

| Cas | Attendu |
|---|---|
| Connexion sur `WS_PATH` | Ouverte sans token (pas d'auth sur ce canal — comportement actuel, à verrouiller explicitement) |
| Broadcast canal | `container.ticketBroadcast('ticket.updated', {...})` → trame JSON `{ type, data }` reçue |
| Fermeture propre | `app.close()` ferme les sockets clients |

Chaque test WS a un timeout explicite et un `afterEach` qui ferme sockets + serveur, pour ne pas laisser de handle ouvert (`heartbeat.stop()` inclus).

---

## 10. Critères d'acceptation

1. `bun run test` passe, en local et en CI, **sans réseau** et **sans host-gateway** démarré.
2. **Le critère du ticket** : changer un statut HTTP sur une route couverte casse au moins un test. Vérification manuelle exigée avant merge, sur trois routes au hasard parmi §8.2/§8.3 (ex. passer le 201 de `POST /api/tickets` en 200 → test rouge).
3. Renommer une route casse `route-inventory.txt`.
4. Ajouter une `DomainError` sans lui donner de statut casse `error-handler.test.ts`.
5. Déplacer `app.addHook('preHandler', authMiddleware)` avant `hookRoutes` casse le cas 11 de §6.1.
6. Retirer le `preHandler` du scope `/api/agents/v1` casse §6.2.
7. Aucune régression : `bun run lint` (tsc) et `bun run test:bun` passent.
8. Aucun répertoire temporaire ne subsiste après la suite (chaque `close()` nettoie).
9. Aucune nouvelle dépendance dans `packages/server/package.json`.
10. `main.ts` ne contient plus de `app.register(...)` de route ; tout est dans `build-app.ts`.

---

## 11. Dette identifiée & suites

| # | Sujet | Détail |
|---|---|---|
| F1 | 12 codes `DomainError` non mappés → 500 | `AGENT_PERSONA_NOT_FOUND`, `SKILL_NOT_FOUND`, `PANEL_NOT_FOUND`, `WORKFLOW_*_NOT_FOUND`, `STEP_RUN_NOT_FOUND`, les 4 conflits de noms, `INVALID_GATE_OUTCOME`, `EXECUTION_CANCELLED`. **Ticket séparé** : compléter `CODE_TO_STATUS` puis mettre à jour `EXPECTED_STATUS_BY_CODE`. Le filet posé ici rend le fix sûr. |
| F2 | `version.routes.ts` non testable | `execSync('git fetch origin main')` + cache au niveau module. À refactorer avec un port injecté avant de pouvoir être couvert. |
| F3 | Routes workflow runs | Nécessite `workflowRunStore` + `stepRunStore` + 4 use cases. À couvrir en `*.bun.test.ts` sur sqlite en mémoire, ou avec des fakes in-memory. |
| F4 | Routes à I/O externe | `/api/repositories/*` (20 endpoints), `/api/github/*`, `/api/dashboard`, `/api/claude-usage`, `/api/models`, `/api/exec`, `/api/github-image/*`, `/api/overlay-sync/*`. Couvertes par le snapshot d'inventaire uniquement. |
| F5 | `tests/` n'est pas type-checké | `packages/server/tsconfig.json` a `"include": ["src"]`. `FakeHostFs` viole déjà `HostFs` (pas d'`appendFile`) sans que rien ne le signale. **Ticket séparé** : ajouter un `tsconfig.test.json` au `bun run lint`. |
| F6 | Variante driver `sqlite` | Rejouer §8 sur sqlite en `*.bun.test.ts` pour attraper les divergences d'adaptateurs. |

## 12. Risques

| Risque | Mitigation |
|---|---|
| Le refactor `buildApp()` casse le démarrage prod | Copier-coller strict, aucun changement de comportement. Vérifier `bun run dev` avant merge. |
| Les tests sont lents (I/O disque par test) | Mesurer ; si > 30 s pour la suite intégration, passer à `beforeAll` + reset ciblé des stores par fichier. |
| Handles laissés ouverts (heartbeat, sockets) → vitest ne rend pas la main | `heartbeat.stop()` avant `app.close()` dans `close()` ; `afterEach` systématique ; lancer une fois avec `--reporter=verbose` pour repérer un hang. |
| Fuite d'env entre tests (`vi.stubEnv`) | `vi.unstubAllEnvs()` en `afterEach` dans tout fichier qui stubbe. |
| Les stubs `vi.fn()` masquent de vraies régressions | Assumé : ces routes déclenchent des exécutions SDK. Le périmètre est explicite (§4.3), la table doit rester à jour. |
