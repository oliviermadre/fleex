# DESIGN_TOKENS — prototype values → Fleex theme

The prototype is hard-coded on the **Light** theme from `packages/web/src/lib/themes.ts`. In the implementation use the `--theme-*` CSS variables (Tailwind arbitrary values as elsewhere in the web app) so every theme works.

| Prototype literal | Meaning | Fleex token |
|---|---|---|
| `#f4f4f5` | app / center background | `--theme-bg-base` |
| `#fff` | panels, bars, cards | `--theme-bg-primary` |
| `#e4e4e7` | borders | `--theme-border` |
| `#f0f0f2` | subtle borders (section dividers) | `--theme-border-subtle` |
| `#18181b` | primary text | `--theme-text-primary` |
| `#52525b` / `#3f3f46` | secondary text | `--theme-text-secondary` |
| `#828289` / `#a1a1aa` | muted / faint text | `--theme-text-muted` / `--theme-text-faint` |
| `#4f46e5` | accent (buttons, selection border, progress, focus outline) | `--theme-accent` |
| `#4338ca` | accent text / hover | `--theme-accent-active` |
| `rgba(99,102,241,.10)` | accent tint (selected row, user bubble, active tool) | `--theme-accent-subtle` (or `--theme-bg-hover` for selection) |
| `#fff` on accent | button label | `--theme-accent-fg` |
| Amber `#a16207` text / `rgba(234,179,8,.06–.10)` bg / `rgba(234,179,8,.35)` border | NEEDS YOU, inline question, waiting dot | `tints.ts` amber (`tint-amber-*`) — same family as the existing `waiting` `ActivityPill` |
| Indigo dot pulsing | running | same as existing `running` `ActivityPill` |
| Purple `#7e22ce` / `rgba(168,85,247,.12)` | agent persona avatar `⌬`, Reviewing status | `tints.ts` purple |
| Green `#166534` / `rgba(34,197,94,.10)` | PR card, Done, add lines, answered option | `tints.ts` green |
| Red `#991b1b` / `rgba(239,68,68,.10)` | del lines, Terminate | `tints.ts` red |
| Dark `#18181b` / `#27272a` / `#3f3f46` | shell drawer / stream log | terminal colors from `useTerminalFont` + theme terminal bg |

Type: system UI stack, 13px base; 11px meta; 10.5px uppercase section labels with `letter-spacing .06–.08em`; mono `ui-monospace, Menlo` for ids, branches, paths, logs (use the app's terminal font setting for terminals only).

Radii: 6px chips/buttons, 8px rows, 9–12px cards/composer. Row padding 8–9px × 10px. Progress bar 3px, radius 2px.

Icons: the prototype uses glyphs (`◫ ⇄ ± ‹› ▤ >_ ⎇ ⌬ ◆`). Replace with the existing SVG icon style (20px, stroke 1.5) from `sidebar/icons.tsx` / `lib/primitives`; keep the label under each tool-strip icon (user requirement: icons alone are not readable enough).
