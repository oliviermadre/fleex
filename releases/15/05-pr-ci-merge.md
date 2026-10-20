---
title: "Suivez la CI et mergez sans quitter Fleex"
category: feature
prs: [297]
audience: [dev, pm]
order: 5
source: slack
captured_at: 2026-10-20
---
Vous pouvez maintenant voir l'état de la CI d'une PR partout dans Fleex, et la merger d'ici.

Le chip de PR affiche `CI running`, `CI passed`, `CI failed`… sur la carte kanban, la sidebar, Tasks, Focus, le dashboard repo et la timeline. Son menu liste les checks (échecs en premier, chacun lié à son job) et propose le merge avec les méthodes autorisées par le repo. Le merge passe toujours par une confirmation (en rouge si la CI échoue) et utilise `--match-head-commit`. Une méthode indisponible est grisée avec sa raison : draft, conflits, branche en retard ou PR bloquée.
