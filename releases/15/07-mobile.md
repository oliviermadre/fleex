---
title: "Fleex se pilote au pouce"
category: feature
prs: [295, 298, 294]
audience: [dev, pm]
order: 7
source: slack
captured_at: 2026-10-20
images:
  - src: assets/mobile-focus-dark.webp
    light: assets/mobile-focus-light.webp
    alt: "Focus sur mobile : la liste des tickets qui attendent une réponse, et la barre flottante Focus · Tasks · ✦ · Kanban · Plus"
    caption: "Focus en écran d'accueil, une barre flottante pour le reste"
---
Vous pouvez maintenant traiter vos tickets depuis votre téléphone : snoozer, répondre, passer au suivant.

Une barre flottante Focus · Tasks · ✦ · Kanban · Plus, avec Focus comme écran d'accueil. Focus mobile est une liste qu'on swipe : à gauche pour snoozer 1 h, à droite jusqu'à demain 9 h. Un tap ouvre une sheet plein écran, un swipe latéral passe à l'item suivant. Le détail ticket a ses onglets Conversation, Contexte, Deliverables, Runs et Workflow. Pour l'accès distant, `fleex tailscale serve | stop | status | check` remplace le `tailscale serve` tapé à la main.
