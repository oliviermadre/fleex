# ADR 0001 — One toast in Fleex

- **Status**: accepted
- **Date**: 2026-10-18
- **Scope**: `packages/web` (desktop and mobile). The Chrome extension (`extension/sidepanel.js`) is a separate app and out of scope.

## Context

Until this decision, Fleex showed notifications through **5 surfaces and 4 engines**, at 3 positions, with 3 shapes:

| | Surface | Position | Engine |
|---|---|---|---|
| A | System toast (`ToastContainer`) | top-right | `toastStore.addToast` — 65 calls in 26 files |
| B | Pulse notifications (`NotificationToasts`) | bottom-right | `notificationStore`, desktop only |
| C | Version banner (`VersionBanner`) | bottom-right, **overlapping B** | hand-copied style of A |
| D | Focus undo pill (`FocusView`) | bottom-centre | `focusStore` + inline keyframes |
| E | Focus undo, mobile (`MobileFocus`) | above the floating bar / top | copy of D |

D was built by a coding agent during the Focus work. Root causes, in order:

1. The prototype (`docs/focus/prototype.html`) drew a bottom-centre pill toast, and the agent reproduced it faithfully.
2. On that day the official toast could not do it: `action` and `durationMs` were added to `toastStore` three days later (Actions revamp), which created a *second* undo mechanism nobody reconciled with D. The mobile refactor then copied D into E.
3. Nothing named the UI primitives to reuse, and no check failed when a new floating surface appeared. The root `CLAUDE.md` only covered migrations.

## Decision

1. **One API, one store, one renderer, one place.** `toast` from `packages/web/src/lib/toast.ts` is the only entry point; `stores/toastStore.ts` is internal; `components/ui/toast/Toaster.tsx` is mounted once in `App.tsx` for both desktop and mobile.
2. **Bottom-centre, Focus look.** Pill action button and 2 px expiry bar, plus what A and B needed: tone dot (or emoji), title, monospace detail, clickable deep link. Hover/focus pauses the countdown (except `pauseOnHover: false`, used by Focus whose real timer lives in `focusStore`). 3 visible at most, oldest evicted. Same `id` updates in place; identical plain messages within 10 s are dropped.
3. **Position belongs to the layout, never to the caller.** `useToastOffset(px)` lifts the stack (ActionDetail's "Unsaved changes" bar, mobile floating bar); `useToastAnchor('top')` moves it top-centre (mobile sheets).
4. **Guardrails so the next agent reuses it**:
   - the primitive covers every existing use case, so there is no good reason to go around it;
   - `src/architecture/toasts.guard.test.ts` (runs in `bun run test` and CI) fails on a direct store import (R1), a `*Toast`/`*Snackbar` component (R2), a `fixed` corner/centre box outside `floating-surfaces.allowlist.ts` (R3), a shrinking expiry-bar keyframe (R4). Its failure message says what to use instead;
   - `packages/web/CLAUDE.md` (auto-loaded by Claude Code in `packages/web`) lists the UI primitives and states that HTML prototypes are visual intent, to be translated into primitives;
   - this ADR, linked from both.

## Consequences

- Every notification appears in one predictable place; B and C no longer overlap; there is a single undo mechanism.
- Pulse notifications now also show on mobile (not clickable there: the mobile shell has no URL routes).
- Error and warning toasts last 8 s (was 5 s); action toasts at least 8 s.
- The version banner loses its styled `<code>` snippets: that is the price of a uniform toast.
- A new persistent floating element (not a notification) must be added to the allowlist with a reason — a visible decision in the PR.
- The guard is a regex scan: it can be bypassed on purpose (e.g. inline `style` positioning). It is there to catch the *accidental* second surface, which is how D happened.

## Alternatives rejected

- **Harmonise the component only.** Necessary but not sufficient: it fixes today, not the next prototype.
- **A `CLAUDE.md` rule alone.** A model can still decide "this case is special"; nothing fails.
- **A Claude Code `PreToolUse` hook blocking edits.** Local only, brittle (regex on partial diffs), and redundant with the guard test, which also runs in CI.
- **ESLint rule.** `packages/web` has no ESLint setup; adding one for this alone is heavier than a vitest scan.
