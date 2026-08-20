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

## Development setup

End users install with the [installer](README.md#installation). Working on the
code means cloning it, and a clone needs two steps before it runs:

```bash
git clone git@github.com:oliviermadre/fleex.git
cd fleex
bun install
bun run build      # builds packages/shared, web and server
```

The build is what the production server (`node packages/server/dist`) and the
web bundle need, so run it before `fleex start`. The CLI needs neither step:
`fleex` runs from a bare clone, because `@fleex/shared` resolves through the
`bun` export condition and a `paths` mapping in `packages/cli/tsconfig.json`,
both pointing at `packages/shared/src`. Keep them pointing at the same file —
`packages/cli/tests/unit/fresh-checkout.test.ts` fails if either goes missing.

If a `fleex` command reports that dependencies are not installed, it is telling
you the truth — run `bun install` in the repository root, or `fleex self-update`,
which installs and builds in one pass.

Before requesting review:

```bash
bun run lint       # palette check + tsc across every package
bun run test       # vitest
bun run test:bun   # the suites that need the Bun runtime
bun run build
```

## Opening a pull request

- Keep PRs focused and reasonably small.
- Describe **why** and **what** in the PR body.
- Make sure the project builds before requesting review.

Questions? Open an issue.
