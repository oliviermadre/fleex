# Factory

Maquette interactive d'une vue « usine » pour Fleex : le flux de tickets, de l'intake au done, vu comme un atelier que l'on
pilote et que l'on aménage soi-même. Ouvrir [`prototype.html`](./prototype.html) dans un navigateur. Toutes les données sont
simulées ; rien n'est branché sur un serveur Fleex.

Le but : voir d'un coup d'œil où sont les tickets, ce qui attend quelqu'un, ce que coûte chaque poste, et transformer les gestes
manuels répétés en postes.

## Principe

La Factory est un modèle à part, pas une autre vue des `WorkflowTemplate`. Le plan est une grille de cases, et **rien n'est routé
d'avance** : un ticket avance selon ce sur quoi il se trouve. Le déplacer à la main, ou réaménager le plan pendant qu'il tourne,
change donc son chemin tout de suite.

| Machine | Rôle | Dans Fleex |
|---|---|---|
| Convoyeur (1 case) | Porte un ticket et le pousse vers la case qu'il vise, si elle est libre. Sinon le ticket attend, et ceux de derrière avec lui. | Rien : c'est du transport. |
| Bras (1 case) | Prend sur la case derrière lui, dépose sur la case devant. Avec un filtre (type, priorité, issue), il ne prend que ce qui correspond ; sans filtre, il prend ce que ses voisins filtrés laissent. | Les arêtes conditionnelles d'un workflow. |
| Poste (3×3) | Fait tourner une étape `agent`, `skill` ou `panel`, puis range le ticket dans son bac de sortie avec l'issue du run. | `WorkflowStep` et son `StepRun`. |
| Gate (3×3, rayée) | Attend une décision humaine. Chaque issue sort par son propre bras. | Étape `human_gate`. |
| Statut (2×2, vert) | Pose un statut sur le ticket. | Étape `native` (Set status). |
| Zone | Les tickets y attendent. On peut les commenter, leur lancer un agent ou une skill par une mention, et ils n'en sortent qu'une fois libérés, à la main ou automatiquement. | Les statuts : `backlog`, `todo`, `doing`, `reviewing`. |
| Intake (2×2) | Source de tickets. Il les range dans son bac de sortie ; un bras les emmène, comme pour un poste. | Sources (Gmail, Slack, GitHub…). |
| Sortie | Passe le ticket en done et le retire du plan. | Statut `done`. |
| Slots agents | `agentMaxConcurrency` : la seule file d'attente côté agents, commune à tout. | `SdkConcurrencyLimiter`. |

Il n'y a qu'une sorte de zone. Backlog, Todo, Établi et Finition ne diffèrent que par leurs réglages : le statut posé à l'entrée
et le mode de sortie. La simulation fait arriver dans une zone `doing` ou `reviewing` des tickets qui ont encore des gestes à faire
(correction, QA, mise en prod) ; dans une zone `backlog` ou `todo`, ils n'attendent que d'être libérés.

Un poste a une capacité. Plein, il ne prend plus rien : le bras ou le convoyeur qui l'alimente s'arrête, et la file remonte.
Un ticket terminé que personne ne vient chercher reste dans le bac de sortie (lampe orange, carte « Sortie bloquée »).

### Entrées et sorties d'un poste

