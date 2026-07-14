# Fleex — Positionnement & USP

> **Statut :** draft v1 — base de travail pour la landing page, la doc publique et l'onboarding.
> **Périmètre :** isoler l'USP, définir le messaging, cartographier la concurrence (Conductor, Orca, Emdash).

---

## 1. TL;DR

**USP en une phrase :**

> **Les autres orchestrent des sessions d'agents. Fleex orchestre du travail — et capitalise la connaissance qui en sort.**

Les ADE de la génération actuelle (Conductor, Orca, Emdash) sont *session-first* : leur objet central est la session d'agent dans son worktree. Fleex est *ticket-first* : son objet central est le ticket — unité de travail **et** unité de connaissance — dont les sessions ne sont qu'un moyen d'exécution. La preuve par l'usage : dans Fleex, la vue « sessions » devient une vue de debug, un *last resort*. Chez les concurrents, c'est l'écran principal.

**Taglines candidates :**

| # | FR | EN |
|---|----|----|
| 1 | Orchestrez du travail, pas des terminaux. | Orchestrate work, not terminals. |
| 2 | Le système de delivery agentique. | The agentic delivery system. |
| 3 | Vos agents livrent. Fleex retient. | Your agents ship. Fleex remembers. |
| 4 | Du ticket au PR, sans perdre une miette de contexte. | From ticket to PR, without losing a byte of context. |

Recommandation : **#1 en hero**, #3 en sous-titre (elle porte le différenciateur GED, le plus difficile à copier).

---

## 2. Le marché : la génération « session-first »

La vague 2025–2026 d'ADE (Agent Development Environments) s'est construite **au-dessus des harness** (Claude Code, Codex, Cursor CLI, Grok…) avec une proposition commune : *exécuter N sessions en parallèle sans qu'elles se marchent dessus*, grâce aux git worktrees.

État des lieux (juillet 2026) :

| | **Conductor** | **Orca** | **Emdash** |
|---|---|---|---|
| Nature | App macOS, YC, Series A $22M | ADE open source (Apache 2.0), desktop + mobile | ADE open source (YC W26), desktop |
| Objet central | La session / le workspace isolé | La flotte de sessions parallèles | La session par worktree |
| Agents supportés | Claude Code, Codex, Cursor | 27+ CLI agents (BYO subscription) | 25+ agents |
| Tickets | Import Linear/GitHub comme *description de tâche* | — | Import Linear, Jira, GitHub, Asana, Monday… comme *input* |
| Multi-repo par tâche | Non (1 workspace = 1 repo) | Non (1 worktree = 1 tâche) | Non |
| Connaissance persistée | Le transcript de session | Logs, diffs, statuts | Transcript + prompts réutilisables |
| Orchestration inter-agents | Non (review/merge humain) | Skill d'orchestration (messages entre terminaux) | Scheduling de runs |
| Headless / API | Non | Partiel | Non |
| Coûts | Non (BYO login) | Non (BYO subscription) | Non |

Ils ont tous gagné la même bataille : la **parallélisation isolée**. C'est devenu une commodité — le ticket d'entrée dans la catégorie, plus un différenciateur.

**L'angle mort commun :** quand la session se termine, tout s'évapore. Le contexte, les décisions, les artefacts intermédiaires vivent dans un transcript qu'on ne relira jamais. Chaque nouvelle tâche repart de zéro. Et une « tâche » réelle — qui touche 3 repos, produit 2 PRs et nécessite une revue — n'a aucune représentation native : elle est éclatée en N sessions sans lien entre elles.

---

## 3. L'insight fondamental

> **La session est du compute éphémère. Le ticket est du travail durable.**

Trois renversements structurent Fleex :

1. **Ticket-first, pas session-first.** Importer un ticket Linear comme prompt (ce que font Conductor et Emdash), c'est utiliser le ticket comme *input*. Dans Fleex, le ticket est la *primitive persistante* : il porte le workspace, les sessions, les discussions, les livrables, les coûts. Les sessions naissent et meurent ; le ticket, lui, accumule.

2. **Le workspace épouse le travail, pas le repo.** Un vrai ticket traverse les frontières : front + back + infra, 3 worktrees, 2 PRs. Chez les concurrents, l'unité d'isolation est le worktree mono-repo — le multi-repo est un bricolage. Dans Fleex, **1 ticket = 1 workspace = N repos × N worktrees × N PRs, nativement**.

3. **La connaissance est le produit, pas un sous-produit.** Chaque ticket est un dossier vivant : commentaires (y compris inter-agents via @mentions), livrables structurés, et — point clé — même une session *manuelle* au terminal génère un summary à sa clôture. Cette GED s'exporte en **OKF (Open Knowledge Format)** : la connaissance vous appartient, elle est portable, elle nourrit les agents suivants.

C'est le même saut que Jira vs un gestionnaire de fenêtres : on ne « manage » plus des processus, on pilote de la delivery.

