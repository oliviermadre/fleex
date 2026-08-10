# Generic ticket ingestion — the recipe

Fleex can ingest tickets from **any** third-party source (GitHub, Linear, Jira,
monitoring, email…) and hand them to a continuous-delivery workflow with **zero
source-specific code** — only configuration: a routine, a workflow template, a
prompt, and your own MCP connections. This page is the reference recipe.

## The three generic bricks

1. **`ticket.upsert`** (native operation) — an idempotent `ticket.create` keyed
   on an *External ref*: a stable id in the source system, namespaced by
   convention (`linear:ABC-42`, `github-project:PVTI_xxx`, `sentry:PROJ-123`).
   The ref is stored as an `external` ticket link; re-running with the same ref
   never duplicates. On a match, `If it already exists`:
   - `skip` (default): binds the existing ticket and **stops the step's
     remaining actions for that item** — an already-imported item must not
     re-trigger your delivery workflow on every poll;
   - `update`: applies the provided fields (tags are added, never replaced) and
     continues.
2. **The `trigger` step** (workflow entry node) — deterministic, publishes what
   started the run as an ordinary step output: the webhook payload's top-level
   keys, plus `previousRunAt` (start of the routine's previous run — the
   incremental-polling cursor, engine-provided, unhallucinatable), `firedVia`
   (`schedule` / `webhook` / `routine` / `api`…) and `firedAt`. Declare the
   payload fields you expect in its output schema to get typed
   `{{ steps.… }}` references and `forEach`.
3. **Webhook firing on routines** — additive to the base trigger (a routine can
   be `cron 9AM` *and* webhook-fired). Enabling it mints a capability URL
   `POST /api/hooks/<secret>`; the JSON body (≤256 KiB) is persisted on the run
   and republished by the trigger step. Treat the URL as a password.

Extraction needs no brick at all: an **agent step** inherits your MCP
connections and turns "list the new items in X" into a structured `items[]`
output. The only source-specific artifact is a prompt.

## Reference setup — GitHub Projects v2, near real time

1. **Your delivery workflow** (`delivery`: triage → spec → dev → QA) — any
   template you like; nothing ingestion-specific about it.
2. **Template `github-project-ingest`**:
   - Step **Trigger** (type `trigger`, entry): optionally declare the payload
     schema (e.g. `items: array`).
   - Step **extract** (agent, **mode `edit`** — `plan` mode blocks MCP tools):
     prompt: *"The trigger output contains a GitHub Projects v2 webhook event.
     If it is an item creation, fetch the issue's details with your GitHub
     tools and return it in `items`. Return at most 40 items, oldest first."*
     `outputSchema`: `{ items: [{ ref, title, description, url, priority }] }`.
   - Step **ingest** (native, `forEach: {{ steps.extract.items }}`):
     1. `ticket.upsert` — External ref `{{ item.ref }}`, `onExisting: skip`,
        title/description/priority from `{{ item.* }}` (board falls back to the
        routine subject's board);
     2. `ticket.add_tags` — `["source:github-project"]`;
     3. `workflow.trigger` — `delivery` (defaults to the just-created ticket;
        skipped entirely for already-imported items thanks to the upsert
        short-circuit).
3. **Routine**: target = that template, base trigger of your choice, **webhook
   toggle on** → copy the URL from the editor.
4. **GitHub**: org Settings → Webhooks → paste the URL, content type JSON,
   event "Projects v2 items". Done: item created → Fleex ticket in seconds →
   delivery launched. Duplicate deliveries and `edited` events converge to
   no-ops.

### Pull variant (no public reachability)

Same template; routine on `cron */15` instead of (or in addition to) the
webhook. The extract prompt fetches *"items updated since
`{{ steps.trigger.previousRunAt }}` (fetch the last 24h when empty), minus a
safety margin"* — the upsert absorbs any overlap. Push and pull coexist on one
routine; an edge condition on `{{ steps.trigger.firedVia }}` can route
"webhook → iterate the payload" vs "schedule → go fetch".

### Onboarding the next source

Duplicate the routine + template, change the extract prompt and the External
ref namespace. That's the whole procedure — no code.

## Design constraints worth knowing

- **`forEach` is capped at 50 items** (refused, not truncated) — it is the
  blast-radius guard against a hallucinated 900-item list. For backfills, ask
  the extract prompt for "at most 40, oldest first": successive polls converge
  because the upsert dedups.
- **Prototype extraction as a skill first** if you want a sandbox: a routine
  targeting a skill runs the same prompt interactively; promote it into the
  template's agent step once it behaves.
- **The webhook URL is the credential.** No per-source signature verification
  is performed — that is deliberate (it is what keeps new sources zero-code).
  Rotate by disabling/re-enabling… no: disabling keeps the secret. Rotation is
  a follow-up; today, delete and recreate the routine if a URL leaks.
- **Payload meta cannot be spoofed**: `previousRunAt` / `firedVia` / `firedAt`
  always come from the run itself and overwrite identically named payload keys.
- **One run per routine at a time.** A webhook delivery during an active run
  answers 409; senders that retry (GitHub does) will land it, and the upsert
  makes any re-delivery safe. The hybrid cron+webhook routine covers senders
  that don't retry.
