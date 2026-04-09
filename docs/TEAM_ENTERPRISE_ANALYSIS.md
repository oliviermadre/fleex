# Fleex : Analyse du passage Individual → Team / Enterprise

> Analyse stratégique et technique du passage de Fleex d'un outil standalone (dev local) vers un mode team/enterprise.

---

## 1. Etat des lieux : ce que Fleex est aujourd'hui

### Architecture actuelle

```
Browser (React 19)  ←→  Server (Fastify)  ←→  Host Gateway (Bun)
     UI + xterm.js         API + WebSocket        tmux + PTY + fs
```

### Modele de donnees

Fleex est un **control center pour orchestrer des agents IA** (Claude) sur des repos. Il gere :

- **Boards / Tickets** — Kanban 5 colonnes avec activites, liens GitHub, assignees
- **Agent Personas** — Profils d'agents IA avec soul/identity/memory markdown
- **Skills** — Commandes/outils attaches a un persona
- **Panels** — Orchestrations multi-agents
- **Sessions** — Sessions tmux avec streaming live via xterm.js
- **Comments / Mentions / Deliverables** — Systeme de collaboration agents ↔ humain
- **Domain Event Log** — Event sourcing pour audit trail

### Ce qui existe deja (et qui aide)

| Brique | Etat | Note |
|--------|------|------|
| 4 drivers de stockage | JSON, SQLite, PostgreSQL, Supabase | Abstraction propre via ports/adapters |
| Table `users` | Existe dans Supabase schema | OAuth GitHub/Google, mais usage "individuel" |
| Auth middleware | 3 modes (no-auth, no-SSO, full OAuth) | `request.userId` injecte, mais un seul user a la fois |
| `user_kv` store | Per-user key-value | Preco Supabase, implique deja un `user_id` |
| RLS (Row-Level Security) | Active sur toutes les tables Supabase | Mais policies = `USING (true)` → tout passe |
| API tokens | Hash + prefix | TODO dans le code : `token.userId when multi-user tokens` |
| `humanDisplayName` / `humanMentionName` | Config globale singleton | Un seul humain configure |
| Session cookie 30 jours | `user_sessions` table | Deja multi-user capable |

### Ce qui bloque pour le mode team

| Probleme | Detail |
|----------|--------|
| **Pas de notion de tenant/org** | Aucune table `organizations`, `teams`, `memberships` |
| **Pas de multi-tenancy** | Boards, tickets, personas, skills = globaux, sans `org_id` |
| **Pas de RBAC** | Aucun role, permission, scope. Tout le monde peut tout faire |
| **Config singleton** | `app_config` = 1 row. `basePath`, `humanDisplayName` = global |
| **Assignee = string libre** | `ticket.assignee` est un texte, pas une FK vers `users` |
| **Pas de billing/quotas** | Aucun tracking de consommation par user/org |
| **Pas de shared state** | Chaque dev run son propre serveur local. Pas de notion de "workspace partage" |
| **Fichiers sur disque local** | `DiskFileStoreAdapter` stocke dans `~/.fleex/files/` |
| **Sessions tmux = locales** | Ephemeres, sur la machine du dev. Impossible de "voir" les sessions d'un collegue |

---

## 2. Que signifie un mode Team / Enterprise ?

### 2.1 Vision produit : 3 niveaux

