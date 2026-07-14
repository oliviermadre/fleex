# Fleex — Stratégie d'adoption & onboarding

> **Statut :** draft v1 — compagnon de [positioning.md](positioning.md).
> **Problème traité :** « les gens aiment le concept mais ne veulent pas l'essayer. »

---

## 1. Diagnostic : ce n'est pas un problème de produit, c'est un problème d'étage

Fleex vend l'**étage 3** d'une échelle de maturité que les utilisateurs gravissent un barreau à la fois :

```
Étage 0   Une session Claude à la fois          ← la majorité des devs aujourd'hui
Étage 1   Sessions parallèles (worktrees)       ← ce que vendent Conductor/Orca/Emdash
Étage 2   Besoin de project management          ← émerge À L'USAGE de l'étage 1
Étage 3   Besoin d'historiser la connaissance   ← émerge à l'usage de l'étage 2 (et même avant)
```

On ne peut pas *convaincre* quelqu'un d'étage 0–1 qu'il a un problème d'étage 2–3 : ce besoin se **ressent**, il ne s'explique pas (tu l'as vécu toi-même : tu as commencé session-first). D'où les objections entendues — elles sont toutes de la forme *« je peux répliquer cette feature avec un script »* :

| Objection | Ce qu'elle révèle |
|---|---|
| « le contexte ? je peux faire un hook git/claude » | Il évalue la *feature*, pas le *système*. Il n'a pas encore souffert du contexte évaporé. |
| « les costs ? `bun ccusage` » | Idem — il n'a jamais eu à répondre à « combien a coûté ce ticket ? » |
| « multi-repo ? `/add-files` » | Il pense en *session* (ajouter des fichiers à un contexte), pas en *travail* (un ticket, 2 PRs). |

**Ne jamais gagner cet argument verbalement.** Chaque feature de Fleex est individuellement réplicable par un script — la valeur est dans l'intégration (le hook alimente le ticket, qui porte les coûts, qui traversent les repos). Un système intégré ne se démontre que de deux façons : en le **montrant déjà rempli**, ou en le faisant **vivre sans effort**.

Deuxième friction, indépendante : le **coût d'essai**. Aujourd'hui, essayer Fleex = `curl | bash` + git/bun/tmux/claude/gh + wizard + repo cloné dans `~/.fleex` + une app desktop qu'on lance… depuis un CLI. Pour la cible early-adopter HN c'est acceptable ; pour tous les autres c'est un mur avant même le premier écran.

---

## 2. Le reframe stratégique

> **Vendre l'étage 3, onboarder à l'étage 1.**

Le positionnement ne change pas (« Orchestrez du travail, pas des terminaux » reste la destination). Ce qui change : **le premier contact avec le produit doit ressembler à ce que l'utilisateur sait déjà faire** — des sessions parallèles, comme Conductor/Orca — et l'échelle doit se gravir *dans* le produit, par des nudges au bon moment, pas dans le pitch.

Corollaire : Fleex doit pouvoir s'installer **à côté** du workflow existant, pas à la place. La stratégie du cheval de Troie : une surface d'entrée minuscule (wrapper de session), une valeur qui s'accumule en silence (la GED), et le jour où l'utilisateur en a besoin, elle est déjà là.

---

## 3. Next steps priorisés

### P0 — Réduire le coût d'essai à ~zéro *(le mur avant l'écran)*

1. **Packager la vraie app desktop.** `packages/desktop` est un Electron nu (`electron .`, lancé par le CLI). Ajouter `electron-builder` : `.dmg` signé/notarisé macOS, `.AppImage`/`.deb` Linux, publiés en GitHub Releases + **Homebrew cask** (`brew install --cask fleex`). L'app embarque ou bootstrappe le stack (bun runtime inclus dans le bundle) ; le CLI devient le chemin power-user, pas le chemin d'entrée. *Openclaw & co font pareil — ce n'est pas un standard à imiter, c'est le plafond de verre de leur adoption.*
2. **Premier lancement zéro-config.** Le wizard devient optionnel : défauts silencieux (SQLite, chemin worktree standard, 3 personas seedés). Détection de `claude`/`gh`/`tmux` avec proposition d'installation *dans* l'app, pas en prérequis bloquant. Rendre **tmux optionnel** : les sessions SDK n'en ont pas besoin, seuls les terminaux CLI en dépendent — ne pas faire payer à tout le monde la dépendance du mode expert.
3. **Seeder un ticket de démonstration terminé.** Un ticket pré-rempli : discussion multi-agents (@mentions), un deliverable, un summary de session, des coûts ventilés, deux repos. **La GED ne s'explique pas, elle se visite.** C'est la réponse muette à « je peux faire un hook » : voilà à quoi ressemble le résultat, tu n'as rien eu à câbler.

**Métrique P0 : time-to-first-screen < 3 minutes, sans terminal.**

