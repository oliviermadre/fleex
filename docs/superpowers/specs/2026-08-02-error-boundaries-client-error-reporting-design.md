# Error boundaries & remontée des erreurs client — PRD

**Ticket**: Error boundaries et remontée des erreurs client
**Statut**: final — prêt pour build
**Date**: 2026-08-02

---

## 1. Problem statement

### 1.1 Ce qui est vrai dans le ticket

`packages/web` n'a **aucun error boundary**. Vérifié : zéro `componentDidCatch`, zéro
dépendance `react-error-boundary`, zéro `static getDerivedStateFromError` dans tout le repo.

L'arbre est monolithique :

```
main.tsx  →  <App>  →  <BrowserRouter>  →  <AppLayout>  →  grid 3 colonnes
                                                            ├── <NavSidebar>
                                                            ├── <ContentPanel>
                                                            └── <MainPanel>   ← 14 branches
```

`MainPanel.tsx` est une chaîne de `if` sur `activePanel`, dont le type union compte
exactement **14 valeurs** (`uiStore.ts:4`) : `dashboard | sessions | repositories | tickets |
list-focus | claude-config | agents | cluster | settings | scratchpads | analytics |
execution-log | documents | assistant`.

Conséquence : une exception de rendu **n'importe où** sous `AppLayout` démonte tout l'arbre.
React 19 sans boundary → `root.render` unmount complet → **page blanche**. Pas seulement le
centre : la nav, le content panel, les toasts, la command palette. Tout.

### 1.2 Ce qui est faux dans le ticket — et qui change la solution

Deux corrections importantes issues de l'exploration du code.

**Correction A — le périmètre « web, desktop, sidepanel-host » n'existe pas.**

Un seul des trois packages a un arbre React :

| Package | Nature réelle | Preuve | Error boundary applicable ? |
|---|---|---|---|
| `packages/web` | App React 19 + Vite | `main.tsx` → `createRoot` | **Oui** — cible unique |
| `packages/desktop` | Shell Electron, CommonJS | `src/main.js:260` → `mainWindow.loadURL(serverUrl)` | **Non** — il charge `web`, il hérite donc des boundaries gratuitement |
| `packages/sidepanel-host` | Serveur Node/Bun | `src/server.ts`, `anthropic.ts`, `tools.ts` — pas de React DOM | **Non** — c'est un process, pas un arbre |

