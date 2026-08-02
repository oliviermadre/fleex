# Sécurité HTTP

Fleex expose des routes qui exécutent des commandes shell et ouvrent des PTY sur
ta machine. Ce document décrit ce qui empêche une page web tierce de les
atteindre.

**Rien de ce qui suit n'exige de configuration** — ni en local, ni pour le
parcours mobile Tailscale.

## Les cinq couches

| Couche | Effet |
|---|---|
| Bind loopback | Serveur, gateway et companion n'écoutent que sur `127.0.0.1` |
| Politique d'origine | CORS restreint aux origines légitimes |
| Garde `Sec-Fetch-Site` | Les mutations cross-site sont refusées en 403 |
| helmet + CSP | En-têtes de réponse durcis |
| Cookies | `SameSite=Strict` sur la session, `Secure` dès que HTTPS |

## 1. Bind loopback

Les trois services écoutent sur la boucle locale. Aucun n'est joignable depuis
le réseau par défaut.

Pour un accès distant, la voie supportée est Tailscale
(voir [mobile.md](./mobile.md)) — **pas** un bind sur `0.0.0.0`. Le gateway en
particulier expose `/exec`, `/fs` et `/pty` **sans authentification** : l'ouvrir
au réseau revient à donner un shell à quiconque l'atteint. Chaque service
affiche un avertissement au démarrage s'il est lié à autre chose que la boucle
locale.

> Les URL internes (CLI, healthchecks, proxy Vite) utilisent `127.0.0.1` et non
> `localhost` : sur macOS `localhost` peut résoudre `::1` en premier, ce qui
> ferait échouer la connexion vers un service lié en IPv4.

## 2. Politique d'origine

La règle principale est l'**égalité `Origin.host == Host`** : une requête est
légitime si l'origine qu'elle annonce correspond à l'hôte par lequel elle nous a
atteints.

C'est auto-configurant. Le navigateur du téléphone annonce
`Origin: https://mac.tail1234.ts.net` et le proxy Tailscale transmet
`Host: mac.tail1234.ts.net` → autorisé. Une page servie depuis
`evil.tailnet.ts.net` annonce sa propre origine, qui ne correspond pas au `Host`
de la victime → refusée.

Sont également acceptés :

- toute origine loopback (`localhost`, `127.0.0.1`, `[::1]`), quel que soit le
  port — c'est le serveur de dev Vite ;
- les origines listées dans `FLEEX_ALLOWED_ORIGINS`.

Une origine refusée ne reçoit **aucun** en-tête `Access-Control-Allow-*`, donc
le navigateur bloque la lecture de la réponse.

Deux pièges volontairement évités :

- **`*.ts.net` n'est pas allowlisté globalement** : n'importe qui peut obtenir un
  nom dans ce domaine.
- **`X-Forwarded-Host` n'est jamais consulté** : il est falsifiable et
  contournerait entièrement la règle d'égalité.

> **Si tu ajoutes un proxy devant Fleex**, il doit préserver le `Host` d'origine.
> C'est la raison pour laquelle `changeOrigin` est absent de la config proxy de
> Vite : il réécrit le `Host` en laissant l'`Origin` intact, ce qui casserait
> l'égalité.

## 3. Garde anti-CSRF

Toute requête mutante (`POST`, `PUT`, `PATCH`, `DELETE`) portant
`Sec-Fetch-Site: cross-site` reçoit un `403 { "error": "Cross-site request
blocked" }`.

On utilise `Sec-Fetch-Site` plutôt qu'un token CSRF : aucun état serveur, aucune
modification des clients (web, CLI, MCP, agents), et transparent derrière
n'importe quel proxy.

Ordre d'évaluation :

