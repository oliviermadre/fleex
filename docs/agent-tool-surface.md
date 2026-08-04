# Agent tool surface ↔ CLI parity

The MCP tools an agent can call are **generated** from the live Commander tree
(`packages/mcp/src/generator.ts` walking `buildProgram()`). Nothing is mapped by
hand: a new CLI command or option becomes callable with zero extra wiring.

This document states the two guarantees that generation must uphold, and the
one thing it deliberately does *not* guarantee.

## Guarantee 1 — every option is reachable

**Every option Commander declares on an exposed command must be expressible
from a tool call.** In particular, negative options.

A boolean has three meaningful states from a tool call — set, unset, untouched —
so `--no-blocked` is *not* redundant with `--blocked`. It is the only way to say
"unset". The generator pairs them into a single tri-state parameter:

| Tool input        | argv emitted   |
| ----------------- | -------------- |
| `blocked: true`   | `--blocked`    |
| `blocked: false`  | `--no-blocked` |
| absent / `null`   | (nothing)      |

An option declared *only* in negative form (`--no-color`) becomes a parameter
that accepts `false` and rejects `true`.

`buildArgv` never silently drops a `false`: it either produces a flag or throws.
Silence is what made `--no-blocked` unreachable — an agent asked to unblock a
ticket sent `{blocked: false}`, the value was discarded, and the CLI answered
"No updates specified" about a call it never received.

**This is enforced, not documented-and-hoped-for.** `packages/mcp/tests/parity.bun.test.ts`
walks the real command tree and fails, naming the offending option, if any
option of an exposed command cannot be produced from a tool input.

It must run under Bun (`bun run test:bun`) because `buildProgram()` uses
`Bun.Glob`; the Node workspace run excludes `*.bun.test.ts`.

## Guarantee 2 — a write that changed nothing never reports success

`PATCH /api/tickets/:id` and `PATCH /api/epics/:id` return `changed: string[]`,
the fields that actually moved. The entities already computed that diff for the
audit trail — the routes simply stopped discarding it.

`ticket update` / `epic update` use it:

- `changed` non-empty → `Updated ticket #N: … (blocked)`
- `changed` empty → `No changes applied to ticket #N — values already match.`, exit `0`

A no-op is **exit 0**, not an error: an idempotent write is not a malformed
call, and failing it would break agents that reconcile a desired state. What
matters is that the word "Updated" never appears when nothing was written.

If the server does not return `changed` (older server than CLI), the CLI cannot
prove a no-op and falls back to the previous optimistic message rather than
wrongly claiming nothing happened.

## Non-guarantee — the perimeter is narrower on purpose

`DEFAULT_INCLUDE = ['ticket', 'epic']`.

**Inclusion criterion: the command manipulates product data through the API and
has no effect on the local environment.** Infra commands (`start`, `stop`,
`logs`, `doctor`, `self-update`, `token`, shell helpers) drive processes on the
host machine and stay off the surface deliberately.

The parity guarantee is about **options, not perimeter**. Narrowing the
perimeter is a product decision; silently dropping an option is a bug. The
parity test scopes its assertions to the allowlist accordingly.

## Related invariant — `--board` means the same thing everywhere

Every `--board` accepts a **name, a UUID, or a unique id prefix**, resolved by
`resolveBoardId` / `resolveBoardIdOrDefault` (`commands/board/_shared.ts`),
which report ambiguity instead of picking the first match. `ticket` used to
pass the string straight through, so a prefix copied from `board list` worked
on `epic` and failed on `ticket create` (fixed separately, #517).

It matters here because the tool surface inherits it: an agent reads an id from
one tool and passes it to another, so a `--board` that resolves differently per
command is the same class of bug as an option that cannot be expressed at all.
