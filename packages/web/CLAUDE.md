# packages/web — Claude Code Guidelines

## UI primitives — use, never re-create

Before building any UI element, look for the primitive below. If it almost fits, **extend it** — don't fork a look-alike.

- **Toast** — `import { toast } from '<relative>/lib/toast'` then `toast.success('Saved')`, `toast.error(msg, { detail })`, `toast.info('"X" deleted', { action: { label: 'Undo', onClick } })`, `toast.show({ id, title, icon, link, durationMs: null })`. Fleex has **one** toast, rendered bottom-centre by `components/ui/toast/Toaster.tsx`. Missing an option? Extend `ToastInput` in `lib/toast.ts`. Never write another toast, snackbar, undo pill or floating notice; never import `stores/toastStore` directly. Need the stack moved (sticky bar, sheet)? `useToastOffset(px)` / `useToastAnchor('top')` from the layout. `src/architecture/toasts.guard.test.ts` fails the build otherwise. Why: `docs/adr/0001-single-toast.md`.
- **Modal / ConfirmModal** — `components/ui/Modal.tsx`, `components/ui/ConfirmModal.tsx`.
- **Button, Input, Select, MultiSelect, TagInput, Autocomplete** — `components/ui/`.
- **Tooltip** — `components/ui/Tooltip.tsx`. **Spinner / BusyLine** — `components/ui/Spinner.tsx`.
- **Status dots and colours** — `components/ui/StatusDot.tsx`; tints via `lib/tints.ts` (`tint()`, `tintClasses()`), never raw Tailwind palette classes (`bun run lint` checks it).

## HTML prototypes are visual intent, not code to copy

Prototypes such as `docs/**/prototype.html` show what the screen should feel like. Translate every element into the existing primitives above: a `.toast` in a prototype is `toast()`, a dialog is `Modal`, a coloured pill is a tint. If a primitive can't render what the prototype shows, extend the primitive — don't paste the prototype's markup and CSS.

## Tests

`bun run test` from this package (vitest + jsdom). It includes the architecture guards in `src/architecture/`.