Ajouter des « error boundaries » à desktop et sidepanel-host n'a pas de sens. Ces deux
runtimes ont un problème d'isolation **réel mais différent**, traité en P1 (§6) :
desktop ne gère ni `render-process-gone` ni `did-fail-load` (fenêtre blanche si le renderer
meurt ou si le serveur n'est pas up) ; sidepanel-host n'a **aucun** `uncaughtException` ni
`unhandledRejection` (un throw dans la boucle d'outils tue le process et toutes les
conversations WS).

**Correction B — les 50 `.catch(() => {})` n'avalent pas ce que le ticket croit.**

`api.ts` a un wrapper central que les ~80 fonctions d'API traversent, et il lève **déjà** un
toast d'erreur :

```ts
// packages/web/src/services/api.ts:55-68
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { ... });   // ← ligne 56
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const message = extractErrorMessage(body, res.statusText);
    useToastStore.getState().addToast('error', message);   // ← toast levé ici
    throw new Error(`API error ${res.status}: ${body || res.statusText}`);
  }
  ...
}
```

Donc pour une réponse HTTP 4xx/5xx, l'utilisateur **voit** un toast ; le `.catch(() => {})`
de l'appelant n'empêche que l'unhandled rejection. Le ticket surestime le problème.

Mais il en existe un vrai, plus grave, et invisible dans les comptages :

> **`await fetch(...)` ligne 56 rejette avant d'atteindre le `if (!res.ok)` ligne 60.**
> Panne réseau, serveur arrêté, DNS, offline, CORS → `fetch` throw un `TypeError`.
> Le toast ligne 63 **n'est jamais atteint**. Le `.catch(() => {})` de l'appelant avale
> tout. **Zéro feedback.**

C'est exactement le scénario `useSessions.ts:14` du ticket : serveur down → sidebar vide,
aucun message, aucune explication.

```ts
// packages/web/src/hooks/useSessions.ts:14-15
api.fetchSessionGroups().then(setSessionGroups).catch(() => {});
api.fetchSessions().then(setSessions).catch(() => {});
```

**Le levier n'est donc pas d'auditer 50 sites d'appel. C'est de corriger `request()` une
fois** — ce qui couvre les ~80 fonctions d'API d'un coup.

Second défaut, orthogonal : même quand le toast part, il **s'auto-dismiss en 5 s**
(`toastStore.ts:12`) et laisse une vue vide définitivement, sans explication ni retry.
Un toast est une notification, pas un état.

### 1.3 Reporting

23 `console.error` en code non-test — chiffre du ticket confirmé (24 occurrences dans
`packages/web/src`, dont 1 dans un `.test.tsx` ; 0 dans desktop et sidepanel-host). Idem pour
les `.catch(() => {})` : **50 exactement**, non-test, dans `packages/web/src`. Aucun pipeline
de reporting. Un crash chez un utilisateur ne laisse
aucune trace côté serveur. Le serveur a pourtant déjà un logger structuré
(`PinoLoggerAdapter`, `container.logger.error(msg, data)`) — il suffit de l'alimenter.

---

## 2. Solution proposée

Quatre chantiers, dont trois en P0.

| # | Chantier | Priorité | Résout |
|---|---|---|---|
| A | Error boundaries dans `packages/web` | **P0** | Page blanche |
| B | `POST /api/client-errors` + reporter client | **P0** | Zéro reporting |
| C | Fix du trou réseau dans `api.ts` + `useSessions` | **P0** | Échecs vraiment silencieux |
| D | Résilience process desktop + sidepanel-host | P1 | Fenêtre blanche / process mort |

### 2.1 Décisions tranchées

Le workflow est autonome : toutes les questions fonctionnelles sont arbitrées ici.
Le builder n'a rien à re-demander.

| # | Question | Décision | Raison |
|---|---|---|---|
| D1 | `react-error-boundary` en dépendance ? | **Non — codé à la main** | ~50 lignes. Le repo est avare en deps, et `lint` typecheck 5 tsconfig. Pas de dette pour si peu. |
| D2 | 14 boundaries (un par branche) ? | **Non — un seul boundary keyé** | Voir §2.2. Même isolation, 1 wrapper au lieu de 14, et reset automatique à la navigation. |
| D3 | Table DB `client_errors` + migration 025 ? | **Non** | Le ticket dit « le **même** pipeline de logs ». Ce pipeline, c'est `container.logger` → pino → stdout. Une table que personne ne requête est du YAGNI. **Aucune migration dans ce ticket.** |
| D4 | L'endpoint est-il authentifié ? | **Public**, enregistré avant le middleware d'auth | Un crash doit remonter même quand la session est morte — c'est précisément là que ça casse. Précédent existant : `/api/hook` (`main.ts:86`). Compensé par caps + rate limit (§4.3). |
| D5 | Auditer les 50 catch ? | **Non — 3 corrections ciblées** | `api.ts` (couvre ~80 fonctions), `useSessions`, les 3 loads d'init d'`AppLayout`. Le reste est hors scope, explicitement (§5.2). |
| D6 | Persister les erreurs pour une UI ? | **Non** | `ExecutionLogPage` affiche les exécutions d'agents, pas les logs serveur. Pas de nouvelle UI. |
| D7 | Stack trace visible en prod ? | **Non** — dev seulement | `import.meta.env.DEV`. En prod : message + errorId copiable. |
| D8 | Rate limiter via `@fastify/rate-limit` ? | **Non — compteur en mémoire** | ~15 lignes, pas de dep. Une seule route à protéger. |

### 2.2 Architecture des boundaries

Le point de design central. Le ticket demande « un boundary par branche de MainPanel
(14 branches) ». Répéter 14 wrappers dans une chaîne de `if` est verbeux, facile à oublier
lors de l'ajout d'un 15ᵉ panel, et — surtout — **crée un bug** : un boundary monté une fois
reste déclenché quand l'utilisateur navigue ailleurs.

> Scénario du bug : `TicketDetail` crashe sur le ticket A → l'utilisateur clique le ticket B
> dans la sidebar → le boundary est toujours en état d'erreur → écran de crash sur un ticket
> parfaitement sain. L'utilisateur doit recharger la page. Pire qu'avant.

**Solution : un seul boundary, keyé sur l'identité de la vue.**

React démonte et remonte un composant quand sa `key` change. En dérivant la key de
`(activePanel, entité sélectionnée)`, on obtient gratuitement :

- **isolation par branche** — le boundary ne couvre qu'une branche à la fois ;
- **reset automatique** à chaque navigation — plus de crash screen fantôme ;
- **un seul wrapper** — le 15ᵉ panel est protégé sans rien toucher.

```
main.tsx
└── <ErrorBoundary name="root">                    ← filet ultime, plein écran
    └── <App>
        └── <BrowserRouter>
            ├── <RouterSync>
            ├── <AppLayout>
            │   ├── <ErrorBoundary name="nav-sidebar">    → <NavSidebar>
            │   ├── <ErrorBoundary name="content-panel">  → <ContentPanel>
            │   ├── <ErrorBoundary name="main-view"
            │   │       key={viewKey}>                    → <MainPanel>   ★
            │   ├── <ErrorBoundary name="scratchpad">     → <ScratchpadPanel>
            │   └── <ErrorBoundary name="overlays">       → Floating*/Reading overlays
            ├── <CreateTaskModal>  <CommandPalette>
            ├── <ToastContainer>   ← jamais wrappé : c'est le canal de secours
            └── <NotificationToasts>  <VersionBanner>
```

`★` = le boundary qui satisfait le critère d'acceptation.

**Dérivation de `viewKey`** — nouveau hook `useMainViewKey()`, source de vérité unique,
appelé dans `AppLayout` (il doit être **hors** du boundary pour pouvoir le remonter) :

```
activePanel === 'tickets'      && selectedTicketId  → "tickets:t_abc123"
activePanel === 'tickets'      && !selectedTicketId → "tickets:board"
activePanel === 'analytics'                         → "analytics"
activePanel === 'repositories' && selectedRepoKey   → "repositories:org/name"
activePanel === 'agents'       && selectedSkillId   → "agents:skill:s_1"
activePanel === 'sessions'     && sessionTicketId   → "sessions:ticket:t_9"
…                                                   → fallback: activePanel
```

Le hook lit les mêmes stores que `MainPanel` (`uiStore`, `ticketStore`, `sessionStore`,
`skillStore`, `panelStore`, `workflowTemplateStore`, `scratchpadStore`) mais **ne duplique
pas la logique de branchement** — il concatène panel + id sélectionné. Fichier dédié pour
qu'il soit testable isolément.

`ToastContainer` n'est **jamais** wrappé : si tout crashe, il reste le canal capable de
dire quelque chose.

### 2.3 Écran de crash

Contrainte dure : `bun run lint` lance `scripts/check-raw-palette.mjs`, un ratchet qui
**échoue le build** sur toute classe Tailwind de palette brute (`text-red-400`,
`bg-red-500/15`, `border-red-500`…). Cible atteinte = 0.

→ L'écran de crash utilise **exclusivement** les variables `--theme-*` et les helpers de
`packages/web/src/lib/tints.ts` : `tint('red')`, `tintText('red')`, `tintSolid('red')`.
Idiome visuel : `EmptyState.tsx` (icône SVG `currentColor` + texte + `<Button>`).

Variante **view** (dans le grid, garde la nav visible) :

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│                        ⚠                                 │
│                                                          │
│              Cette vue a planté                          │
│                                                          │
│     Le reste de Fleex fonctionne toujours.               │
│                                                          │
│     ┌──────────────────────┐  ┌──────────────────┐       │
│     │  Recharger cette vue │  │  Copier l'erreur │       │
│     └──────────────────────┘  └──────────────────┘       │
│                                                          │
│     ─────────── dev uniquement ───────────               │
│     TypeError: Cannot read properties of undefined       │
│       at AnalyticsPanel (AnalyticsPanel.tsx:42:18)       │
│       at renderWithHooks (react-dom.js:11121:18)         │
│     ────────────────────────────────────────             │
│                                                          │
│     err_1a2b3c4d                                         │
└──────────────────────────────────────────────────────────┘
```

Variante **root** : plein écran, bouton primaire `Recharger Fleex`
(`window.location.reload()`), pas de « recharger cette vue ».

Variante **inline** (sidebar, content panel, overlays) : compacte, une ligne + un lien
`Réessayer`, pour ne pas casser le layout d'une colonne de 200 px.

- `Recharger cette vue` → incrémente un compteur interne au boundary → remonte les enfants.
  **Ne recharge pas la page.**
- `Copier l'erreur` → `navigator.clipboard.writeText()` avec message + stack +
  componentStack + errorId + viewKey. Pour coller dans un ticket.
- `errorId` = `err_` + 8 hex aléatoires, généré au catch, envoyé au serveur, affiché.
  Fait le lien entre le rapport utilisateur et la ligne de log serveur.

---

## 3. User flows

### Flow 1 — crash de rendu dans une vue (critère d'acceptation)

```
Utilisateur sur Analytics
        │
        ▼
AnalyticsPanel throw pendant le render
        │
        ▼
<ErrorBoundary name="main-view" key="analytics">  intercepte
        │
        ├─→ getDerivedStateFromError  →  state.error
        ├─→ componentDidCatch(error, info)
        │       └─→ reportClientError({ source:'boundary',
        │                               boundary:'main-view',
        │                               viewKey:'analytics', … })
        │               └─→ POST /api/client-errors   (fire-and-forget)
        │                       └─→ container.logger.error('client error', {…})
        │                               └─→ pino → stdout
        └─→ render <ErrorFallback variant="view" />

RÉSULTAT ÉCRAN :
┌────────┬──────────────┬─────────────────────────────┐
│  NAV   │   CONTENT    │   ⚠ Cette vue a planté      │  ← seule la vue est morte
│ intact │    intact    │   [Recharger cette vue]     │
└────────┴──────────────┴─────────────────────────────┘
   ▲          ▲
   └──────────┴── toujours cliquables : l'utilisateur navigue ailleurs et continue
```

Puis, deux sorties possibles :

```
(a) clic "Recharger cette vue"  →  resetKey++  →  remount AnalyticsPanel
                                                   ├─ erreur transitoire → vue OK
                                                   └─ erreur déterministe → crash screen à nouveau

(b) clic sur "Tickets" dans la nav  →  viewKey "analytics" → "tickets:board"
                                        →  React remonte le boundary (key changée)
                                        →  état d'erreur jeté  →  Kanban s'affiche normalement
```

Le chemin (b) est exactement ce que 14 boundaries placés à la main rateraient.

### Flow 2 — serveur injoignable au chargement (le vrai bug silencieux)

**Avant** :

```
AppLayout monte → useSessions → api.fetchSessions()
                                     │
                                     ▼
                              fetch() REJETTE (ECONNREFUSED)
                                     │
                                     ▼
                        ligne 60 `if (!res.ok)` jamais atteinte
                                     │
                                     ▼
                            .catch(() => {})  ← tout disparaît
                                     │
                                     ▼
              Sidebar vide. Aucun toast. Aucune explication. Aucun retry.
```

**Après** :

```
api.fetchSessions()
      │
      ▼
request() wrappe le fetch dans un try/catch
      │
      ├─→ toast error « Serveur injoignable — vérifiez que Fleex tourne »
      ├─→ throw NetworkError (sous-classe, discriminable par les appelants)
      │
      ▼
useSessions catch → setLoadError(err)
      │
      ▼
┌──────────────────────────┐
│  ⚠ Serveur injoignable   │   ← état PERSISTANT dans la sidebar,
│     [Réessayer]          │      survit au dismiss du toast (5 s)
└──────────────────────────┘
```

Le toast prévient. L'état explique et propose une action. Les deux sont nécessaires.

### Flow 3 — erreur JS hors React

```
window 'error'  ────────────┐
window 'unhandledrejection' ├──→ reportClientError({ source })
createRoot onUncaughtError ─┘         │
                                      ▼
                            garde-fous (§4.2) : dédup, cap, jamais throw
                                      ▼
                             POST /api/client-errors
```

Note : les ~45 `.catch(() => {})` restants **empêchent** `unhandledrejection` de se
déclencher — c'est leur seul effet réel. Ils ne seront donc pas capturés par ce listener.
C'est assumé, et c'est pourquoi le fix de `api.ts` (§5.1) porte l'essentiel de la valeur.

---

## 4. Spécification technique

### 4.1 `ErrorBoundary` — `packages/web/src/components/errors/ErrorBoundary.tsx`

Classe React (les hooks ne peuvent pas intercepter les erreurs de rendu).

```ts
interface ErrorBoundaryProps {
  name: string;                          // 'root' | 'main-view' | 'nav-sidebar' | …
  variant?: 'root' | 'view' | 'inline';  // défaut: 'view'
  viewKey?: string;                      // contexte joint au rapport
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  errorId: string | null;
  resetKey: number;                      // incrémenté par "Recharger cette vue"
}
```

- `static getDerivedStateFromError(error)` → `{ error }`
- `componentDidCatch(error, info)` → génère `errorId`, appelle `reportClientError(...)`
- `render()` → si `state.error`, rend `<ErrorFallback>`, sinon
  `<React.Fragment key={resetKey}>{children}</React.Fragment>`
- Le reset vide `error`/`componentStack`/`errorId` et incrémente `resetKey`.

**Limites à documenter dans le JSDoc** (évite les fausses promesses) — un error boundary
React **ne capture pas** : les erreurs dans les event handlers, le code asynchrone
(`setTimeout`, `.then`), le SSR, ni les erreurs du boundary lui-même. Ces cas passent par
les listeners globaux du Flow 3.

### 4.2 Reporter — `packages/web/src/services/errorReporter.ts`

```ts
export function reportClientError(input: ClientErrorInput): void  // toujours void, jamais throw
export function installGlobalErrorHandlers(): void                // appelé une fois depuis main.tsx
```

Garde-fous **obligatoires** — sans eux, un crash en boucle DDoS le serveur :

| Garde-fou | Règle |
|---|---|
| Cap par page | Max **10** rapports par chargement de page ; au-delà, no-op silencieux |
| Dédup | Hash `message + stack.slice(0,200) + boundary` ; skip si déjà vu dans cette page |
| Jamais throw | Tout le corps dans un `try/catch {}`. Une erreur du reporter ne doit **jamais** re-déclencher un boundary |
| Pas de `request()` | `fetch` brut. Passer par `api.ts` lèverait un toast en cas d'échec → boucle de feedback |
| Fire-and-forget | `.catch(() => {})` assumé et **commenté** ici — c'est le seul endroit où c'est correct |
| Unload | `navigator.sendBeacon` si `document.visibilityState === 'hidden'`, sinon `fetch(..., {keepalive:true})` |
| Troncature | Côté client aussi : message 500, stack 8000, componentStack 4000 |

Payload (typé dans `packages/shared`, partagé web ↔ serveur) :

```ts
// packages/shared/src/types/client-error.ts
export interface ClientErrorReport {
  readonly errorId: string;
  readonly message: string;
  readonly stack?: string;
  readonly componentStack?: string;
  readonly source: 'boundary' | 'window.onerror' | 'unhandledrejection' | 'react.uncaught';
  readonly boundary?: string;
  readonly viewKey?: string;
  readonly url: string;
  readonly userAgent: string;
  readonly occurredAt: string;   // ISO 8601
  readonly seq: number;          // 1..10, position dans la page
}

export interface ClientErrorResponse {
  readonly accepted: boolean;
}
```

Exporter le type depuis `packages/shared/src/index.ts`.

### 4.3 Endpoint — `packages/server/src/infrastructure/http/client-errors.routes.ts`

Idiome copié sur `hook.routes.ts` (route publique, schéma JSON Fastify, garde interne).

```ts
export function clientErrorRoutes(container: Container) {
  return async function (app: FastifyInstance) {
    app.post<{ Body: ClientErrorReport }>(
      '/api/client-errors',
      {
        bodyLimit: 64 * 1024,          // 64 KB, vs 1 MB par défaut
        schema: {
          body: {
            type: 'object',
            required: ['errorId', 'message', 'source', 'url', 'occurredAt'],
            properties: { /* … voir types ci-dessus … */ },
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => { /* … */ },
    );
  };
}
```

Règles de la route :

1. **Rate limit** — `Map<ip, {count, windowStart}>` en module scope, **30 rapports /
   60 s / IP**. Au-delà : `202 { accepted: false }` + **un seul** `logger.warn` par fenêtre
   (ne pas logger chaque rejet — ce serait le DoS qu'on veut éviter).
2. **Troncature serveur** (défense en profondeur, le client peut mentir) :
   `message` 500, `stack` 8000, `componentStack` 4000.
3. **Log** :
   ```ts
   container.logger.error('client error', {
     errorId, message, source, boundary, viewKey, url, userAgent, occurredAt, seq,
     stack, componentStack,
   });
   ```
4. **Réponse : toujours `202 { accepted: … }`**, y compris en rate-limit. Jamais de 4xx/5xx
   → le client n'a aucune raison de retry, et un endpoint de reporting qui échoue
   bruyamment est un anti-pattern.
5. **Ne jamais throw** — sinon `registerErrorHandler` renvoie un 500 pour un rapport
   d'erreur, ce qui est absurde.

**Enregistrement** dans `packages/server/src/main.ts` — **avant** `app.addHook('preHandler',
authMiddleware)` (ligne 90), juste après `hookRoutes` (ligne 86) :

```ts
// Client error ingress — public: un crash doit remonter même session morte
await app.register(clientErrorRoutes(container));
```

Pas de check localhost (contrairement à `hook.routes.ts`) : le web est servi via
`tailscale serve` en mobile (cf. `docs/mobile.md`), les rapports viendraient d'IP distantes.

---

## 5. Chantier C — les catch silencieux

### 5.1 `api.ts` — le fix à fort levier

Une seule modification couvre les ~80 fonctions d'API.

```ts
// packages/web/src/services/api.ts

export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Serveur injoignable — vérifiez que Fleex tourne');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ... });
  } catch (cause) {
    const err = new NetworkError(cause);
    useToastStore.getState().addToast('error', err.message);  // ← le trou est bouché
    throw err;
  }
  if (!res.ok) { /* … inchangé … */ }
  ...
}
```

Le toast store dédupe déjà sur 10 s (`toastStore.ts:14`) : les 11 hooks d'init d'`AppLayout`
qui échouent en même temps produisent **un seul** toast. Pas de spam. Comportement déjà
correct, à vérifier par test.

### 5.2 Les deux corrections ciblées

**`useSessions.ts`** — ajouter un état d'erreur dans `sessionStore` (`sessionsLoadError:
string | null`), le renseigner dans les `.catch`, l'effacer au succès. Exposer une fonction
`retry()`. `ContentPanel` affiche la bannière `⚠ + [Réessayer]` quand l'erreur est non-nulle.
S'applique aux 4 sites : chargement initial (l.14-15) **et** reconnexion WS (l.18-19).

**`AppLayout.tsx:54-56`** — `loadSettings()`, `fetchRepositories()`, `loadDeliverableTypes()`
sont appelées sans `.catch`, donc chacune produit une unhandled rejection dans la console.
Les envelopper pour que l'échec parte dans `reportClientError` (source
`unhandledrejection`) au lieu d'être du bruit console.

### 5.3 Explicitement HORS scope

Les 46 autres `.catch(() => {})` (50 au total, moins les 4 de `useSessions.ts`) et les 89
`} catch {`. Les plus denses : `TicketComments.tsx` (9), `MobileConversation.tsx` (7),
`TicketDeliverables.tsx` (3), `TicketDetail.tsx` (3). Raison de ne pas y toucher : ils sont derrière
`request()`, donc l'utilisateur **voit déjà un toast** pour les erreurs HTTP, et le fix
§5.1 leur ajoute la couverture réseau. Les convertir un par un serait un diff de plusieurs
centaines de lignes pour un gain marginal, non testable, et à fort risque de régression.

Les 22 `console.error` restent tels quels — ils sont doublés par un toast venant de
`request()`. À traiter dans un ticket dédié si le besoin apparaît.

---

## 6. Chantier D (P1) — résilience des deux autres runtimes

À faire dans le même ticket, après que P0 soit vert. Petit et sans risque.

**`packages/desktop/src/main.js`** — aucun handler de crash aujourd'hui.

```js
mainWindow.webContents.on('render-process-gone', (_e, details) => { /* log + dialog "Recharger" */ });
mainWindow.webContents.on('unresponsive', () => { /* dialog "Attendre / Recharger" */ });
mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
  // serveur pas encore up → page d'erreur inline + retry auto (backoff 1s/2s/4s, 5 essais)
});
process.on('uncaughtException', (err) => { /* log, ne pas quitter */ });
```

Le cas `did-fail-load` est le plus fréquent en pratique : `loadURL(serverUrl)` ligne 260 sur
un serveur pas encore démarré → **fenêtre blanche muette**.

**`packages/sidepanel-host/src/server.ts`** — zéro handler process. Un throw dans la boucle
d'outils tue le process et **toutes** les conversations WS.

```ts
process.on('uncaughtException', (err) => { logger.error(...); /* ne pas rethrow */ });
process.on('unhandledRejection', (reason) => { logger.error(...); });
```

Plus un `try/catch` par message WS : une conversation qui casse ne doit pas emporter les
autres. Idiome de référence : `packages/server/src/main.ts:60-71` (avec le cas EPIPE),
mais **sans le `throw err`** final — ici, on veut survivre.

---

## 7. Acceptance criteria

### AC1 — isolation (critère du ticket)
Une exception forcée dans `AnalyticsPanel` affiche l'écran de crash **dans la zone
MainPanel uniquement**. `NavSidebar` et `ContentPanel` restent montés et interactifs.
→ Test : mock `AnalyticsPanel` pour throw, render `AppLayout`, asserter présence
simultanée du crash screen **et** d'un élément de la nav.

### AC2 — reset à la navigation
Après un crash sur `analytics`, cliquer un autre panel dans la nav affiche la vue cible
**normalement** (pas le crash screen persistant).
→ Test : `useMainViewKey` change quand `activePanel` change **et** quand `selectedTicketId`
change à panel constant.

### AC3 — reload de la vue
`Recharger cette vue` remonte le sous-arbre **sans recharger la page**.
→ Test : le composant enfant throw une fois puis réussit ; après clic, le contenu sain
s'affiche ; `window.location.reload` n'est pas appelé.

### AC4 — reporting
Un crash intercepté déclenche un `POST /api/client-errors` avec `errorId`, `message`,
`componentStack`, `boundary`, `viewKey`.
→ Test : `fetch` mocké, asserter URL + corps.

### AC5 — le reporter ne peut pas empirer la situation
Reporter 15 erreurs → 10 requêtes max. Deux erreurs identiques → 1 requête. `fetch` qui
rejette → `reportClientError` ne throw pas.
→ Test unitaire du reporter.

### AC6 — l'endpoint log et ne casse pas
Payload valide → 202 + `container.logger.error` appelé avec `errorId`. Payload > cap →
tronqué. 31ᵉ requête en 60 s → `202 {accepted:false}` et **pas** de log d'erreur.
→ Test de route avec logger mocké.

### AC7 — plus de trou réseau
`fetch` qui rejette dans `request()` → un toast `error` est levé et un `NetworkError` est
throw. Deux échecs en < 10 s → **un seul** toast (dédup).
→ Test sur `api.ts` avec `fetch` mocké en rejet.

### AC8 — état persistant sur `useSessions`
Échec du load initial → `sessionsLoadError` renseigné → bannière + `[Réessayer]`. Le retry
qui réussit efface l'erreur.

### AC9 — le lint passe
`bun run lint` vert. En particulier `scripts/check-raw-palette.mjs` : **zéro** classe de
palette brute dans les nouveaux composants (utiliser `--theme-*` et `lib/tints.ts`).

### AC10 — P1 desktop / sidepanel
Serveur arrêté puis `dev:desktop` → page d'erreur avec retry, pas de fenêtre blanche.
Throw injecté dans un handler WS sidepanel-host → process vivant, autres conversations OK.

---

## 8. Fichiers

**À créer**

```
packages/shared/src/types/client-error.ts
packages/web/src/components/errors/ErrorBoundary.tsx
packages/web/src/components/errors/ErrorFallback.tsx
packages/web/src/components/errors/ErrorBoundary.test.tsx
packages/web/src/components/main-panel/useMainViewKey.ts
packages/web/src/components/main-panel/useMainViewKey.test.ts
packages/web/src/services/errorReporter.ts
packages/web/src/services/errorReporter.test.ts
packages/web/src/services/api.network.test.ts
packages/web/src/components/layout/AppLayout.boundary.test.tsx
packages/server/src/infrastructure/http/client-errors.routes.ts
packages/server/src/infrastructure/http/client-errors.routes.test.ts
```

**À modifier**

```
packages/shared/src/index.ts                        export du type
packages/web/src/main.tsx                           boundary root + installGlobalErrorHandlers()
packages/web/src/App.tsx                            boundary root sur la branche mobile
packages/web/src/components/layout/AppLayout.tsx    4 boundaries + useMainViewKey + catch des 3 loads
packages/web/src/components/sidebar/ContentPanel.tsx bannière d'erreur sessions
packages/web/src/services/api.ts                    NetworkError + try/catch autour de fetch
packages/web/src/hooks/useSessions.ts               état d'erreur + retry
packages/web/src/stores/sessionStore.ts             sessionsLoadError + setter
packages/server/src/main.ts                         register clientErrorRoutes (avant l.90)
packages/desktop/src/main.js                        P1 — handlers de crash
packages/sidepanel-host/src/server.ts               P1 — handlers process
```

**Aucune migration.** (cf. D3)

---

## 9. Notes de test

- Setup : `vitest` + `@testing-library/react`, `environment: 'jsdom'`, `globals: true`,
  `setupFiles: []` (`packages/web/vitest.config.ts`). Alias `@fleex/shared` déjà configuré.
- **React log `console.error` à chaque erreur interceptée** → les tests de boundary seront
  bruyants. Stub via `vi.spyOn(console, 'error').mockImplementation(() => {})` dans
  `beforeEach`, restore dans `afterEach`.
- Stores zustand : lecture/écriture directe via `useXStore.getState()` / `.setState()`,
  reset en `beforeEach`. Idiome existant : `router/RouterSync.sync.test.tsx`.
- Assertions de toast : `useToastStore.getState().toasts.map(t => t.message)`. Idiome
  existant : `components/dashboard/SmartSessionButton.test.tsx`.
- Composant qui throw : `function Boom(): never { throw new Error('boom'); }`.
- **Ne pas** utiliser `request()` dans les tests du reporter — vérifier que c'est bien
  `fetch` brut qui est appelé.

## 10. Risques

| Risque | Mitigation |
|---|---|
| Boucle de crash → flood serveur | Cap 10/page + dédup client + rate limit 30/min serveur (§4.2, §4.3) |
| Le reporter throw et re-déclenche un boundary | `try/catch` global dans `reportClientError`, retour `void` — AC5 |
| `useMainViewKey` incomplet → crash screen fantôme | AC2 couvre le changement d'entité à panel constant |
| Écran de crash casse le lint palette | AC9 ; helpers `lib/tints.ts` imposés |
| Endpoint public abusé | Écriture seule, aucune donnée retournée, pas de persistance, caps stricts |
| Faux sentiment de sécurité | JSDoc explicite : ni event handlers, ni async, ni SSR (§4.1) |
