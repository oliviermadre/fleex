# @fleex/mcp

A Model Context Protocol (MCP) **stdio server** exposing the fleex CLI domain
surface — tickets, epics, boards, deliverables — as typed tools, plus the
generator that produces them.

## How it works

Tools are derived from the **live fleex Commander tree** (the same introspection
behind `fleex documentation`), so a new CLI command becomes a tool with zero
extra wiring. Each tool is executed by running `fleex` with an **argv array and
no shell** — there is no command-injection surface, and multi-line values (e.g.
a web page rendered to Markdown passed as `--description`) pass through intact.

- Read/write classification is an **allowlist of read commands**: anything else
  counts as a write and loses `readOnlyHint`, so an MCP host can gate it behind
  user confirmation. It fails closed on purpose — a command nobody classified is
  gated rather than silently trusted. Leaves whose name contains a destroying
  verb (`delete`, `remove`, `unlink`, … at either end of a hyphenated name, so
  both `comment-delete` and `remove-board`) also carry `destructiveHint`.
- `--workspace` is injected by the host (not model-controlled); `--json` is
  forced on so results come back structured. `--force`/`--yes` are likewise
  host-controlled and kept out of the tool schemas — a model that could set them
  itself would render the CLI's own confirmation prompt meaningless.
- Tools whose command legitimately runs long (`ticket link` creates a worktree,
  `ticket import` talks to GitHub) declare their own execution budget.

## Use as a library

```ts
import { buildProgram } from '@fleex/cli/program';
import { generateTools, execFleex } from '@fleex/mcp';

const tools = generateTools(await buildProgram());
const result = await execFleex(tools.find(t => t.name === 'fleex_ticket_list')!, {}, { json: true });
```

## Run as an MCP server

The simplest entry point is the CLI wrapper, which sets the env for you and
re-invokes the same fleex it ships with (so the tool surface never drifts from
the running CLI):

```bash
# foreground stdio server scoped to one workspace
fleex mcp start --workspace evaneos

# limit the exposed command groups (default: ticket,epic)
fleex mcp start --workspace evaneos --include ticket,epic,panel

# let tools that would block on the CLI's confirmation prompt run:
# your MCP client becomes the approval authority for them
fleex mcp start --workspace evaneos --assume-yes
```

Commands that prompt for confirmation (`ticket delete`, `epic delete`, …) are
**refused** by default with an explanatory error: a stdio server holds stdin for
the protocol, so nobody can answer the prompt and the call would simply hang
until it times out. Pass `--assume-yes` only if your MCP client asks the user
before dispatching a destructive tool call.

`fleex mcp start` is **foreground-only**: a stdio server stays attached to
stdin/stdout for the protocol and exits when the client disconnects — there is
no background/daemon mode for stdio transport. Let your MCP client own its
lifecycle.

You can also run the server module directly:

```bash
# production (fleex on PATH)
bunx @fleex/mcp

# in-repo dev (run the CLI via bun)
FLEEX_MCP_BIN=bun FLEEX_MCP_PREFIX="run /path/to/fleex/packages/cli/index.ts" \
  bun packages/mcp/src/server.ts
```

Register it with any MCP client, e.g. Claude Code:

```bash
claude mcp add fleex -- fleex mcp start --workspace evaneos
# or, without the CLI wrapper:
claude mcp add fleex -- bunx @fleex/mcp
```

### Environment

| Var | Meaning |
|---|---|
| `FLEEX_WORKSPACE` | Target workspace, injected as `--workspace` |
| `FLEEX_MCP_BIN` | fleex binary (default `fleex`) |
| `FLEEX_MCP_PREFIX` | Space-separated args before the fleex argv (e.g. `run …index.ts` for bun) |
| `FLEEX_MCP_INCLUDE` | Comma-separated top-level groups to expose (default `ticket,epic`) |
| `FLEEX_MCP_ASSUME_YES` | Allow destructive tools to skip the CLI confirmation prompt (`1`/`true`/`yes`). Off by default; your MCP client becomes the approval authority |
| `FLEEX_MCP_TIMEOUT_MS` | Default per-tool execution budget (default `30000`). Commands with a declared budget (`ticket link`, `ticket import`) keep theirs |
