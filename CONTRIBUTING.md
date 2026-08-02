# Contributing to Fleex

Thanks for your interest in improving Fleex! A few things to know before you
open a pull request.

## License of the project

Fleex is distributed under the [Elastic License 2.0 (ELv2)](LICENSE). It is
free to use, modify, and self-host. Offering Fleex to third parties as a hosted
or managed service (SaaS, resale) is **not** permitted under that license.

## Contributions are licensed back to the project

When you submit a contribution (a pull request, commit, patch, or any other
material), you agree that:

1. **Inbound = outbound.** Your contribution is licensed to the project under
   the same terms as the project's license (ELv2), as described in the
   [GitHub Terms of Service §D.6](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#6-contributions-under-repository-license).
2. **You also accept the Contributor License Agreement** ([CLA.md](CLA.md))
   before your contribution can be merged. The CLA lets the project be
   developed, relicensed, and potentially offered commercially or as a SaaS
   without legal uncertainty. It does **not** transfer ownership of your work —
   you keep your code; you simply grant the project broad rights to use it.

## How to sign the CLA

Sign **once** and it covers all your past and future contributions:

1. Open the pinned **"Contributor License Agreement"** issue in this repository.
2. Read [CLA.md](CLA.md).
3. Post a comment from your GitHub account:

   > I have read the Fleex Contributor License Agreement (CLA.md, version 1.0)
   > and I agree to it for all of my past and future contributions to the Fleex
   > project. — @your-github-username

A maintainer will record your signature in the table at the bottom of
[CLA.md](CLA.md). New pull requests from contributors who have not signed may be
held until the CLA is accepted.

## Lint & format

```sh
bun run lint       # format check + palette ratchet + ESLint ratchet + type check
bun run format     # rewrite everything with Prettier
```

Formatting is Prettier, and it is not negotiable — `bun run lint` fails on any
unformatted file. `bun install` points git at `.githooks/`, so a pre-commit hook
formats and autofixes your staged files for you.

If a file is staged **and** has further unstaged edits, the hook refuses to
rewrite it (that would quietly drag your unstaged work into the commit) and asks
you to stage it fully or run `bun run format`. To bypass the hook entirely:

```sh
FLEEX_SKIP_HOOKS=1 git commit ...   # or: git commit --no-verify
```

### The ESLint ratchet

The repo predates its linter, so ESLint runs against a committed baseline
(`scripts/lint-snapshot.json`) rather than demanding a clean slate:

- **more** violations for a given file+rule → the build fails;
- **fewer** → the snapshot is rewritten and you commit it (CI checks that you did);
- new files are held to **zero** — an absent entry allows nothing.

Parse errors are never baselined: a file that cannot be parsed is not linted at
all, and hiding that in the snapshot would leave a permanent blind spot.

After **renaming or moving** a file, or after adding a rule to
`eslint.config.mjs`, the old snapshot keys no longer match. Rebaseline with:

```sh
bun run lint:baseline    # then commit scripts/lint-snapshot.json
```

Please don't rebaseline to silence a genuine regression. If a violation is
deliberate, prefer a narrow, justified suppression:

```ts
// eslint-disable-next-line <rule> -- <why this is correct here>
```

### git blame

The first Prettier run touched ~900 files. Skip it in blame output:

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Opening a pull request

- Keep PRs focused and reasonably small.
- Describe **why** and **what** in the PR body.
- Make sure the project builds before requesting review.

Questions? Open an issue.
