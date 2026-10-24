# demo/home — the fake home of the demo workspace

In demo mode (`FLEEX_DEMO_MODE=1`) the Claude Code skill scanner reads `demo/home/.claude`
instead of the real `~/.claude`, so screenshots show Atelier Nova's fictional skills and never
the ones of the machine that took them. `fleex demo reset` enables them all after seeding.
Add a skill: `demo/home/.claude/skills/<name>/SKILL.md`.
