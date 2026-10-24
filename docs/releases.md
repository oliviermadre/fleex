# Illustrated release notes

Every feature that ships gets a catchy title, one sentence about what it changes for the user, and **real screenshots of the app**. An agent takes those screenshots in a demo environment that always looks presentable. Fleex then shows them on its **Nouveautés** page (`/releases`), and the same files feed Slack and fleex.dev.

The idea is to **capture during the PR and publish at release time**. When the feature lands, the PR drops a *fragment* (one Markdown file plus its screenshots) into `releases/unreleased/`. Shipping a release just moves those fragments into `releases/<N>/` and adds a header.

## The pieces

| Piece | What it is |
|---|---|
| `demo` workspace | Throwaway SQLite with one DB per instance, like `qa`, plus `FLEEX_DEMO_MODE=1` |
| `demo/seed/*.yaml` | « Atelier Nova »: a fictional company with boards, epics, tickets, comments, deliverables and finished workflow runs. Every date is relative (`-3d`, `-2h`) |
| `demo/scenarios/<name>.yaml` | Patch on top of the seed that stages one feature |
| `fleex demo reset` | Stops the demo instance, deletes its SQLite file, starts it again and replays seed + scenario through `POST /api/demo/seed` (404 outside demo mode) |
| `demo/shots/<name>.yaml` | Shot list: which URL, what to wait for and do, what to crop |
| `fleex shoot` | Headless Chromium (Playwright) → WebP @2x, dark and light |
| `releases/` | Fragments and published releases, validated by `fleex release validate` |
| `fleex file upload` | Attach a screenshot to a Fleex deliverable (`![](/api/files/<id>)`) |
| `/releases` page | Release history in the app, with a « Nouveau » badge until you open it |

## End to end (agent)

Always from your worktree root, always with the worktree's CLI and `--workspace demo`. The same rules as `qa` apply (see `CLAUDE.md`).

```bash
bun packages/cli/index.ts start --workspace demo
bun packages/cli/index.ts demo reset --scenario <name> --workspace demo
bun packages/cli/index.ts shoot demo/shots/<name>.yaml --workspace demo
# look at the images, fix the shot list, shoot again (max 2 retries)
bun packages/cli/index.ts release validate
bun packages/cli/index.ts stop --workspace demo && bun packages/cli/index.ts remove --workspace demo
find ~/.fleex/demo -maxdepth 1 -name 'demo@<branch-slug>.db*' -delete
```

If Chromium is missing: `bunx playwright install chromium`.

## The `demo` workspace

It mirrors `qa`, plus `FLEEX_DEMO_MODE=1`. To add it to `~/.fleex/workspaces.json` (once per machine):

```bash
jq '.workspaces += [{
  "name": "demo", "is_default": false, "basePath": "~/.fleex/demo/repos",
  "env": {
    "FLEEX_DEMO_MODE": "1",
    "FLEEX_STORAGE_DRIVER": "sqlite", "FLEEX_SQLITE_PATH": "~/.fleex/demo/{instance}.db",
    "FLEEX_EVENT_HUB_URL": "", "FLEEX_EVENT_HUB_TOKEN": "",
    "FLEEX_SUPABASE_URL": "", "FLEEX_SUPABASE_DB_URL": "", "FLEEX_SUPABASE_KEY": "",
    "FLEEX_PGSQL_URL": "", "ANTHROPIC_API_KEY": ""
  }
}]' ~/.fleex/workspaces.json > /tmp/ws.json && mv /tmp/ws.json ~/.fleex/workspaces.json
```

(`basePath` must be absolute: replace `~` with your home.)

`fleex demo reset` refuses to run outside `--workspace demo` (it also checks `FLEEX_DEMO_MODE=1`, SQLite, and a per-instance `{instance}` DB path, because it deletes that file), and the server only mounts `/api/demo/*` when `FLEEX_DEMO_MODE=1`. Without that flag, the route returns a 404.