### P1 — Onboarder à l'étage où sont les gens *(le produit gravit l'échelle avec eux)*

4. **Mode « sessions d'abord » au premier lancement.** La première vue = la grille de sessions parallèles (ce que l'utilisateur vient chercher, ce que font les concurrents). Kanban, primitives, GED se révèlent par *progressive disclosure*. Fleex étage 1 doit être **au moins aussi bon que Conductor** sur le terrain de Conductor — sinon l'utilisateur ne reste pas assez longtemps pour découvrir les étages suivants.
5. **Des nudges au moment où le besoin naît**, pas avant :
   - fin de session → toast « Summary sauvegardé → *voir* » *(étage 3 ressenti dès l'étage 0 : c'est déjà câblé, zéro hook à écrire)* ;
   - 3 sessions parallèles sur des sujets liés → « Regrouper en ticket ? » *(étage 2)* ;
   - 2 repos touchés pour la même tâche → « Ce ticket peut porter les deux worktrees » *(étage 2→3)* ;
   - fin de semaine → « Vos sessions ont coûté X$, ventilé par ticket » *(le `ccusage` intégré, sans rien lancer)*.
6. **Le cheval de Troie : `fleex claude` (wrapper) + adoption des sessions tmux existantes.** Une commande qui lance `claude` exactement comme d'habitude, mais enregistre la session et pousse le summary dans la GED. L'utilisateur ne change **rien** à son workflow ; Fleex accumule de la valeur en arrière-plan. Deux semaines plus tard, sa GED est pleine — l'argument « je peux faire un hook » est mort, le hook tournait déjà.
7. **Checklist interactive de premier lancement** (4 étapes, dans l'app) : connecter un repo → lancer une session → la promouvoir en ticket → voir le summary tomber dans le ticket. **Aha-moment cible : < 10 minutes.**

**Métrique d'activation : 1 ticket avec ≥ 1 deliverable + 1 summary dans les premières 24 h.** (Telemetry locale opt-in — cohérent avec le local-first.)

### P2 — Programme & contenu *(traiter les objections en public)*

8. **Page « Oui, vous pourriez le faire vous-même. »** Concéder chaque DIY frontalement — le hook, `ccusage`, `/add-files` — puis montrer la facture d'assemblage : 3 scripts, 0 lien entre eux, 0 historique, 0 export. Se conclut par : *« Fleex, c'est ces hooks-là, déjà écrits, déjà câblés au ticket. »* Ton : respectueux du bricoleur (c'est la cible), jamais condescendant.
9. **4 vidéos de 60 s**, une par objection/étage : sessions parallèles (étage 1, terrain concurrent), session → summary automatique, un ticket / deux repos / deux PRs, coûts par ticket. La landing en montre une par pilier.
10. **Playbooks/recipes** dans la doc : « paralléliser 3 bugfixes », « un ticket cross-repo front+back », « monter un panel de review ». Chaque playbook = un chemin de montée d'étage.
11. **Programme d'onboarding accompagné** pour les 10–20 premiers utilisateurs (tes testeurs actuels) : session d'install de 30 min, un cas réel à eux, suivi à J+7. Objectif double : les convertir *et* instrumenter précisément où ça décroche — chaque décrochage devient un item P0/P1.

---

## 4. Ce que ça change au positionnement (amendement, pas révision)

- La landing garde la destination (« Orchestrez du travail, pas des terminaux ») mais ajoute une section **« Commencez où vous êtes »** : l'échelle en 4 barreaux, Fleex utile dès le barreau 1.
- Le tableau concurrentiel du positioning (§2) reste vrai, mais le message d'entrée de gamme devient : *« Tout ce que fait votre session-manager. Et il n'oublie rien. »* — on ne demande plus au prospect de changer de paradigme pour essayer.
- L'objection-handling du positioning (§7) se double d'une règle produit : **chaque objection DIY doit avoir une réponse *dans le produit* (un défaut câblé, une démo seedée), pas seulement dans le discours.**

---

## 5. Séquencement suggéré

| Semaine | Livrable |
|---|---|
| S1–S2 | P0.1 packaging desktop (dmg/AppImage + cask) · P0.2 zéro-config · tmux optionnel |
| S2 | P0.3 ticket de démo seedé |
| S3–S4 | P1.4 mode sessions-d'abord · P1.7 checklist premier lancement |
| S4–S5 | P1.6 `fleex claude` wrapper + adoption tmux · P1.5 nudges (summary d'abord, le reste ensuite) |
| S5–S6 | P2.8 page DIY · P2.9 vidéos · P2.11 cohorte accompagnée (démarre dès que P0 est shippé) |

Le critère de « done » global : **une personne qui n'a jamais parallélisé de sessions installe Fleex sans terminal, voit un ticket de démo rempli, lance sa première session, et reçoit son premier summary — en moins de 10 minutes.**
