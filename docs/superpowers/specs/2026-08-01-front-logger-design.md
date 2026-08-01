# Front logger — spec

**Ticket** — from #362: Introduire un logger front & supprimer les ~33 `console.*` en prod
**Date** — 2026-08-01
**Baseline** — commit `505bb33`
**Status** — final, ready for build

---

## 1. Problem

`packages/server` has a leveled, structured logger (`LoggerPort` + `PinoLoggerAdapter`).
`packages/web` has nothing: every diagnostic goes through a raw `console.*` call.

Consequences:

- **Not filterable.** No level, no namespace. You take everything or you open devtools and squint.
- **Not structured.** The payload is whatever got spread into the varargs. Context lives inside interpolated strings (`` `Failed to save ${field}:` ``) so it can't be grepped or filtered.
- **Not recoverable.** Fleex is self-hosted with no Sentry, no telemetry, no remote sink. If a user hits a bug, the only trace is whatever is still scrolled into their console.
- **No guardrail.** Nothing stops the count from growing — the repo has no ESLint, so no `no-console` rule.

---

## 2. What is actually in the codebase

The ticket says "~33 `console.*` hors scripts/tests côté web". The real inventory:

| Where | Count | Verdict |
|---|---|---|
| `packages/web/src` (excl. tests) | **29** | In scope |
| `packages/web/src/**/*.test.ts` | 1 | Out of scope (tests may log) |
| `packages/host-gateway/src/logger.ts` | 4 | **Out of scope** — they are *inside* the gateway's own logger, which already has verbosity levels |
| `packages/desktop`, `sidepanel-host`, `mcp`, `event-hub`, `shared`, `cli` | 0 | — |

29 + 4 = the "~33" from the ticket. The 4 gateway calls are legitimate.
**The work is 29 call sites in `packages/web/src`.**

Breakdown of those 29:

- `console.error` — **23**, all inside `catch` blocks, all shaped `console.error('Failed to X:', err)`
- `console.warn` — **6**, clipboard failures, some already passing a structured object

**There is zero `console.log` debug spam.** This reframes the ticket: "supprimer les `console.*` en prod" cannot mean "make them disappear in production" — that would delete the *only* error signal in an app with no other reporting channel. See decision D1.

Existing precedents to follow:

- `packages/server/src/application/ports/logger.port.ts` — the API shape to mirror
- `packages/host-gateway/src/logger.ts` — a lightweight, level-gated logger already living in this repo
- `scripts/check-raw-palette.mjs` — how this repo enforces a codebase-wide rule without ESLint (custom node script wired into `bun run lint`)

---

## 3. Decisions

Every functional question is resolved here. The Builder should not need to come back.

**D1 — In production the logger defaults to `warn`, not silent.**
Fleex is a self-hosted dev tool. There is no Sentry, no log ingestion, no support channel that receives crash reports. The 23 `console.error` calls are the only evidence a user gets that "load skills" silently failed. Stripping them in prod would trade a real diagnostic for a cosmetic win. So: **dev → `debug`, prod → `warn`.** All 29 existing sites keep emitting exactly as they do today. What the ticket asks for is delivered by the other three properties — structure, namespacing, and the ability to *turn it down* (`?log=silent`) or *turn it up* (`?log=debug`) without a rebuild.

**D2 — Console only. No log shipping to the server.**
No `POST /api/client-logs`, no batching, no transport abstraction. The server runs on the same machine as the browser; the console is right there. Adding a network sink means auth, back-pressure, PII, retention — all unjustified today. Revisit if Fleex ever ships a hosted mode.

**D3 — A bounded in-memory ring buffer, always capturing at `debug`.**
Consequence of D1: with prod at `warn`, any future `log.debug()` is invisible in prod, which would make debug logging pointless to write. The buffer fixes that — the console is filtered, the buffer is not. Last **200** entries, exposed via `window.__fleexLog`. ~20 lines, bounded memory, and it is the concrete answer to "logs non récupérables en prod".