- **Entrées** : tout convoyeur qui aboutit sur le poste, tout bras pointé dessus.
- **Sorties** : uniquement des bras posés contre lui (c'est aussi vrai d'un intake et d'une zone). Un bras filtré sur l'issue `reject` sort les `reject`, un bras sans filtre
  sort le reste. Une gate à quatre issues a donc jusqu'à quatre bras.
- Sélectionner un poste entoure ses entrées en vert et ses sorties en orange ; l'Inspecteur liste chaque issue avec sa destination,
  ou « aucun bras » si rien ne la prend.

### Factory et Fleex classique, en parallèle

- Un ticket porte un flag **transféré à la Factory**. Chaque intake a son interrupteur : coupé, ses tickets restent dans Fleex
  classique et n'apparaissent pas sur le plan.
- Un ticket peut être rendu à Fleex classique, ou transféré plus tard (onglet Inspecteur, liste « Dans Fleex classique »).
- Pour un ticket transféré, **chaque poste traversé est enregistré comme un run** : c'est le « fil du ticket » affiché dans son
  inspecteur, tel que Tasks et Focus le verraient. Un bandeau « Managé par la Factory » signale que son cycle de vie se joue ici
  et qu'il ne faut pas y toucher ailleurs.

### L'interface

Une console en bas, comme dans un jeu de stratégie, et une barre latérale à droite.

- La console occupe toute la largeur ; la barre latérale s'arrête au-dessus.
- **Mini-carte** à gauche, avec les calques (débit, coût, temps, attente humaine) et le zoom.
- **Sélection** au centre : ce qui est sélectionné, ses chiffres clés et les tickets qu'il contient ; au-dessus, les groupes `1`…`6`.
- **Commandes** à droite : une grille de boutons propre à la sélection, chacun avec sa touche. Sans sélection : Construire (`B`),
  Banc d'essai (`T`), Production (`P`), Calque (`O`), Opérateur (`U`), Tout voir (`F`). Sur un ticket : les issues d'une gate
  (`Q` `W` `E` `R`), Suivre, Épingler, Rendre à Fleex. Sur une machine : Ouvrir (`V`), ses réglages rapides, Retirer.
- **Barre latérale** : Goulots, Focus, Objectifs, et l'Inspecteur avec tous les réglages de l'élément sélectionné.
- **Ouvrir** (`V`, ou double-clic) affiche le détail en grand. Pour un poste : ce qui attend un humain, ce qui tourne, ce qui
  attend un slot et le bac de sortie, plus ses derniers passages. Pour une zone : tous ses tickets, filtrables par type, avec
  leur état, leurs gestes et leurs actions. Pour un ticket : son fil de discussion (réponses des agents, questions, décisions
  de gate, mentions, commentaires), une zone de commentaire, la répartition de son temps, ses détails et sa timeline.

### Piloter

- Tout se clique : ticket, case de convoyeur, bras, poste, zone, intake, slots.
- Cliquer un ticket affiche dans la barre latérale sa discussion, sa timeline et ses détails. Dans une zone, on peut lui lancer
  `@agent:builder`, `@skill:deploy` ou `@skill:maintenance` sans qu'il la quitte.
- **Glisser un ticket** le déplace : sur un poste, dans une zone, sur une case de convoyeur (son nouveau chemin se trace pendant
  le geste), ou au sol. Un run en cours est interrompu et noté dans le fil.
- Un ticket sélectionné affiche ses actions à côté de lui (issues d'une gate, lancer, relancer un geste) et son chemin si rien ne change.
- `Maj`+clic sélectionne plusieurs tickets. `Maj`+`1`…`6` enregistre la sélection, `1`…`6` la rappelle.
- Personne ne se déplace sur le plan. Un opérateur simulé clique à votre place pour que la maquette tourne seule ; un pointeur
  blanc montre ce qu'il traite.
- Un run n'a pas de progression connue : un poste montre qu'un run tourne et depuis quand, jamais une jauge.

### Éditer

Commande **Construire** (`B`) : la grille de commandes devient le menu de construction, une touche par machine. `Échap` lâche
l'outil, puis quitte la construction. La simulation continue pendant ce temps.

- **Convoyeur** : glisser pour tracer ; chaque case prend la direction du geste. Repasser sur une case la réoriente.
- **Bras** : un clic ; `R` change le sens. **Agent, Skill, Panel, Gate, Statut, Zone, Intake, Sortie, Étiquette** : un clic.
  Une machine posée sur des cases de convoyeur les remplace, ce qui permet d'insérer un poste sur un chemin existant.
- Sans outil en main : cliquer une machine la sélectionne, la glisser la déplace ; `Suppr` ou la **Gomme** la retire (les tickets qu'elle contenait sont posés au sol).
- **Importer** (`W`) pose une ligne entière, traduite en postes, bras et convoyeurs. Il reste à relier son entrée et sa sortie.
- Chaque machine se règle dans l'Inspecteur : nom, exécuteur, persona ou skill, modèle, capacité, issues (nom, fréquence simulée),
  politique d'une gate, filtre d'un bras, statut, mode de sortie et taille d'une zone, débit et transfert d'un intake.
- `Ctrl`+`Z` annule, **Réinitialiser** revient au plan de départ. Le plan est gardé dans le navigateur (`localStorage`).

### Le plan de départ

Trois workflows réels, importés tels quels :

- `product-ideation` : Specification → Artifact → Human Gate, avec `redo-artifact-only`, `redo-spec-only` (qui passe par
  « spec to gate » avant de revenir à la gate) et `redo-all`.
- `spec-dev-qa` : set doing → Spec → Artifact → Check Spec → Build → review → Review, avec `reject`, `dangerous-fix-first`
  (par « set doing again ») et `dangerous-need-respecification`.
- `spec-dev-pr-autonomous` : Spec → Dev → Ticket Actions → Review, avec les deux mêmes retours de review.

Autour : un bras vide chaque intake sur un collecteur qui mène au Tri ; un bras filtré « urgent · high » alimente le Todo, le reste va au
Backlog. À la sortie du Todo, un convoyeur monte le long des lignes ; devant chacune, un bras filtré par type prélève ce qui lui
revient, et ce qu'aucun bras ne prend finit sur l'Établi. Ideation alimente Spec Dev PR (HITL) pour les tickets `lead`. Les lignes
de dev débouchent sur la Finition (QA manuelle, mise en prod), puis la Sortie.

### La boucle de jeu

Faire à la main, repérer ce qui se répète, en faire un poste. L'onglet Goulots compte les `@skill:deploy` lancés depuis la Finition
et propose de poser un poste Deploy sur le chemin : les tickets qui l'ont traversé n'ont plus ce geste à faire.

## Ce qu'on peut faire

- **Goulots** : sorties bloquées, gestes à automatiser, todo qui s'allonge, gates et zones en attente, capacité, coût.
- **Focus** : gates, questions, erreurs, et les tickets d'une zone de travail où plus rien ne tourne.
- **Inspecteur** : réglages et état de l'élément sélectionné ; sans sélection, vue d'ensemble et tickets restés dans Fleex classique.
- **Calques** (`O`) : passages par case de convoyeur, coût, temps, attente humaine.
- **Production** (`P`) : entrées et sorties, dépense par poste, tableau par poste.
- **Banc d'essai** : incident prod, réunion, gros PRD, panne API. **Visite guidée** depuis le bouton `?`.

Raccourcis généraux : `Espace` pause, `+` `−` vitesse, `Ctrl`+`Z` annuler, `Échap` revenir en arrière. Les autres touches sont
celles affichées sur les boutons de la grille de commandes.

## Hypothèses de la simulation

Tout est dans `src/sim.js`, sans dépendance au DOM.

- 1 s réelle = 2 min simulées à vitesse 1×. Démarrage un mardi à 10 h 15, après 34 h simulées à blanc et un backlog pré-rempli.
- Durées, coûts, taux de défaut et fréquence des issues : valeurs plausibles, pas des mesures. Le coût de Fable 5.2 est une supposition.
- Le temps passé sur un convoyeur ou dans un bras est une animation de quelques secondes, pas un délai réel.
- Politiques de gate `échantillonné` et `automatique`, sortie automatique d'une zone, capacité d'un poste : des propositions.
- Les réponses des agents dans le fil d'un ticket sont des phrases types, devinées d'après le nom du poste.
- Opérateur simulé : 9:00–12:30 et 13:30–18:30. Questions et erreurs d'abord, puis garnir le todo, lancer un ticket si l'en-cours
  est sous la limite, puis ce qui attend depuis le plus longtemps.
- Sur le plan de départ, tout ticket passe par une zone de travail (Établi ou Finition) : aucun ne sort sans intervention tant que le plan n'a pas été modifié.

## Ce que ça demanderait côté Fleex

| Besoin | Piste |
|---|---|
| Flag « transféré » | Un booléen sur `Ticket`, posé par source ou à la main. Les workflows et mentions classiques l'ignorent ou le refusent. |
| Plan de la Factory | Un nouveau modèle (machines, positions, réglages), indépendant de `WorkflowTemplate`. L'import d'un template est une traduction à sens unique. |
| Runs par poste | Chaque passage à un poste crée une exécution rattachée au ticket (`AgentExecution`), pour que Tasks et Focus affichent le fil sans rien savoir du plan. |
| Gates et questions | Restent des éléments Focus (`gate`, `question`, `error`, `idle`) ; l'issue choisie est posée sur le ticket, le bras fait le reste. |
| Moteur | Un tick serveur qui fait avancer convoyeurs et bras. La position d'un ticket (machine, case) devient un état persistant. |

Questions ouvertes : que devient un ticket posé au sol ou dans un cul-de-sac quand personne ne regarde ; faut-il versionner le plan
pour comparer avant et après un aménagement ; comment afficher un plan de plusieurs centaines de tickets.

## Fichiers

- `prototype.html` : la maquette, un seul fichier autonome. Ne pas l'éditer à la main.
- `src/sim.js` (simulation), `src/render.js` (canvas), `src/ui.js` (HUD, panneaux, éditeur), `src/style.css`, `src/body.html`.
- `./build.sh` assemble `prototype.html` à partir de `src/`.

Comme les autres prototypes, c'est une intention visuelle : pour l'intégrer à `packages/web`, reprendre les primitives existantes
(`toast()`, `Modal`, tints) au lieu de copier le balisage (voir `packages/web/CLAUDE.md`).

## Établi : opérer un ticket à la main sans quitter l'usine

Seconde maquette, [`workbench.html`](./workbench.html) (un seul fichier, données simulées, à ouvrir dans un navigateur après
l'avoir enveloppé d'un `<html><body>` ou tel quel dans un visualiseur d'artifacts). Elle répond à une question : comment garder la
vue Work comme lieu de travail manuel quand les tickets sont dans la Factory.

- **L'établi.** Ouvrir un ticket depuis le floor pose dessus la surface de la vue Work (modes Chat / Shell / Code, fil, composer,
  panneau de droite, bande d'outils), pas une fiche allégée. `J` / `K` passent d'un ticket qui attend quelqu'un au suivant.
- **La bande de ligne.** En haut de l'établi, dans la Factory comme dans Work, à la place du bandeau « Managed by the Factory » :
  où est le ticket sur sa ligne, ce qu'il attend, et les gestes (décider un gate, relancer, prendre en main, remettre).
- **Le débrayage.** Lancer un agent, un skill ou un panel à la main, ou « Take in hand », sort le ticket de la ligne : les machines
  n'y touchent plus. Un commentaire, le shell, le diff, le browser ne débrayent rien. « Put back » le remet : comme si le poste
  avait produit telle issue (fait à la main), au même poste pour qu'il reprenne, ou ailleurs. Un poste qui tourne sur le ticket
  doit être interrompu d'abord : un seul pilote à la fois.
- **Répondre relance.** Répondre à la question d'un agent relance le poste, sans second geste.
- **Du geste au poste.** Les runs lancés à la main sont comptés par poste (« By hand this week »). Cinq fois le même skill au même
  endroit, et la Factory propose le poste, posé comme un collage.

Ce que la maquette ne montre pas : le mode build, la carte de commandes, la minimap (inchangés), et les panneaux de Work autres
que Context, Diff, Docs et Todo.
