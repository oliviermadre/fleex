# Fleex sur mobile (PWA + Tailscale)

Pilote tes boards et tes sessions d'agents SDK depuis ton téléphone. Le laptop
fait tourner Fleex comme d'habitude (`fleex start`) ; le téléphone n'est qu'une
télécommande — kanban, tickets, conversation avec les agents, suivi live des
exécutions. Les terminaux CLI, dashboards et éditeurs restent sur desktop.

## Prérequis

- [Tailscale](https://tailscale.com/) installé sur le **laptop** et sur le
  **téléphone**, connectés au même tailnet (le plan gratuit suffit).
- Fleex qui tourne sur le laptop : `fleex start`.

## Setup (une fois)

1. Note le port **web** affiché par `fleex start` (ligne `Allocated ports —
   gateway:… server:… web:…`).

2. Sur le laptop, expose le port web en HTTPS sur le tailnet :

   ```bash
   tailscale serve --bg --https=443 http://localhost:<port-web>
   ```

   Tailscale fournit un certificat TLS valide pour
   `https://<machine>.<tailnet>.ts.net` — indispensable pour la PWA
   (service worker, ajout à l'écran d'accueil).

3. Sur le téléphone, ouvre `https://<machine>.<tailnet>.ts.net`.
   La vue mobile s'active automatiquement (largeur d'écran). Pour forcer un
   mode : `?mobile` ou `?desktop` dans l'URL (le choix est mémorisé).

4. **Ajoute à l'écran d'accueil** (menu partager sur iOS, menu ⋮ sur Android).
   L'app installée s'ouvre en plein écran, directement en vue mobile.

## Sécurité

Cette config tourne **sans authentification** : le périmètre de sécurité est le
tailnet. Seuls tes appareils Tailscale peuvent atteindre le serveur.

⚠️ N'utilise **pas** `tailscale funnel` (exposition à l'Internet public) sans
activer l'auth SSO de Fleex (`GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` +
`DATABASE_URL`).

## Ce que couvre la vue mobile

Navigation : une **barre flottante** (verre dépoli) en bas — Focus · Tasks · ✦
(Assistant) · Kanban · Plus. L'écran d'accueil est **Focus**. Les onglets
restent montés : un flux ou un scroll survit à un changement d'onglet.

- **Focus** (accueil) : la file « ce qui attend ton intervention » — gates,
  questions, erreurs, idle — avec les mêmes actions que le desktop
  (`focusActions()`), champ de réponse pour les questions, « Plus tard »
  (snooze par `FocusItem.key`), fenêtre d'annulation de 5 s (envoi immédiat si
  la page se ferme), section « Pendant ce temps… » et pastille sur l'onglet.
  Un tap ouvre le ticket sur **Workflow** (gate) ou **Conversation**, « Logs »
  ouvre **Runs**. « Ouvrir CLI » (terminal flottant) n'existe pas sur mobile.
- **Tasks** : la file Work du desktop (`useWorkQueue`, mêmes filtres :
  boards, priorité, statut, favoris, groupement) + recherche et création.
- **Kanban** : colonnes paginées par transform + swipe, sélecteur de board,
  création rapide de ticket, temps réel via WebSocket.
- **Ticket** (plein écran, barre masquée) : onglets Conversation · Contexte ·
  Deliverables · Runs · Workflow. Titre éditable, statut, favori ; Contexte =
  détails (priorité, type, tags, favori, bloqué, board, archivage, suppression),
  **repos liés**, description éditable.
- **Conversation** : autocomplete `@` (agents, panels, skills, workflows,
  tickets) pour lancer une session SDK, modes talk/plan/edit + overrides
  modèle/effort/fast, actions sur les mentions, deliverables liés.
- **Deliverables** : liste lu/non-lu, lecture plein écran, création, suppression.
- **Runs** : historique des exécutions, flux live, bouton stop.
- **Diff** (si le ticket a un repo lié) : le même diff de branche que le panneau desktop, fichiers repliés, filtre, rafraîchi toutes les 5 s.
- **Workflow** : étapes du run, human gates, questions d'agents, retry, annulation.
- **Assistant** : le centre de la barre ouvre l'assistant en **sheet** au-dessus
  de l'écran courant. Fermer la sheet ne le démonte pas : la conversation
  continue. Quand un ticket est ouvert, il est passé en contexte.
- **Plus** (sheet, grille 3 colonnes) : Notifications, Routines (activer,
  approuver une gate, lancer), Notes, Documents, Repositories, Settings (thème
  parmi les thèmes intégrés, persisté comme sur desktop) et bascule vers la vue
  desktop.

Mise en veille : au réveil, l'app rouvre l'écran où tu étais (onglet, ticket
ouvert et son onglet, page Plus), y compris si iOS l'a déchargée ; les
brouillons de commentaire sont gardés par ticket. Avec le serveur de dev
(Vite), le rechargement automatique au retour de veille est désactivé sur
mobile : Plus › Settings › « Recharger l'app » récupère le nouveau code.

Principe : **parité des actions métier** avec le desktop — seule l'UX
purement desktop (fenêtres flottantes, DAG, terminaux xterm, Monaco) n'est pas portée.

## Assistant LLM

L'Assistant (sheet du bouton ✦) parle au **companion** (`packages/sidepanel-host`) — le même
backend que l'extension Chrome : même prompt engine conscient de Fleex (outils
générés depuis le CLI, `fleex documentation` disponible comme outil), chaque
conversation est épinglée à un **workspace** (le companion injecte
`--workspace <nom>` dans chaque commande), et toute commande **mutante** exige
ton approbation explicite — la commande `fleex …` exacte est affichée avant
exécution.

Prérequis sur le laptop — un seul :

- Le companion tourne : `fleex companion status` (démarré automatiquement par
  `fleex start` ; sinon `fleex companion start`). Il lit `ANTHROPIC_API_KEY`
  dans `~/.fleex/config`.

C'est tout. Avec `fleex start` (qui lance toujours le dev server Vite), le
proxy `/companion/*` → companion (port 4399 par défaut, `FLEEX_SIDEPANEL_PORT`
sinon) est intégré — ton `tailscale serve` unique vers le port web couvre
l'app, l'API, les WebSockets **et** l'assistant. Aucun `--set-path` à ajouter.

<details>
<summary>Cas particulier : servir le build statique sans Vite</summary>

Si tu sers `web/dist` directement via le serveur Fastify (`bun run build`
puis `bun run start`, sans passer par `fleex start`), rien ne proxie
`/companion` — ajoute alors un mount de chemin au proxy Tailscale :

```bash
tailscale serve --bg --https=443 --set-path=/companion http://localhost:4399
```
</details>

## Dépannage

- **« Host not allowed » en dev** : le hostname `.ts.net` est autorisé dans
  `packages/web/vite.config.ts` (`allowedHosts`). Si tu passes par un autre
  domaine (reverse proxy custom), ajoute-le là.
- **Le HMR (rechargement dev) ne suit pas via HTTPS** : utilise le build de
  prod (`bun run build` puis `bun run start`) et pointe `tailscale serve` sur
  le port du serveur au lieu du port web.
- **La PWA ne propose pas l'installation** : vérifie que l'URL est bien en
  HTTPS (`tailscale serve`, pas l'IP `100.x.y.z` en HTTP).
