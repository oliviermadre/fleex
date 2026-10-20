---
title: "Un bouton par worktree pour lancer votre app"
category: feature
prs: [301]
audience: [dev, pm]
order: 2
source: slack
captured_at: 2026-10-20
---
Vous pouvez maintenant démarrer, ouvrir ou dépanner le dev server de chaque worktree d'un ticket en un clic.

La top bar de Tasks et le header du ticket ont un groupe *WORKTREES* : un bouton par worktree, qui fait ce que l'état du dev server demande (arrêté → Start, lancé → Open, en démarrage ou en erreur → Logs). Le `▾` ouvre un launcher avec toutes les commandes du repo, détectées dans `.claude/launch.json`, `package.json`, `Makefile` et `composer.json`. Le serveur tourne dans une session tmux qui survit à un redémarrage de Fleex. Nouvel écran `Settings › repo › Actions et Hooks` avec le cycle Overlay → Setup → Start → Stop·Status → Teardown. CLI : `fleex repo actions | run | pin | share | hooks`.