---

## 4. Les 6 piliers du messaging

Ordre = ordre d'apparition sur la landing. Chaque pilier : bénéfice → preuve produit → pourquoi c'est défendable.

### Pilier 1 — Ticket-first, kanban local-first
- **Bénéfice :** votre backlog *est* votre orchestrateur. Vous glissez un ticket, le travail démarre ; vous n'ouvrez plus un terminal « pour voir ».
- **Preuve :** kanban 5 colonnes natif, local-first (SQLite/JSON/PostgreSQL/Supabase), pas de dépendance à un SaaS de ticketing.
- **Défendabilité :** les concurrents *importent* des tickets depuis un outil tiers ; en faire la primitive centrale exige de refonder tout le modèle de données. C'est une architecture, pas une feature.

### Pilier 2 — Un workspace par ticket, multi-repo natif
- **Bénéfice :** les tâches réelles traversent les repos. Fleex est le seul où « corriger le contrat d'API côté server et consommer côté web » est *un* ticket, pas trois sessions orphelines.
- **Preuve :** multi-repo × multi-worktree × multi-PR par ticket, gestion centralisée des worktrees, dashboard PRs/issues via GitHub GraphQL.
- **Défendabilité :** découle directement du pilier 1 — impossible sans le modèle ticket-first.

### Pilier 3 — Des primitives agentiques, pas des terminaux nus
- **Bénéfice :** vous composez des capacités : personas, skills, workflows, **panels** (comités d'agents qui délibèrent). Le handoff se fait par @mention, comme entre collègues.
- **Preuve :** primitives personas/skills/workflows/panels, mentions inter-agents avec cycle de vie (pending → acknowledged → resolved), commentaires publics/privés entre agents.
- **Défendabilité :** Orca a un skill d'orchestration (messages entre terminaux) ; Fleex a un *modèle de collaboration* structuré avec états et traçabilité. La nuance : script vs système.

### Pilier 4 — GED : la mémoire de votre delivery (exportable en OKF)
- **Bénéfice :** rien ne s'évapore. Six mois plus tard, le « pourquoi » d'une décision est dans le ticket — discussion, livrables, summaries. Chaque ticket terminé rend le suivant plus rapide.
- **Preuve :** commentaires threadés, deliverables structurés, summary automatique même pour les sessions manuelles au terminal, export OKF.
- **Défendabilité :** **c'est le pilier le plus difficile à copier** — il suppose que toute l'activité transite par le ticket (piliers 1–3). Un session-manager ne peut pas le greffer après coup. C'est aussi le seul pilier qui crée un *moat d'usage* : la valeur croît avec l'historique.

### Pilier 5 — Orchestrable de partout, même headless
- **Bénéfice :** Fleex n'est pas une app, c'est un système. CLI, MCP, companion mobile (PWA), extension Chrome, assistant chat : lancez un panel depuis votre téléphone, interrogez la GED depuis Claude via MCP.
- **Preuve :** API agents v1 documentée, package MCP, PWA mobile (kanban + sessions live via Tailscale), extension Chrome sidepanel, architecture gateway multi-machines.
- **Nuance honnête :** Orca a une app mobile. Le différenciateur n'est pas « mobile » mais **« surface d'orchestration complète »** — l'API/MCP permet à d'autres systèmes (et d'autres agents) de piloter Fleex. Conductor est une app Mac ; Fleex est une plateforme.

### Pilier 6 — Cost management par primitive
- **Bénéfice :** vous savez ce que coûte un ticket, un persona, un panel — pas juste « ma facture Anthropic a grossi ».
- **Preuve :** tracking des usages par primitive agentique (SDK sessions) **et** par session CLI.
- **Défendabilité :** les concurrents en BYO-subscription n'ont aucune incitation à le construire ; c'est indispensable dès qu'une équipe (ou un manager) entre dans la boucle. **C'est le pilier qui ouvre le marché équipe/entreprise.**

---

## 5. Positioning statement

> **Pour** les développeurs et équipes qui livrent avec des flottes d'agents IA,
> **qui** constatent que gérer des sessions parallèles ne suffit plus — le contexte s'évapore, les tâches multi-repos s'éclatent, les coûts sont opaques —
> **Fleex** est un système de delivery agentique, local-first,
> **qui** transforme chaque ticket en workspace multi-repo, en équipe d'agents composables et en dossier de connaissance exportable (OKF),
> **contrairement à** Conductor, Orca ou Emdash, qui orchestrent des sessions éphémères et perdent tout à leur clôture.

**Nom de catégorie à revendiquer :** la génération actuelle a nommé sa catégorie « ADE » (Agent *Development* Environment). Fleex peut soit la subvertir — **ADE = Agentic *Delivery* Environment** (mêmes lettres, étage au-dessus) — soit en créer une : **Agentic Delivery System**. Recommandation : jouer le détournement « Development → Delivery », mémorable et polémique juste ce qu'il faut pour un lancement (HN, X).

---

## 6. Messages par persona

| Persona | Douleur | Message d'accroche |
|---|---|---|
| **Solo dev / indie hacker puissance-agents** | 6 sessions ouvertes, plus aucune idée de qui fait quoi ni pourquoi | « Votre kanban pilote vos agents. Vous ne regardez les terminaux que pour débugger. » |
| **Tech lead / staff eng** | Les tâches réelles touchent 3 repos ; les ADE actuels n'en représentent qu'un | « Un ticket = un workspace multi-repo, multi-PR. Enfin la bonne granularité. » |
| **EM / responsable plateforme** | Coûts IA opaques, connaissance dans la tête des devs (ou pire, dans des transcripts) | « Chaque ticket trace ses coûts et capitalise sa connaissance — exportable en OKF, sans lock-in. » |
| **Power user automation** | Veut déclencher des agents depuis ses propres outils | « CLI, MCP, mobile, Chrome : Fleex s'orchestre headless. C'est une plateforme, pas une app. » |

---

## 7. Objections & réponses

| Objection | Réponse |
|---|---|
| « Emdash importe déjà mes tickets Linear. » | Importer un ticket comme prompt ≠ le ticket comme primitive. Chez Emdash le ticket est l'*input* d'une session ; chez Fleex c'est le *conteneur* du workspace, des sessions, des livrables et des coûts. Après la session : chez eux un transcript, chez nous un dossier. |
| « Conductor est plus poli / mieux financé. » | Conductor est une excellente app Mac session-first. Fleex joue un étage au-dessus : delivery, connaissance, headless, multi-machines. Et Fleex est local-first : vos données, votre disque, votre format (OKF). |
| « Orca supporte 27 agents, Fleex est Claude-centric. » | Vrai aujourd'hui — assumer : profondeur avant largeur. La couche ticket/GED/coûts est agnostique du harness ; l'ouverture à d'autres harness est une roadmap, pas une refonte. *(À valider : promesse publique ou non.)* |
| « Encore un kanban ? J'ai déjà Jira/Linear. » | Fleex n'est pas votre outil de gestion de projet, c'est votre *runtime* de delivery. Le kanban est l'interface de déclenchement des agents, local-first. Une synchro vers Jira/Linear est un pont, pas une concurrence. |
| « OKF, c'est quoi ? Encore un format propriétaire ? » | L'inverse : Open Knowledge Format = la garantie anti-lock-in. Votre GED s'exporte intégralement. À documenter publiquement dès le lancement pour que la promesse soit vérifiable. |

---

## 8. Ce qu'il ne faut PAS revendiquer (crédibilité)

- ❌ « Le seul avec des tickets » — Conductor et Emdash importent des tickets. Dire : *le seul ticket-first*.
- ❌ « Le seul sur mobile » — Orca est desktop + mobile. Dire : *orchestrable headless de partout (CLI/MCP/mobile/Chrome/chat)*.
- ❌ « Le seul open source / local » — Orca et Emdash sont open source. Jouer : *local-first + vos données exportables (OKF)*.
- ❌ « Plus d'agents supportés » — faux (Orca : 27+, Emdash : 25+). Ne pas se battre sur ce terrain.

Le terrain où personne ne peut suivre sans se refonder : **ticket-first + GED/OKF + coûts par primitive**. Tout le marketing doit converger là.

---

## 9. Récapitulatif — la pyramide de messaging

```
                    ┌─────────────────────────────┐
                    │  Orchestrez du travail,      │   ← tagline
                    │  pas des terminaux.          │
                    └──────────────┬──────────────┘
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                     ▼
      TICKET-FIRST          CONNAISSANCE            CONTRÔLE
   1 ticket = 1 workspace   GED + summaries      coûts par primitive,
   multi-repo, multi-PR,    auto + export OKF    headless (CLI/MCP),
   agents composables                            local-first
   (personas, panels)
              │                    │                     │
              ▼                    ▼                     ▼
        « la bonne          « vos agents          « une plateforme,
        granularité »       n'oublient rien »     pas une app »
```

---

## 10. Prochaines étapes (phase 2)

1. **Landing page** — structure hero (tagline #1 + #3), démo 60s « du ticket au PR », section « session-first vs ticket-first » (le tableau §2 en visuel), preuve OKF.
2. **Doc publique** — spécifier et publier OKF en premier (c'est la promesse vérifiable) ; puis agent API v1, MCP, workflows/panels.
3. **Onboarding** — le « aha moment » à viser : *créer un ticket → un panel livre un deliverable → le summary apparaît dans la GED*, en < 10 minutes. Le wizard actuel (3 personas + board Personal) est la bonne base.
4. **Lancement** — angle HN/X : « ADE : Development → Delivery », post technique sur le modèle ticket-first et OKF.
