---
title: "Un navigateur par ticket, avec sélecteur d'élément"
category: feature
prs: [300]
audience: [dev, pm]
order: 6
source: slack
captured_at: 2026-10-20
---
Vous pouvez maintenant montrer à l'agent l'élément exact de la page dont vous parlez (app desktop).

Un panneau *Browser* dans l'app Electron, avec des onglets mémorisés par ticket. Le sélecteur d'élément récupère le sélecteur CSS, le XPath, les styles, le HTML, le composant React avec son `file:line` et une capture. Chaque élément choisi devient un chip dans le composer et arrive chez l'agent sous forme de bloc `fleex-element`.
