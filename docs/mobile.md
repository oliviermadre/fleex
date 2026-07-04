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

## Ce que couvre la vue mobile (v1)

- **Kanban** : swipe entre les colonnes, sélecteur de board, création rapide de
  ticket, temps réel via WebSocket.
- **Ticket** : description (markdown), changement de statut, conversation avec
  `@agent:nom` pour lancer une session SDK (modes talk/plan/edit, gestion des
  mentions en conflit comme sur desktop).
- **Runs** : historique des exécutions du ticket, flux d'événements live
  (thinking, tool calls, résultat), bouton stop.

## Dépannage

- **« Host not allowed » en dev** : le hostname `.ts.net` est autorisé dans
  `packages/web/vite.config.ts` (`allowedHosts`). Si tu passes par un autre
  domaine (reverse proxy custom), ajoute-le là.
- **Le HMR (rechargement dev) ne suit pas via HTTPS** : utilise le build de
  prod (`bun run build` puis `bun run start`) et pointe `tailscale serve` sur
  le port du serveur au lieu du port web.
- **La PWA ne propose pas l'installation** : vérifie que l'URL est bien en
  HTTPS (`tailscale serve`, pas l'IP `100.x.y.z` en HTTP).
