# Fleex — Spec d'onboarding (v1)

> **Statut :** draft v1 — compagnon de [adoption.md](adoption.md) (piliers P0/P1).
> **Référence analysée :** onboarding d'Orca (juillet 2026, captures desktop macOS).

---

## 1. Teardown : ce que fait Orca

### Le flow (3 étapes + premier projet)

| Écran | Contenu | Observation |
|---|---|---|
| 1/3 — *Pick your default agent* | **Détecte** les agents installés (« Detected on your system · 2 »), les 32 autres derrière un « Show more ». Checkbox « Yolo / Dangerously skip permissions ». | Détection > sélection : zéro saisie. L'étape 1 met en scène **leur USP** (le multi-agent). Le yolo pré-coché est un défaut discutable. |
| 2/3 — *Make it feel like home* | Choix du thème (System/Dark/Light) avec previews. | Étape purement cosmétique = zéro charge cognitive. « Pick the look you want to stare at for hours » : le copy vend l'usage intensif. |
| 3/3 — *Set up notifications* | Permission macOS, choix du son, **bouton « Send Test Notification »**. | Une étape entière pour les notifs : pour un orchestrateur d'agents, le wow c'est « pars faire autre chose, on te ping ». Le test button fait vivre la promesse immédiatement. |
| Post-wizard — *Add a project* | Modal : Host (Local Mac ▾), Browse folder / Clone from URL / Create new project. Toast « Onboarding completed! → Star on GitHub ». | Le host picker expose le multi-machine sans l'expliquer. La demande de star arrive au pic de bonne volonté. |
| In-app | **Checklist d'onboarding persistante** dans la sidebar ; **coach marks contextuels** (« Start another task in parallel — 2 of 2 », « Add a setup script → Configure ») ; **jauges d'usage dans la status bar** (« 0% used 5h · 8% used wk »). | La pédagogie continue *après* le wizard, au point d'usage. L'usage/quota est ambiant, pas caché dans un menu. |

### Ce qu'il faut retenir

1. **Aucune question d'infrastructure.** Agent (détecté), thème, notifs — c'est tout. Pas de nom, pas de chemin, pas de driver de stockage. Tout est skippable (« Skip to project setup »), tous les CTA ont un raccourci (⌘↩).
2. **L'étape 1 met en scène l'USP.** Chez Orca : la liste des 34 agents. La leçon n'est pas « demander l'agent en premier », c'est « ouvrir sur ce qui te rend unique ».
3. **La pédagogie est déplacée hors du wizard** : checklist persistante + coach marks contextuels. Le wizard installe le confort ; les concepts s'apprennent au moment où on les touche.
4. **Le trou dans leur flow** : après l'onboarding, on atterrit… dans un terminal vide avec un worktree. Le « et maintenant ? » reste à la charge de l'utilisateur. C'est exactement l'espace que le ticket de démo de Fleex doit occuper.
5. **À ne pas copier** : le « Yolo / Dangerously skip permissions » pré-coché. Fleex le propose décoché, avec une explication.

---

## 2. Le flow Fleex (cible)

Budget : **3 écrans + 1 atterrissage**. Règle : une seule idée nouvelle à enseigner (le ticket) — tout le reste est du confort ou de la détection. Chaque écran est skippable, chaque CTA a un raccourci.

### Écran 1/3 — « Your board » *(l'USP en scène d'ouverture)*

- Affiche le board **déjà vivant** : 3 personas seedés + **le ticket de démo terminé** (FLX-001 : discussion, deliverable, summary, coût, 2 repos) visible en colonne *done*.
- Copy : *« This is your board. Tickets drive agents; sessions come and go, tickets remember. Here's one we shipped earlier — open it. »*
- Une seule action possible : ouvrir le ticket de démo (ou Continue). Ouvrir = visiter la GED remplie. **C'est notre équivalent du « pick your agent » d'Orca : l'écran 1 = l'USP.**
- En arrière-plan : défauts silencieux appliqués (SQLite, chemin worktree standard). Zéro question.

### Écran 2/3 — « Your tools » *(détection > sélection)*

- Détecte `claude`, `gh`, `tmux` : lignes vertes « detected », boutons « Install » pour les absents. tmux affiché comme **optionnel** (« only needed for CLI terminal sessions »).
- Choix du thème sur le même écran (les 10 thèmes existants, previews) — on fusionne le cosmétique avec la détection pour tenir en 3 écrans.
- Permissions agents : proposées en mode sûr par défaut ; le mode « skip permissions » existe mais décoché + tooltip d'explication.

### Écran 3/3 — « Stay in the loop » *(la promesse « walk away »)*

- Notifications desktop + **Send test notification** (copier le pattern Orca, il est bon).
- Spécifique Fleex : choisir **quoi** notifier — *session summary posted*, *@mention pour vous*, *panel terminé*, *PR ouverte*. Le picker enseigne les primitives en les nommant, sans tutoriel.
- Teaser mobile : QR code vers la PWA (« your board, from your phone »).

### Atterrissage — « Add a repo » + checklist persistante

- Modal identique dans l'esprit à Orca : Browse / Clone from URL, host picker (gateway multi-machine visible sans être expliqué).
- **Checklist sidebar** (persistante, 4 items — c'est le zéro→aha de la landing) :
  1. ☐ Add a repo
  2. ☐ Launch two parallel sessions
  3. ☐ Group them into a ticket
  4. ☐ End a session → watch the summary land ✨
- Chaque item a son **coach mark contextuel** qui apparaît au bon endroit (pattern Orca), pas un tour guidé bloquant.
- À la complétion de l'item 4 (l'aha) : toast « That summary just became permanent knowledge. ⭐ Star Fleex on GitHub? » — la demande de star au pic de bonne volonté, après la preuve.

### Ambient (post-onboarding)

- **Status bar : coût par ticket actif** (« FLX-3 · $1.24 today ») — la réponse ambiante à « je peux faire ccusage », et un cran au-dessus des jauges de quota d'Orca : eux montrent *combien tu consommes*, nous montrons *ce que ça a produit*.
- Nudges différés (cf. adoption.md P1.5) : regrouper en ticket à la 3ᵉ session liée, récap coûts hebdo, etc.

---

## 3. Différences assumées vs Orca

| Sujet | Orca | Fleex |
|---|---|---|
| Écran 1 | Leur USP : 34 agents détectés | Notre USP : le board avec un ticket déjà « vécu » |
| Après le wizard | Terminal vide + worktree (« et maintenant ? ») | Board vivant + checklist vers l'aha summary |
| Permissions | Yolo pré-coché | Mode sûr par défaut, yolo opt-in expliqué |
| Status bar | Quota consommé (5h/semaine) | Coût **par ticket** — l'attribution, pas la jauge |
| Pédagogie concepts | Aucun concept à enseigner (session-first) | Un seul concept (le ticket), enseigné par visite du ticket de démo, jamais par texte |

---

## 4. Découpage build (raccroché au plan adoption)

| Item | Dépend de | Plan |
|---|---|---|
| Ticket de démo seedé (FLX-001) | — | P0.3 |
| Wizard 3 écrans (remplace le wizard CLI pour le chemin desktop) | Packaging desktop | P0.1/P0.2 |
| Détection claude/gh/tmux + install in-app | — | P0.2 |
| Checklist sidebar + coach marks | — | P1.7 |
| Picker de notifications par primitive | — | P1.5 |
| Coût par ticket en status bar | Cost tracking existant | P1.5 |
| Toast star-on-GitHub post-aha | Checklist | P2 |
