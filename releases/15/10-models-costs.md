---
title: "Haiku 5.5 arrive, et vos coûts sont enfin justes"
category: improvement
prs: [303, 296]
audience: [dev, pm]
order: 10
source: slack
captured_at: 2026-10-20
images:
  - src: assets/models-dark.webp
    light: assets/models-light.webp
    alt: "Le sélecteur de modèle du composer, avec Claude Haiku 5.5 dans la famille Haiku"
    caption: "Claude Haiku 5.5 dans le sélecteur de modèle"
---
Vous pouvez maintenant choisir Claude Haiku 5.5, et le coût affiché pour un run est celui de ce run, pas de toute la session.

*Claude Haiku 5.5* est supporté, avec l'échelle d'effort complète et son pricing. Tous les appels système (résumés, mémoire, import Slack, aide IA des actions) passent de Haiku 4.5 à 5.5, et le Claude Agent SDK passe en `0.3.293`. Depuis le CLI `2.1.284`, une session reprise renvoyait le total de toute la session : Fleex refacturait l'historique à chaque mention. Le coût d'un run est maintenant l'écart avec le run précédent, quand il est prouvable ; sinon il est marqué `unverified`. L'historique est corrigé : 6 247 $ → 4 595 $ sur les lignes concernées.
