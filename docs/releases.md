# Release notes (Nouveautés)

Fleex shows its own release history on the **Nouveautés** page (`/releases`), with a « Nouveau » badge until you open it and a one-off toast after an update. The content is plain files in `releases/`, versioned with the code: every install carries its own history and works offline.

How the content is written (by hand, by an agent, with or without screenshots) is out of scope for the product. Fleex only reads this format.

- `releases/unreleased/*.md`: entries for the next release (one Markdown file per feature, plus optional images under `assets/`).
- `releases/<N>/`: a published release, i.e. `release.md` plus its entries and `assets/`.

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
```

## API

- `GET /api/releases` returns `{ current, releases: Release[] }`, newest first. Image `src` and `light` are rewritten to `/api/releases/assets/<N>/<path>`. Invalid files are skipped and logged.
- `GET /api/releases?unreleased=1` adds `unreleased: ReleaseEntry[]`, which is used for previews.
- `GET /api/releases/assets/<N|unreleased>/<path>` serves an image from `releases/`. Any path outside that directory gets a 404.

The server reads `releases/` from its own checkout (`FLEEX_REPO_DIR`), so every install carries its own history and works offline.