```
┌─────────────────────────────────────────────────────────┐
│  SOLO (v1 actuelle)                                     │
│  → 1 dev, 1 machine, stockage local                    │
│  → Valeur : productivite individuelle avec agents IA    │
├─────────────────────────────────────────────────────────┤
│  TEAM (v2)                                              │
│  → 5-20 devs, 1 workspace partage                      │
│  → Valeur : visibilite + collaboration + standards      │
├─────────────────────────────────────────────────────────┤
│  ENTERPRISE (v3)                                        │
│  → N equipes, multi-workspace, gouvernance              │
│  → Valeur : controle + compliance + scale               │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Ce que "Team" veut dire concretement

Un mode Team, c'est la capacite pour une equipe de :

1. **Partager un workspace commun** — memes boards, tickets, personas, skills
2. **Voir ce que font les autres** — qui travaille sur quoi, quels agents sont actifs
3. **Collaborer via les tickets** — commenter, assigner, mentionner (humains ET agents)
4. **Avoir des standards communs** — personas partages, skills d'equipe, conventions
5. **Garder le contexte** — quand un dev quitte un ticket, un autre peut reprendre avec l'historique

---

## 3. Interets par persona

### 3.1 Pour le Dev

| Interet | Description |
|---------|-------------|
| **Visibilite equipe** | Voir le board d'equipe, savoir qui fait quoi, eviter les doublons |
| **Personas partages** | Utiliser les agents configures par le lead/senior sans les recreer |
| **Historique persistant** | Retrouver les deliverables et commentaires d'un collegue sur un ticket |
| **Mentions cross-humain** | `@olivier` dans un commentaire de ticket → notification |
| **Onboarding accelere** | Nouveau dev = acces immediat au workspace, boards, agents configures |
| **Standards sans friction** | Les skills d'equipe sont deja la, pas besoin de configurer from scratch |

### 3.2 Pour le Tech Lead / Manager

| Interet | Description |
|---------|-------------|
| **Dashboard d'activite** | Combien de tickets done cette semaine, par qui, avec quels agents |
| **Monitoring agents** | Quels agents tournent, combien de tokens consommes, taux de succes |
| **Standards d'equipe** | Configurer UNE FOIS les personas, skills, conventions → deploye a tous |
| **Allocation de travail** | Assigner des tickets a des devs ou des agents depuis le board |
| **Qualite** | Voir les deliverables, les reviews auto, les patterns de l'equipe |

### 3.3 Pour le Head of / CTO

| Interet | Description |
|---------|-------------|
| **ROI mesurable** | Metriques agregees : tickets/semaine, temps moyen de resolution, cout agents |
| **Gouvernance IA** | Quels modeles sont utilises, quels agents ont acces a quoi, audit trail |
| **Controle des couts** | Quotas par equipe, alertes de consommation, budget tokens |
| **Compliance** | Logs d'audit, RBAC, SSO enterprise (SAML/OIDC), data residency |
| **Adoption** | Combien de devs utilisent Fleex, frequence, engagement |
| **Scalabilite** | Deployer a N equipes sans que ca devienne le chaos |

---

## 4. Changements techniques requis

### 4.1 Phase 1 — Multi-tenancy (fondation)

#### Nouveau modele de donnees

```sql
-- Organizations
CREATE TABLE organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,  -- pour URLs : fleex.app/odys/...
  plan        TEXT NOT NULL DEFAULT 'team',  -- solo | team | enterprise
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Memberships (users ↔ organizations)
CREATE TABLE memberships (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id),
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  role        TEXT NOT NULL DEFAULT 'member',  -- owner | admin | member | viewer
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, org_id)
);