**D4 — Scope name = module path relative to `src/`, without extension.**
`src/stores/agentEventStore.ts` → `stores/agentEventStore`. Deterministic, so there is nothing to invent per file, and it doubles as a grep key.

**D5 — Caught errors go in `data` under the key `err`.**
`log.error('Failed to load skills', { err })`. The logger normalizes any `Error` value inside `data` to `{ name, message, stack }`. Interpolated context moves out of the message and into `data` (see `AgentMarkdownTab` in §6).

**D6 — Guardrail is a custom node script, zero-tolerance, not a ratchet.**
`check-raw-palette.mjs` is a ratchet because it started at a large number. Here we reach 0 in the same PR, so the guard is a hard "0 allowed" check with a single allowlisted file (the logger itself). Simpler, and it can never silently drift upward.

**D7 — No behavior change beyond logging.**
No toasts, no error boundaries, no retry, no user-facing surfacing of these caught errors. Tempting, but it is a different ticket with different UX questions.

**D8 — The logger lives in `packages/web`, not `@fleex/shared`.**
It depends on `import.meta.env`, `localStorage` and `window`. Nothing else consumes it today.

---

## 4. The logger module

**File** — `packages/web/src/lib/logger.ts` (+ `logger.test.ts` alongside, matching `lib/formatAge.test.ts` conventions)

### 4.1 Public API

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type LogData = Record<string, unknown>;

export interface Logger {
  debug(msg: string, data?: LogData): void;
  info(msg: string, data?: LogData): void;
  warn(msg: string, data?: LogData): void;
  error(msg: string, data?: LogData): void;
}

/** scope = module path relative to src/, no extension. e.g. 'stores/agentEventStore' */
export function createLogger(scope: string): Logger;

export function getLogLevel(): LogLevel;
export function setLogLevel(level: LogLevel): void; // persists to localStorage
```

`debug/info/warn/error` with `(msg, data?)` is exactly the server's `LoggerPort`. Same muscle memory across packages.

### 4.2 Level resolution

Resolved once at module init, memoized in a module-level variable. First hit wins:

```
                    ┌─────────────────────────────────┐
  ?log=<level>  ──▶ │ valid?  → persist to            │
  in location.search│          localStorage, use it   │
                    └──────────────┬──────────────────┘
                                   │ absent / invalid
                                   ▼
                    ┌─────────────────────────────────┐
  localStorage      │ 'fleex:logLevel'                │
                    └──────────────┬──────────────────┘
                                   │ absent / invalid
                                   ▼
                    ┌─────────────────────────────────┐
  build default     │ import.meta.env.DEV             │
                    │   ? 'debug'  :  'warn'          │
                    └─────────────────────────────────┘