1. `OPTIONS` → autorisé (préflight, géré par CORS)
2. Upgrade WebSocket → autorisé **ssi** l'origine passe la politique ci-dessus
3. `Authorization: Bearer …` → autorisé (l'auth par token n'est pas ambiante)
4. `GET` / `HEAD` → autorisé (aucune route de lecture ne mute d'état)
5. `Sec-Fetch-Site` présent → `cross-site` refusé, sinon autorisé
6. Pas de `Sec-Fetch-Site` mais un `Origin` → politique d'origine
7. Ni l'un ni l'autre → autorisé (CLI, MCP, hooks Claude Code, agents SDK)

La règle 2 est celle qui ferme le *cross-site WebSocket hijacking* : un upgrade
est un `GET`, il échapperait sinon à la garde, et `/ws` donne accès aux PTY.

La règle 7 peut surprendre. Ces clients ne portent pas de credentials ambiants
(pas de cookie envoyé automatiquement par un navigateur), ils sont donc immunes
au CSRF par construction.

## 4. En-têtes de réponse

`@fastify/helmet` applique une CSP, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer` et `X-Frame-Options: DENY` sur le build servi par
Fastify.

- `frame-ancestors 'none'`, `object-src 'none'`, `script-src 'self'`
- `connect-src` dérive l'hôte WebSocket de la requête, donc le nom Tailscale
  fonctionne sans réglage
- **`upgrade-insecure-requests` est explicitement désactivé** : helmet l'ajoute
  par défaut et il transformerait tout `http://localhost` en `https://`
- HSTS est **désactivé** par défaut (le chemin nominal est `http://localhost`) —
  `FLEEX_ENABLE_HSTS=1` pour l'activer

Le serveur de dev Vite reçoit les en-têtes non-CSP uniquement : le HMR exige
`unsafe-eval` + `unsafe-inline`, une CSP y serait sans valeur.

## 5. Cookies

| Cookie | `SameSite` | `Secure` | Durée |
|---|---|---|---|
| `fleex_session` | `Strict` | si HTTPS | 30 jours |
| `fleex_oauth_state` | `Lax` | si HTTPS | 10 min |

`Secure` est **conditionnel** et non inconditionnel : Safari refuse les cookies
`Secure` sur `http://localhost`. La valeur est dérivée de `X-Forwarded-Proto`
(ou du protocole de la requête), avec un override `FLEEX_COOKIE_SECURE=1|0`.

Le cookie d'état OAuth reste en **`Lax`** délibérément. Le callback du provider
est une navigation top-level *cross-site* depuis `github.com` : en `Strict`, le
cookie ne serait pas envoyé, la vérification anti-replay échouerait, et le login
serait cassé.

> **Contrepartie de `Strict`** : un lien vers Fleex cliqué depuis un site tiers
> (Slack, mail) arrive sans cookie de session → première vue déconnectée,
> résolue au rechargement.

## Variables d'environnement

| Variable | Défaut | Effet |
|---|---|---|
| `FLEEX_HOST` | `127.0.0.1` | Bind du serveur Fastify |
| `GATEWAY_HOST` | `127.0.0.1` | Bind du host-gateway |
| `FLEEX_SIDEPANEL_HOST` | `127.0.0.1` | Bind du companion |
| `FLEEX_ALLOWED_ORIGINS` | *(vide)* | Origines exactes supplémentaires, séparées par des virgules |
| `FLEEX_COOKIE_SECURE` | *(auto)* | `1` force `Secure`, `0` le désactive |
| `FLEEX_ENABLE_HSTS` | *(off)* | `1` active HSTS |

## Limites connues

Ces points ne sont **pas** couverts et font l'objet de tickets dédiés :

1. **`/ws` n'est pas authentifié.** Le contrôle d'origine ferme le vecteur
   navigateur, mais un processus local atteignant le port a un accès PTY complet.
2. **Le host-gateway n'est pas authentifié.** `/exec`, `/fs`, `/pty` sont
   ouverts à tout processus local.
3. **`POST /api/exec` exécute un shell arbitraire** par conception, sans
   allowlist de commandes.
4. **Le companion n'est pas authentifié** — il pilote le CLI Fleex.
5. Pas de rotation d'identifiant de session à la connexion, pas d'expiration
   pour inactivité.
6. Pas de rate limiting.
