---
title: "La Timeline se lit et s'annote"
category: feature
prs: [314, 315, 317]
audience: [dev, pm]
order: 3
source: slack
captured_at: 2026-10-20
images:
  - src: assets/timeline-dark.webp
    light: assets/timeline-light.webp
    alt: "La Timeline d'un ticket terminé : durée de chaque phase, bloc Temps, période après Done hachurée et trois annotations épinglées"
    caption: "Durées par phase, lead time, et des annotations toujours visibles"
---
Vous pouvez maintenant voir combien de temps un ticket a passé dans chaque statut, et épingler une remarque sur n'importe quel instant de sa vie.

Chaque phase affiche un badge `durée · 👤 n` (commentaires, décisions de gate, arbitrages humains). Un bloc *Temps* donne `Avant 1er Doing`, `Lead time client` (ou `Âge` pour un ticket ouvert) et la répartition par statut. La vie du ticket s'arrête à son entrée en Done/Cancelled, et la période d'après est hachurée. Les *annotations* (titre, markdown ou capture) s'affichent comme des cartes, sans survol : `⌥+clic`, la touche `A` sur un picto, ou « Épingler sur la timeline » depuis un commentaire. Les agents les reçoivent dans leur contexte et peuvent en poser (`fleex ticket annotation add`, exposé en MCP).