```

- The `?log=` query param exists for the mobile PWA (`docs/mobile.md`) where opening devtools to set `localStorage` is painful. It persists, so it survives the navigation that strips the param.
- An unrecognized value falls through to the next source. It never throws.
- All `localStorage` access is wrapped in `try/catch` (Safari private mode throws on write) and guarded by `typeof window !== 'undefined'`.
- `setLogLevel()` updates the memoized value *and* persists. It is what tests use.

Ordering: `silent(4) > error(3) > warn(2) > info(1) > debug(0)`. A call emits to the console when `levelRank(call) >= levelRank(current)`; `silent` emits nothing.

### 4.3 Console output

| Method | Console fn |
|---|---|
| `debug` | `console.debug` |
| `info` | `console.info` |
| `warn` | `console.warn` |
| `error` | `console.error` |

Format:

```js
// with data
console.error('[fleex:stores/skillStore] Failed to load skills', { err: {...} })
// without data — second argument omitted, no empty object noise
console.error('[fleex:stores/skillStore] Failed to load skills')
```

### 4.4 Error normalization

Before emitting (console *and* buffer), `data` is shallow-walked: any value that is an `instanceof Error` becomes `{ name, message, stack }`. Non-Error values pass through untouched. No deep traversal, no cycle handling — shallow is enough for every call site in §6 and keeps the module small.

### 4.5 Ring buffer & diagnostics handle

- Every call is pushed to the buffer **regardless of the active level** (except when level is `silent` — then nothing is captured either; `silent` means silent).
- Capacity **200**, FIFO drop.
- Entry: `{ ts: string /* ISO */, level: LogLevel, scope: string, msg: string, data?: LogData }`.

Attached to `window` in **all builds** — that is the point of D3:

```ts
window.__fleexLog = {
  entries(): LogEntry[],   // copy of the buffer, oldest first
  dump(): string,          // JSON.stringify(entries(), null, 2) — paste into a bug report
  getLevel(): LogLevel,
  setLevel(level: LogLevel): void,
};
```

Declared via `declare global { interface Window { __fleexLog?: FleexLogHandle } }`.

---

## 5. Guardrail

**File** — `scripts/check-no-console.mjs`, modeled on `scripts/check-raw-palette.mjs` (same header-comment style explaining the rationale, same walk/report shape).

- Walks `packages/web/src`, files matching `\.tsx?$`.
- Skips `*.test.ts` / `*.test.tsx`.
- Allowlist: `lib/logger.ts` only (relative to `src/`).
- Pattern: `\bconsole\.(log|warn|error|info|debug|trace|table|dir|group|groupEnd|time|timeEnd|assert|count)\b`
- Escape hatch: a line carrying the trailing comment `// fleex-allow-console` is skipped. Document it in the script header; expect zero uses today.
- **Zero tolerance.** Any match → print `file:line` list + remediation, `exit 1`.
- Success → `✓ No raw console.* in packages/web/src (use createLogger from lib/logger.ts).`

Remediation message must name the fix explicitly:

```
Use the scoped logger instead (packages/web/src/lib/logger.ts):
  const log = createLogger('stores/skillStore');
  log.error('Failed to load skills', { err });
```

**Wiring** — root `package.json`, prepend to the existing `lint` script:

```json
"lint": "node scripts/check-no-console.mjs && node scripts/check-raw-palette.mjs && tsc -b packages/shared && …"
```

---

## 6. Migration — all 29 call sites

Import convention, one per module, declared at module top-level next to the other imports:

```ts
import { createLogger } from '../lib/logger';   // relative depth depends on the file
const log = createLogger('<scope>');
```

> This repo has **no `@/` path alias**. Use the relative style already present in each file — `../lib/logger` from `src/stores/`, `../../lib/logger` from `src/components/<group>/`, `../lib/logger` from `src/services/`. Do not add an alias as part of this ticket.

Rewrite rule: `console.error('Failed to X:', err)` → `log.error('Failed to X', { err })`. Drop the trailing colon, keep the wording, keep the position in the `catch` block.

Line numbers are as of `505bb33`.

### 6.1 Stores — `console.error` → `log.error(msg, { err })`

| File | Scope | Lines |
|---|---|---|
| `src/stores/executionLogStore.ts` | `stores/executionLogStore` | 75, 105 |
| `src/stores/panelStore.ts` | `stores/panelStore` | 33 |
| `src/stores/agentPersonaStore.ts` | `stores/agentPersonaStore` | 44 |
| `src/stores/documentsStore.ts` | `stores/documentsStore` | 36 |
| `src/stores/agentEventStore.ts` | `stores/agentEventStore` | 44, 55, 70 |
| `src/stores/skillStore.ts` | `stores/skillStore` | 34 |

### 6.2 Components — `console.error` → `log.error(msg, { err })`