## Seed and scenarios

`demo/seed/*.yaml` files are merged in alphabetical order. A scenario has the same shape and is appended last. Every reference is a **key** you choose (`key: nova-12`), never a UUID.

```yaml
boards:
  - { key: nova, name: "Atelier Nova", emoji: "🎨" }
epics:
  - { key: payments, title: "Paiements", boards: [nova], color: orange }
tickets:
  - key: nova-12
    board: nova
    title: "Paiement en 3 fois"
    status: doing            # backlog | todo | doing | reviewing | done | cancelled
    priority: high           # none | low | medium | high | urgent
    tags: [paiement]
    epic: payments
    persona: builder         # assigned persona (by name), optional
    repos: [atelier-nova/web] # linked repositories, display only (no clone): avoids the "no repository" banner
    createdAt: -5d           # relative to the reset: -30m, -2h, -3d, -1w
    description: |
      Markdown…
    comments:
      - { author: Nas, at: -3h, body: "…" }               # human
      - { persona: catalyst, at: -2h, body: "…" }         # agent
    deliverables:
      - { title: "PRD", type: prd, status: final, persona: catalyst, at: -2h, file: deliverables/nova-12-prd.md }
    annotations:
      - { at: -90m, title: "Plafond Alma : 3 000 € max", body: "…", tone: warning }   # info | highlight | warning | success
    workflowRun:             # a finished (or running) run, steps given inline
      name: "Spec Dev PR"
      status: completed      # completed | running | failed
      steps:
        - { name: Spec, persona: catalyst, at: -4h }
        - { name: Check Spec, gate: true, at: -3h }        # human gate, approved
        - { name: Build, persona: builder, at: -2h }
```

In demo mode the Claude Code skill scanner reads `demo/home/.claude` instead of the real `~/.claude`, so the skill picker shows Atelier Nova's fictional skills; `fleex demo reset` enables them. The Tasks status bar hides the workspace path under `?demo=1`.

Statuses moved to `done` / `cancelled` more than 7 days ago are hidden by the board's default filter. Keep their `statusAt` within the week. `fleex demo reset` writes the key → id mapping to `~/.fleex/.run/<instance>/demo-seed.json`, and the shot lists use it.

`deliverables[].file` is relative to `demo/` (or use `content: |` inline). Personas are referenced by name. When a persona is missing from the demo DB, the `personas:` list creates a minimal one (name, display name, emoji). The seed is checked as a whole before anything is written: every error comes out at once, with the ticket key.

## Shot list

```yaml
# demo/shots/<name>.yaml
feature: timeline-annotations      # → output folder name
scenario: timeline-annotations     # optional: shoot refuses to run unless the demo was reset with this scenario
out: releases/unreleased/assets/330-timeline-annotations   # default: releases/unreleased/assets/<feature>
viewport: { width: 1440, height: 900, scale: 2 }
themes: [dark, light]               # theme ids (dark, light, ember, verdant…)
format: webp                       # webp (default) or png (Slack image blocks do not take WebP)
clock: "2026-10-24T10:00:00"       # optional: frozen clock (default: the moment shoot starts)
shots:
  - id: hero
    goto: /tickets/board/all/ticket/{{ticket:nova-12}}   # web path; ?demo=1&theme=<theme> is appended
    waitFor: '[data-testid="ticket-detail"]'
    actions:                       # optional, in order
      - hover: '[data-testid="timeline-plus"]'
      - click: 'text=Annotations'
      - type: { selector: 'input[name=q]', text: 'paiement' }
      - press: Escape
      - wait: 300                  # ms
    clip: '[data-testid="ticket-detail"]'   # CSS selector, or `fullPage`, or omitted = viewport
    padding: 16                    # px around a selector clip
```

