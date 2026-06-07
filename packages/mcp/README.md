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

- Read commands are annotated `readOnlyHint`; mutating ones are not, and
  delete/remove/unlink are marked `destructiveHint` — so an MCP host can gate
  them behind user confirmation.
- `--workspace` is injected by the host (not model-controlled); `--json` is
  forced on so results come back structured.

## Use as a library

```ts
import { buildProgram } from '@fleex/cli/program';
import { generateTools, execFleex } from '@fleex/mcp';

const tools = generateTools(await buildProgram());
const result = await execFleex(tools.find(t => t.name === 'fleex_ticket_list')!, {}, { json: true });
```

## Run as an MCP server

```bash
# production (fleex on PATH)
bunx @fleex/mcp

# in-repo dev (run the CLI via bun)
FLEEX_MCP_BIN=bun FLEEX_MCP_PREFIX="run /path/to/fleex/packages/cli/index.ts" \
  bun packages/mcp/src/server.ts
```

Register it with any MCP client, e.g. Claude Code:

```bash
claude mcp add fleex -- bunx @fleex/mcp
```

### Environment

| Var | Meaning |
|---|---|
| `FLEEX_WORKSPACE` | Target workspace, injected as `--workspace` |
| `FLEEX_MCP_BIN` | fleex binary (default `fleex`) |
| `FLEEX_MCP_PREFIX` | Space-separated args before the fleex argv (e.g. `run …index.ts` for bun) |
| `FLEEX_MCP_INCLUDE` | Comma-separated top-level groups to expose (default `ticket,epic`) |
