---
title: "Les agents vous posent de vraies questions à boutons"
category: improvement
prs: [302]
audience: [dev, pm]
order: 4
source: slack
captured_at: 2026-10-20
---
Vous pouvez maintenant répondre à un agent d'un clic, sur des choix qu'il a vraiment proposés.

Les boutons « WAITING FOR YOUR CHOICE » étaient devinés par regex dans le markdown de l'agent : « (lot 5) » ou « (version 0) » devenaient des boutons absurdes. Les agents déclarent maintenant leurs choix fermés dans leur sortie structurée (`questions: [{ prompt, options[] }]`). Tasks affiche un groupe de boutons par question, Focus le fait quand il n'y a qu'une question.