Placeholders in `goto`: `{{ticket:<key>}}` (UUID), `{{ticketNumber:<key>}}` (#), `{{board:<key>}}`. Useful URLs: `/tickets/board/{{board:nova}}` (Kanban), `/tickets/board/all/ticket/{{ticket:nova-12}}` (ticket), `/work/{{ticket:nova-12}}` (Work view), `/releases`. Stable selectors: `kanban-board`, `kanban-column`, `ticket-card`, `ticket-detail`, `ticket-timeline`, `releases-page`, `release-entry` (all `data-testid`).

Every shot runs in a fresh browser context: drafts, open drawers and panels never leak from one shot to the next. `--only hero,detail` retakes only some shots. Output: `<out>/<id>-<theme>.webp`. A WebP above 300 KB is re-encoded at lower quality. If a selector does not match, the command exits with a non-zero code and names the shot, the selector and the URL. It never writes an empty image.

Each page loads with `?demo=1&theme=<theme>`. In this mode, the version banner and every toast are hidden, animations are turned off, and the theme is forced for that page load only (nothing is saved). The clock is frozen at `clock`, or at the moment `shoot` starts, so two runs give the same images.

## Fragment format

`releases/unreleased/<ticket>-<slug>.md`:

```markdown
---
title: "Vos agents font leur QA tout seuls"     # required, ≤ 80 chars, one idea
category: feature          # feature | improvement | fix | under-the-hood
ticket: 697                # optional
prs: [325]                 # optional
audience: [dev, pm]        # optional
order: 1                   # optional, lower first
lang: fr                   # default fr
source: pr                 # optional: pr (default) | slack (backfilled from a published Slack note)
captured_at: 2026-10-20    # optional: when the screenshots were taken, if not at release time
images:                    # optional, paths relative to this file
  - src: assets/697-qa-workspace/hero-dark.webp
    light: assets/697-qa-workspace/hero-light.webp
    alt: "Le CLI qui démarre une instance qa isolée"     # required
    caption: "Une base jetable par branche"
---
Vous pouvez maintenant laisser un agent lancer une instance isolée, vérifier son travail
de bout en bout puis tout nettoyer, sans toucher à vos données.
```

Unknown keys are rejected (a typo such as `catpion:` would otherwise vanish silently), in the front-matter, in `images[]` and in `release.md`.

The body is required. Write it for the user ("vous pouvez maintenant…") and leave out how the feature was built.

## Release format

A release is a directory `releases/<N>/` that contains `release.md` plus the fragments moved from `unreleased/` with their `assets/`:

```markdown
---
number: 25
date: 2026-10-24
title: "Les agents se testent eux-mêmes"
tagline: "…et les nouveautés se racontent toutes seules."
themes: [QA autonome, Mise en scène]
---
Optional intro paragraph.
```

To publish release N:

```bash
mkdir releases/N && git mv releases/unreleased/*.md releases/N/
git mv releases/unreleased/assets releases/N/assets
# write releases/N/release.md
fleex release validate
```

## Attach a screenshot to a Fleex deliverable

```bash
bun packages/cli/index.ts file upload releases/unreleased/assets/<feature>/hero-dark.webp --alt "…" --workspace <ws>
# → ![…](/api/files/<id>)  to paste in a deliverable or a comment
```

Uploaded files live in `~/.fleex/files`, which every workspace shares. Upload to the real Fleex only (run it from outside the repo: `cd ~ && fleex file upload …`), never to the demo instance.

## API

- `GET /api/releases` returns `{ current, releases: Release[] }`, newest first. Image `src` and `light` are rewritten to `/api/releases/assets/<N>/<path>`. Invalid files are skipped and logged.
- `GET /api/releases?unreleased=1` adds `unreleased: ReleaseEntry[]`, which is used for previews.
- `GET /api/releases/assets/<N|unreleased>/<path>` serves an image from `releases/`. Any path outside that directory gets a 404.

The server reads `releases/` from its own checkout (`FLEEX_REPO_DIR`), so every install carries its own history and works offline.