| File | Scope | Lines |
|---|---|---|
| `src/components/tickets/KanbanCard.tsx` | `components/tickets/KanbanCard` | 133 |
| `src/components/tickets/InlineCardCreator.tsx` | `components/tickets/InlineCardCreator` | 76 |
| `src/components/tickets/TicketsContentPanel.tsx` | `components/tickets/TicketsContentPanel` | 103 |
| `src/components/agents/AgentConfigTab.tsx` | `components/agents/AgentConfigTab` | 32 |
| `src/components/agents/AgentPersonaView.tsx` | `components/agents/AgentPersonaView` | 37 |
| `src/components/agents/AgentEventsTab.tsx` | `components/agents/AgentEventsTab` | 70 |
| `src/components/agents/SkillEditor.tsx` | `components/agents/SkillEditor` | 38, 145 |
| `src/components/dashboard/SmartSessionButton.tsx` | `components/dashboard/SmartSessionButton` | 558, 576, 592, 608 |
| `src/components/main-panel/AgentExecutionsPanel.tsx` | `components/main-panel/AgentExecutionsPanel` | 76 |

`KanbanCard.tsx:133` is inside a `.catch((err) => …)` rather than a `try/catch` — same rewrite, keep the arrow:
`.catch((err) => log.error('Failed to retry Slack import', { err }))`

### 6.3 Special cases

**`src/components/agents/AgentMarkdownTab.tsx:45`** — scope `components/agents/AgentMarkdownTab`.
The interpolated field name moves into the payload; this is the structured-logging win, do not keep the template literal.

```ts
// before
console.error(`Failed to save ${field}:`, err);
// after
log.error('Failed to save persona field', { field, err });
```

**`src/components/tickets/DeliverableReadingOverlay.tsx:68`** — scope `components/tickets/DeliverableReadingOverlay`.
Drop the manual `[Fleex]` prefix; the scope replaces it.

```ts
// before
console.warn('[Fleex] Copy to clipboard failed', err);
// after
log.warn('Copy to clipboard failed', { err });
```

**`src/components/main-panel/FloatingSessionOverlay.tsx:81`** — scope `components/main-panel/FloatingSessionOverlay`. Same treatment: `log.warn('Copy path failed', { err })`.

**`src/services/clipboardProvider.ts:13,29`** — scope `services/clipboard`.
Delete the `LOG_PREFIX` constant. The payload is already structured — keep every field, and replace the hand-serialized `error:` with `err` so the logger normalizes it.

```ts
// after (L13)
log.warn('writeText FAILED, buffering for Cmd+C fallback', {
  selection,
  len: text.length,
  isSecureContext: window.isSecureContext,
  hasFocus: document.hasFocus(),
  err,
});
// after (L29)
log.warn('readText FAILED', { selection, err });
```

**`src/services/terminalManager.ts:71,80`** — scope `services/terminalManager`.
Drop the `[FLEEX:Clipboard]` prefix, keep the messages.

```ts
.catch((err) => log.warn('failed to copy xterm selection', { err }));
.catch((err) => log.warn('failed to copy pending OSC52 text', { err }));
```

After migration, `LOG_PREFIX` and the strings `[Fleex]` / `[FLEEX:Clipboard]` no longer appear in `packages/web/src`.

---

## 7. Tests

`packages/web/src/lib/logger.test.ts` — vitest + jsdom, mirroring the style of `lib/formatAge.test.ts`. Spy on console with `vi.spyOn(console, 'error')` etc., restore in `afterEach`, and reset the module state between tests (`setLogLevel` + clear `localStorage`).

1. **Level filtering** — at `warn`: `debug()` and `info()` do not touch the console; `warn()` and `error()` do.
2. **Level raising** — `setLogLevel('debug')` makes `debug()` reach `console.debug`.
3. **Silent** — at `silent`, nothing reaches the console and nothing enters the buffer.
4. **Prefix format** — the first console argument is exactly `[fleex:stores/foo] message`.
5. **No-data call** — `console.error` is called with a single argument (no trailing `undefined`/`{}`).
6. **Error normalization** — `log.error('x', { err: new Error('boom') })` emits `{ err: { name: 'Error', message: 'boom', stack: expect.any(String) } }`.
7. **Buffer captures below the console level** — at `warn`, a `debug()` call adds an entry to `__fleexLog.entries()` while the console stays untouched.
8. **Buffer cap** — 250 calls → `entries()` has 200, and the first one is the 51st call (FIFO).
9. **`?log=` param** — with `location.search = '?log=debug'`, the resolved level is `debug` and it is persisted to `localStorage`.
10. **Invalid values** — `localStorage['fleex:logLevel'] = 'lol'` falls back to the build default, no throw.
11. **`localStorage` unavailable** — a getter that throws does not crash `createLogger` or any log call.

