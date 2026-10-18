/**
 * Files allowed to position something `fixed` against a screen edge (rule R3 of
 * toasts.guard.test.ts). Fleex has ONE toast; anything else floating must be a
 * persistent UI element — never a notification — and is listed here with why.
 *
 * Adding an entry is a visible decision in the PR, not a silent workaround: if
 * what you are building tells the user something happened, use `toast()` from
 * lib/toast.ts instead. See docs/adr/0001-single-toast.md.
 */
export const FLOATING_SURFACES: ReadonlyArray<{ path: string; reason: string }> = [
  { path: 'components/ui/toast/Toaster.tsx', reason: 'the one toast surface' },
  { path: 'components/settings/actions/ActionDetail.tsx', reason: '"Unsaved changes" bar — persistent action bar tied to a dirty form, not a toast' },
  { path: 'mobile/MobileMorePages.tsx', reason: 'floating "Modifier / Terminer" edit button on a mobile page — a control, not a toast' },
];
