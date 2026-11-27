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

Seconde maquette, [`workbench.html`](./workbench.html) (un seul fichier, données simulées ; c'est le contenu d'une page, à
envelopper d'un `<html><body>` pour l'ouvrir hors d'un visualiseur d'artifacts). Elle répond à une question : comment garder la
vue Work comme lieu de travail manuel quand les tickets sont dans la Factory. Version 3, après deux tours de retours.

- **Un poste est une machine.** Une plaque avec le pictogramme de sa nature, autant de cellules qu'il peut faire tourner de
  tickets à la fois, un bac « OUT » pour ce qui est fini et ne peut pas encore sortir, et une zone hachurée « SET ASIDE » pour ce
  qui est mis de côté : une question de l'agent, un run échoué, un ticket qu'on a arrêté. **Rien ne fait la queue dans un
  poste** : ce qui ne peut pas entrer attend sur le convoyeur en amont.
- **Le feu est l'interrupteur.** Rouge : le poste est éteint, ce qui arrive est retenu dans ses cellules sans démarrer (ce qui
  tournait finit). Vert : allumé. Jaune : allumé, et au moins un ticket y est mis de côté. Un clic l'allume ou l'éteint ; au
  survol il dit ce qui tourne, ce qui est mis de côté, ce qui attend sur le convoyeur et si la sortie est bloquée.
- **Un gate n'a ni interrupteur ni mise de côté** : c'est une étape humaine. Son feu est jaune tant qu'il reste quelque chose à
  décider. Ses issues ne sont pas écrites dessus : ce sont les bras, étiquetés, qui les portent.
- **« Needs you », en haut à gauche.** Comme les cadres d'un groupe dans un jeu : uniquement les tickets qui attendent une
  intervention, avec leur type, titre, priorité, complexité, le poste, ce qui est attendu et depuis quand.
- **Micro-chat au premier clic.** La fin du fil s'ouvre à côté du poste ; remonter charge la suite. Les derniers livrables sont
  en tête. Sur un gate, la décision se prend là : un bouton par issue et une raison facultative, gardée dans le fil.
- **La glissière.** `Espace`, `V` ou un double-clic font monter du bas la surface de la vue Work, sous la barre de titre de la
  fenêtre. `←` / `→` changent de ticket ; un sélecteur dit ce qu'elles parcourent (« Needs you » ou « Same station »).
- **Ce qui demande une décision est demandé dans le fil** : la décision d'un gate, un run échoué à relancer. Aucune bande
  « Factory » en haut de la vue Work : la Factory est un groupe du panneau Context, avec le seul geste qui se fait de là, mettre
  de côté et remettre (sortir par telle issue, refaire une itération, envoyer ailleurs).
- **Lancer à la main met de côté.** Un agent, un skill ou un panel lancé depuis un commentaire coupe le run du poste s'il
  tournait et range le ticket dans « SET ASIDE ». Sur un gate ou dans une zone rien ne tourne, donc rien ne bouge. Un workflow
  ne se lance pas sur un ticket en usine.

Ce que la maquette ne montre pas : le mode build, les calques et les réglages du HUD (dessinés, inertes), et les panneaux de
Work autres que Context, Diff, Docs et Todo. Le floor est une seule ligne, sans déplacement de caméra.

## Mobile : le poste de garde

Troisième maquette, [`mobile.html`](./mobile.html) (un seul fichier, données simulées, même enveloppe que `workbench.html`).
Elle répond à une question : que devient la Factory sur un téléphone. Elle ne rétrécit pas la page du bureau : elle garde ce
qui se fait en trois minutes sous un pouce, et laisse la construction au bureau.

- **Needs, l'accueil.** Une carte par ticket qui attend quelqu'un (la liste de `needs.ts`, la plus ancienne d'abord), le plan
  entier en bandeau au-dessus, et les issues d'un gate, les réponses fermées d'un agent ou « Run again » en boutons au-dessus
  de la barre. Chaque geste s'annule pendant cinq secondes.
- **Floor.** Le plan, lu plus que manipulé : un doigt déplace, deux doigts zooment ; de loin une station est sa couleur, son
  feu et un compte, de près ses places et ses tickets. « Next » emmène la vue au ticket suivant, toucher une machine ouvre sa
  feuille (console et popup réunis). « Lines » montre le même plan en liste.
- **Déplacer un ticket** ne se fait pas en glissant : « Send to… », les machines qui peuvent le prendre s'allument, un toucher
  choisit, un autre confirme.
- **✦** est la ligne « Entrée » du bureau, ses commandes slash en pastilles. **Pulse** donne ce qui s'est passé depuis la
  dernière visite, les limites, où ça bouche, et l'arrêt d'urgence tenu une seconde.

Trois choix restent à trancher sur la page (ce qu'on voit en ouvrant, ce que fait un balayage sur une carte, où vit la
Factory dans l'app mobile) ; ils changent le téléphone de la maquette. Ce qu'elle ne montre pas : le mode build, les réglages
complets d'une station, le paysage, les notifications.