No test changes are required for the 29 migrated files — none of them assert on console output today.

---

## 8. Acceptance criteria

- [ ] `packages/web/src/lib/logger.ts` exports `createLogger`, `getLogLevel`, `setLogLevel`, and the `LogLevel` / `LogData` / `Logger` types.
- [ ] Default level is `debug` when `import.meta.env.DEV`, `warn` otherwise.
- [ ] `?log=debug` and `localStorage['fleex:logLevel']` both override the default, param taking precedence and persisting.
- [ ] An invalid or unavailable `localStorage` never throws and never breaks a log call.
- [ ] Console lines are prefixed `[fleex:<scope>]`; `data` is passed as a second argument only when present.
- [ ] `Error` values inside `data` are emitted as `{ name, message, stack }`.
- [ ] `window.__fleexLog.entries()` returns at most 200 entries, captured regardless of the console level, in FIFO order; `dump()` returns valid JSON.
- [ ] All **29** call sites of §6 use the scoped logger. `grep -rn "console\." packages/web/src --include="*.ts" --include="*.tsx" | grep -v "\.test\."` returns only `lib/logger.ts`.
- [ ] `LOG_PREFIX`, `[Fleex]` and `[FLEEX:Clipboard]` are gone from `packages/web/src`.
- [ ] `scripts/check-no-console.mjs` exists, exits 1 with a `file:line` report on any violation, and exits 0 on the migrated tree.
- [ ] Root `lint` script runs `check-no-console.mjs` before `check-raw-palette.mjs`.
- [ ] `bun run lint` passes.
- [ ] `bun run test` passes, including the new `logger.test.ts`.
- [ ] Manual: `bun run dev`, provoke a failing load, confirm `[fleex:stores/…]` in the console. Build for prod, confirm `debug()` is filtered but `error()` still prints, and `__fleexLog.dump()` returns the full history.

---

## 9. Scope boundaries

**In scope** — the logger module, its tests, the guardrail script + lint wiring, the 29 migrations in `packages/web/src`.

**Out of scope**

- **Shipping logs to the server** (`/api/client-logs`, batching, remote sink) — D2.
- **Sentry / any third-party error reporting.**
- **User-facing error surfacing** (toasts, error boundaries) for the migrated `catch` blocks — D7. Today these failures are silent to the user; they stay silent. Worth its own ticket.
- **`packages/host-gateway`** — its 4 `console.*` are inside its own already-leveled logger.
- **`packages/desktop`, `packages/sidepanel-host`, `packages/mcp`, and the root `extension/`** — 0 or 1 occurrences, different runtimes.
- **`console.*` in test files** — 1 occurrence, legitimate.
- **New log statements.** This ticket adds no `debug`/`info` call sites; it migrates what exists. The logger makes future debug logging worth writing.
- **Adding an `@/` path alias** to `vite.config.ts` / `tsconfig.json`.
- **Promoting the logger to `@fleex/shared`** — D8.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Prod default `warn` reads as "not removed from prod" | D1 documents the trade-off. The raw calls *are* gone from app code; what remains is a filterable, silenceable channel. `?log=silent` gives a true off switch. |
| Ring buffer retains sensitive payloads in memory | Only what call sites already pass; nothing is transmitted anywhere (D2). Bounded at 200 entries, cleared on reload. |
| Guardrail blocks a legitimate future `console.*` | `// fleex-allow-console` escape hatch, documented in the script header. |
| Line numbers in §6 drift before the branch is built | Match on the message string, not the line number. The `file → scope` mapping is the stable part. |