-- Invitations
CREATE TABLE invitations (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### Ajout de `org_id` sur les tables existantes

Tables a modifier (ajout colonne + index + migration) :

| Table | Changement |
|-------|------------|
| `boards` | + `org_id TEXT NOT NULL` |
| `tickets` | Herite via `board.org_id` (pas de colonne directe) |
| `agent_personas` | + `org_id TEXT NOT NULL` |
| `skills` | Herite via `persona.org_id` |
| `panels` | + `org_id TEXT NOT NULL` |
| `api_tokens` | + `org_id TEXT NOT NULL` + `user_id UUID` |
| `app_config` | Remplacer singleton par `config per org` |
| `agent_event_executions` | + `org_id TEXT NOT NULL` (pour metriques) |

#### RLS policies reelles

```sql
-- Exemple : boards visibles uniquement par les membres de l'org
CREATE POLICY "org_members_boards" ON boards
  FOR ALL
  USING (
    org_id IN (
      SELECT org_id FROM memberships WHERE user_id = auth.uid()
    )
  );
```

### 4.2 Phase 2 — RBAC (roles et permissions)

#### Matrice de permissions

| Action | Owner | Admin | Member | Viewer |
|--------|-------|-------|--------|--------|
| Gerer l'org (billing, membres) | x | | | |
| Inviter des membres | x | x | | |
| Creer/supprimer boards | x | x | x | |
| Creer/editer tickets | x | x | x | |
| Configurer personas/skills | x | x | | |
| Executer des agents | x | x | x | |
| Voir boards/tickets | x | x | x | x |
| Voir metriques | x | x | x | x |
| Supprimer l'org | x | | | |

#### Implementation

```typescript
// Nouveau port
export interface AuthorizationPort {
  checkPermission(userId: string, orgId: string, action: Permission): Promise<boolean>;
  getUserRole(userId: string, orgId: string): Promise<Role | null>;
  requirePermission(userId: string, orgId: string, action: Permission): Promise<void>; // throws
}

// Middleware enrichi
declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    orgId?: string;   // resolve depuis URL ou header
    role?: Role;       // resolve depuis membership
  }
}
```

### 4.3 Phase 3 — Deployment model

#### Aujourd'hui : tout local

```
Dev machine
├── fleex start
│   ├── host-gateway (bun, port 3001)
│   ├── server (fastify, port 3000)
│   └── web (vite, port 5173)
└── ~/.fleex/
    ├── fleex.db (sqlite)
    └── files/
```

#### Mode Team : serveur central + gateways locaux

```
                    ┌──────────────────────────┐
                    │   Fleex Cloud / Self-host │
                    │   ─────────────────────── │
                    │   Server (Fastify)        │
                    │   PostgreSQL / Supabase   │
                    │   Web UI (static)         │
                    │   Auth (OAuth / SSO)      │
                    └─────────┬────────────────┘
                              │ HTTPS + WSS
              ┌───────────────┼───────────────┐
              │               │               │
        ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
        │  Dev A     │  │  Dev B     │  │  Dev C     │
        │  Gateway   │  │  Gateway   │  │  Gateway   │
        │  (local)   │  │  (local)   │  │  (local)   │
        │  tmux+PTY  │  │  tmux+PTY  │  │  tmux+PTY  │
        └────────────┘  └────────────┘  └────────────┘
```

**Avantage** : Les sessions tmux restent locales (elles DOIVENT l'etre — c'est du PTY sur la machine du dev), mais les donnees (boards, tickets, agents, deliverables) sont centralisees.

**Le gateway local devient un "agent" du serveur central** — il s'enregistre, remonte la telemetrie, et execute les commandes tmux localement.

### 4.4 Phase 4 — Fonctionnalites Team

| Feature | Description | Effort |
|---------|-------------|--------|
| **Notifications** | In-app + optionnel email/Slack quand mentionne/assigne | Moyen |
| **Presence** | Qui est en ligne, qui regarde quel board | Faible (WebSocket deja la) |
| **Activity feed** | Timeline globale de l'equipe | Faible (DomainEventLog existe) |
| **Metriques equipe** | Dashboard : tickets done, agents runs, tokens utilises | Moyen |
| **Assignee = user reel** | `ticket.assignee` → FK vers `users.id` au lieu de string | Faible |
| **Search** | Recherche full-text dans tickets, comments, deliverables | Moyen |
| **Templates** | Boards / tickets / personas templates d'equipe | Faible |

### 4.5 Phase 5 — Enterprise

| Feature | Description | Effort |
|---------|-------------|--------|
| **SSO SAML/OIDC** | Integration avec Okta, Azure AD, Google Workspace | Eleve |
| **Audit log** | Export des events, retention configurable, compliance | Moyen (base existe) |
| **Quotas & billing** | Limites par org (agents concurrents, tokens/mois) | Eleve |
| **Multi-workspace** | 1 org → N workspaces (par equipe, par projet) | Moyen |
| **Data residency** | Choix de la region de stockage (EU, US) | Eleve (infra) |
| **API publique** | REST API documentee pour integrations externes | Moyen |
| **Webhooks sortants** | Notifier des systemes externes sur events Fleex | Moyen |
| **IP allowlisting** | Restreindre l'acces par plage IP | Faible |
| **Custom SSO** | SCIM provisioning, group mapping → roles | Eleve |

---

## 5. Contraintes d'installation et d'usage

### 5.1 Mode Solo (actuel)

```bash
curl -fsSL ... | bash    # install CLI
fleex start               # tout tourne en local
```

- **Zero infra** — tout est sur la machine du dev
- **Zero config reseau** — localhost only
- **Zero auth** — un seul user implicite

### 5.2 Mode Team — Contraintes ajoutees

| Contrainte | Impact |
|------------|--------|
| **Serveur central** | Quelqu'un doit heberger le server Fleex (cloud ou self-host) |
| **Base de donnees partagee** | PostgreSQL ou Supabase obligatoire (plus de JSON/SQLite) |
| **Auth obligatoire** | OAuth GitHub/Google minimum, SSO pour enterprise |
| **Reseau** | Le gateway local doit pouvoir atteindre le serveur central (HTTPS) |
| **Configuration initiale** | Creer l'org, inviter les membres, configurer le storage |
| **Gateway registration** | Chaque dev doit connecter son gateway au serveur central |
| **Gestion des secrets** | API keys Anthropic → par org ou par user ? A definir |

### 5.3 Ce qui ne change PAS pour le dev

| Aspect | Detail |
|--------|--------|
| **Experience locale** | Le dev continue de `fleex start` localement pour son gateway |
| **tmux / PTY** | Les sessions restent sur sa machine |
| **Claude CLI** | Toujours en local, le dev utilise son propre token Anthropic |
| **Git workflow** | Worktrees, branches, PRs = inchanges |
| **Performance** | Streaming terminal = local, pas de latence reseau |

---

## 6. Impact sur l'architecture existante

### 6.1 Ce qui est bien concu et facilite la transition

1. **Ports/Adapters pattern** — Ajouter un `org_id` aux ports est chirurgical, chaque adapter s'adapte independamment
2. **4 storage drivers** — Le driver PostgreSQL/Supabase est deja la pour le mode team
3. **EventBus + DomainEventLog** — L'audit trail existe, il suffit d'ajouter `org_id` aux events
4. **Auth middleware 3 modes** — Le mode "full OAuth" est deja implemente
5. **WebSocket infra** — 7 channels WS existent, ajouter presence/notifications = incremental
6. **Session store toujours JSON local** — Bonne decision, pas besoin de changer ca

### 6.2 Ce qui demande du refactoring

1. **Config singleton** → Config per-org (migration de `app_config`)
2. **`humanDisplayName` global** → Per-user (deja dans `users.name`)
3. **Tous les stores** → Ajout de filtre `org_id` dans les queries
4. **RLS policies** → Passer de `USING (true)` a des vraies policies per-org
5. **Agent tokens** → Associer a un user + org
6. **`ticket.assignee: string`** → `ticket.assignee_id: UUID` FK vers users
7. **Container** → Injecter `orgId` dans le contexte de request

### 6.3 Migrations de donnees

Pour les utilisateurs solo existants qui upgrade vers team :

```
Migration strategy:
1. Creer une org "default" pour l'user existant
2. Rattacher tous les boards/personas/skills existants a cette org
3. L'user devient "owner" de l'org
4. Les donnees sont preservees, rien n'est perdu
```

---

## 7. Priorisation recommandee

### Sprint 1 — Fondations (2-3 semaines)

- [ ] Tables `organizations`, `memberships`, `invitations`
- [ ] Migration : ajout `org_id` sur boards, personas, panels, tokens, config
- [ ] Migration data : creation org "default" pour users existants
- [ ] Middleware : extraction `orgId` depuis URL/header + injection request
- [ ] `assignee` → `assignee_id` (FK users)

### Sprint 2 — Auth & RBAC (2 semaines)

- [ ] AuthorizationPort + adapter
- [ ] Matrice de permissions (owner/admin/member/viewer)
- [ ] Invitation flow (email + token)
- [ ] UI : page org settings, invite members, role management

### Sprint 3 — Deployment model (2-3 semaines)

- [ ] Gateway registration protocol (gateway → server)
- [ ] Gateway heartbeat + status reporting
- [ ] Server central : mode "hosted" vs "embedded"
- [ ] UI : voir les gateways connectes de l'equipe

### Sprint 4 — Features Team (2 semaines)

- [ ] Notifications in-app (mentions, assignments)
- [ ] Presence indicators (qui est en ligne)
- [ ] Activity feed global (leveraging DomainEventLog)
- [ ] Dashboard metriques equipe

### Sprint 5 — Polish & Enterprise prep (ongoing)

- [ ] SSO SAML/OIDC
- [ ] Quotas & billing hooks
- [ ] Audit log export
- [ ] API publique

---

## 8. Risques et points d'attention

| Risque | Mitigation |
|--------|------------|
| **Complexite d'installation team** | Proposer un mode "Fleex Cloud" hosted pour eviter le self-host |
| **Performance queries avec org_id** | Index sur `org_id` partout, denormalisation si besoin |
| **Migration users existants** | Script de migration automatique, zero downtime |
| **Gestion des cles Anthropic** | Garder le modele "chaque dev a sa cle" en v2, centraliser en v3 |
| **Sessions tmux non partageables** | C'est OK — ne pas essayer de partager le PTY, partager les DONNEES |
| **Scope creep** | Le mode team n'a pas besoin de tout. Commencer par la visibilite partagee |
| **Retrocompatibilite** | Le mode solo DOIT continuer a fonctionner tel quel (JSON/SQLite local) |

---

## 9. Decision cle : Hosted vs Self-host

Pour Odys/Evaneos, la question immediate est :

| Option | Avantage | Inconvenient |
|--------|----------|-------------|
| **Self-host** (Docker Compose + PG) | Controle total, data interne | Quelqu'un doit maintenir |
| **Fleex Cloud** (SaaS multi-tenant) | Zero ops pour l'equipe | Couts, data externe, a construire |
| **Supabase-backed** (chaque org = 1 projet Supabase) | Quick win, auth incluse | Limite en fonctionnalites team |

**Recommandation** : Commencer par le mode **self-host** (Docker Compose avec PostgreSQL). C'est le chemin le plus court pour Odys/Evaneos. Le mode cloud viendra naturellement ensuite puisque c'est la meme architecture avec un reverse proxy en plus.

---

## 10. Resume

Fleex a une **architecture saine** pour cette transition :

- Le pattern ports/adapters permet d'ajouter le multi-tenancy sans tout reconstruire
- Les 4 drivers de stockage signifient que le mode solo (SQLite/JSON) continue de vivre
- L'auth OAuth et le middleware 3 modes sont une base solide
- L'EventBus + DomainEventLog donnent l'audit trail gratuitement
- Le design "gateway local + server central" est deja dans l'ADN de l'architecture

Les **gaps principaux** sont :
1. Le modele de donnees n'a pas de notion d'organisation
2. Pas de RBAC
3. Le deployment model est 100% local
4. La config est un singleton global

Aucun de ces gaps n'est un blocker architectural. C'est du **travail incremental** sur une base bien concue.
