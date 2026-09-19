You are implementing the new « Work » view in the Fleex monorepo (packages/web + packages/server).

Start by reading, in this order:
1. handoff/README.md
2. handoff/SPEC.md
3. handoff/DATA_MODEL.md
4. handoff/IMPLEMENTATION_PLAN.md
5. handoff/DESIGN_TOKENS.md
6. handoff/prototype/Fleex-Work-Prototype.dc.html — read the whole file: the <x-dc> template is the target markup/layout, the `class Component` is the target behaviour (state machine, queue partition, shell layouts, delegation flow). Screenshots of key states are in handoff/screenshots/.

Then verify the repo anchors named in IMPLEMENTATION_PLAN.md actually exist (uiStore ActivePanel, RouterSync, NavSidebar, AppLayout hideContentPanel, MainPanel switch) and adapt paths if they moved.

Implement Phase 0 then Phase 1 only, as described. Rules:
- Additive only: new `work` panel, `/work` route, new nav item. Do not change the behaviour of any existing panel, store field, or route.
- Reuse existing components/stores listed in DATA_MODEL.md instead of re-implementing (comments rendering, mention autocomplete, ticket activity, overlay sync, pinned actions, notifications, deliverable overlay).
- Use `--theme-*` CSS variables, not the prototype's hex literals.
- Add tests: RouterSync `/work` parse/serialize, queue partition, suggestion rules, inline option parser.
- Run `pnpm static-code-analysis`, `pnpm knip:gate`, build and tests before declaring done.

Stop after Phase 1 and summarize what was built, what was reused, and any spec point you had to interpret.
