# Claude Code skills in Fleex

Fleex picks up the Claude Code skills (`SKILL.md`) of the machine it runs on and
exposes them as Fleex skills: in the SmartSessionButton (with a `CC` badge), in the
`@skill:` autocomplete, and in `fleex skill list`. Nothing is rewritten: a run asks
Claude Code's native `Skill` tool to load the skill, so its sub-files, scripts and
progressive disclosure work as in the TUI.

## Sources

| Origin    | Where                                                                 | Mention                          |
|-----------|-----------------------------------------------------------------------|----------------------------------|
| `user`    | `~/.claude/skills/<dir>/SKILL.md` (symlinks followed, dot dirs ignored) | `@skill:cc-<name>`               |
| `synced`  | `~/.claude/skills/synced/<id>/<dir>/SKILL.md` (claude.ai)             | `@skill:cc-anthropic-skills--<name>` |
| `plugin`  | `installed_plugins.json`, **user** scope, enabled in `settings.json`  | `@skill:cc-<plugin>--<name>`     |
| `project` | `.claude/skills/<dir>/SKILL.md` on the default branch of each bare clone | `@skill:cc-<name>`             |

- The plugin cache is never walked blindly (it keeps stale versions): only the
  `installPath` of enabled user-scope installs is read. Project-scope plugin installs are not supported.
- A file reached through several symlinks is listed once.
- A `project` skill is only offered and resolved on tickets linked to its repo. When
  a `user` and a `project` skill share a name, the project one wins on those tickets
  (same rule as Claude Code).

## Naming

`command_name = 'cc-' + lowercase(native_name)`, with `:` and `/` turned into `--`
and any other character outside `[a-z0-9_-]` into `-` (mentions only parse that
charset). Names that collide after normalization get `-2`, `-3`… and keep them.
The `cc-` prefix is **reserved**: a native Fleex skill cannot use it (HTTP 400).

## Activation & persona

- Every discovered skill arrives **disabled**. Enable it in *Agents › Skills ›
  Skills Claude Code détectés* (bulk or one by one).
- It runs as the system persona **Claude Code** (seeded by migration 036; it can be
  edited but neither deleted nor renamed). A per-skill persona override is kept
  across scans; deleting that persona falls back to Claude Code.
- If an enabled skill's `SKILL.md` changes, it stays enabled and is flagged
  "modifié depuis l'activation" until re-validated.
- A skill gone from disk becomes `missing` (not runnable, settings kept); an
  unparsable one is `invalid`; one whose name a legacy native `cc-*` skill already
  owns is `conflict`.

## One machine, one list

Rows are stored per `host_id = FLEEX_INSTANCE_ID ?? hostname()`. Several Fleex
servers sharing a database each only see, list and run their own machine's skills.
`@skill:cc-…` runs on the server where the comment was posted.

## Scanning

At server start, from the admin modal (*Re-scanner*), or with `fleex skill scan`.
There is no file watcher.

## CLI

```
fleex skill list                          # native + enabled Claude Code skills, ORIGIN column
fleex skill list --origin cc              # Claude Code skills only (cc:user|project|plugin|synced)
fleex skill list --all --origin cc:plugin # include disabled / missing / invalid
fleex skill scan                          # re-scan and report added / changed / missing
```

## API

- `GET /api/skills?include=claude_code` — native skills + runnable Claude Code
  skills of this host (`source: 'claude_code'`). Without the flag the endpoint is
  unchanged (native only), so export/import and editors never see mirrored skills.
- `GET /api/claude-code-skills` · `POST /api/claude-code-skills/scan` ·
  `PATCH /api/claude-code-skills/:id` (`enabled`, `personaId`, `revalidate`) ·
  `POST /api/claude-code-skills/bulk` · `GET /api/claude-code-skills/:id/content`
- `POST /api/skills/:id/execute` also accepts a Claude Code skill id.
