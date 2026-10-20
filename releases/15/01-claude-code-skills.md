---
title: "Vos skills Claude Code deviennent des skills Fleex"
category: feature
prs: [306]
audience: [dev, pm]
order: 1
source: slack
captured_at: 2026-10-20
images:
  - src: assets/cc-skills-dark.webp
    light: assets/cc-skills-light.webp
    alt: "Le composer d'un ticket : la liste @ propose les agents et les skills Claude Code, marqués CC"
    caption: "Tapez @ : vos SKILL.md sont là, avec leur badge CC"
---
Vous pouvez maintenant lancer depuis Fleex les skills que vous utilisez déjà dans Claude Code, sans rien recopier.

Fleex détecte les `SKILL.md` de la machine : skills utilisateur (`~/.claude/skills`), skills claude.ai synchronisés (`anthropic-skills:*`), plugins activés et `.claude/skills` des repos (lus sur `origin/<default>`). Ils apparaissent dans le SmartSessionButton avec un badge `CC`, se mentionnent en `@skill:cc-…` et sont listés par `fleex skill list`. Un run passe la main au tool `Skill` natif de Claude Code : sous-fichiers, scripts et progressive disclosure marchent comme dans la TUI. Re-scan depuis l'UI ou avec `fleex skill scan`.
