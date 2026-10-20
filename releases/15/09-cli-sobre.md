---
title: "Une CLI sobre en tokens et en disque"
category: under-the-hood
prs: [304, 305]
audience: [dev, pm]
order: 9
source: slack
captured_at: 2026-10-20
---
Vos agents ne s'étouffent plus sur une liste de tickets, et vos worktrees fermés ne mangent plus votre disque.

`fleex ticket list --json` pouvait renvoyer plus d'1M de tokens : il ne garde plus que 11 champs par ticket, avec `--limit` (50 par défaut) et les tickets done/cancelled masqués sauf `--all` (l'ancien format reste là avec `--json-full`). `fleex worktree cleanup` trouve et supprime les worktrees des tickets fermés — environ 490 tickets et ~209 Go sur la machine principale. Dry-run par défaut, suppression avec `--apply` ; un worktree avec des changements, des commits non poussés ou une PR ouverte est conservé, raison à l'appui.
