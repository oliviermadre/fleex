/**
 * A script station, as the page needs it: the shape of what it is set to run, and the words for it. The server
 * decides what runs and what it concludes (`script-runner.ts`); this only describes.
 */
export const ANY_REPO = '*';
export const WORKSPACE = 'workspace';
export interface ScriptLine { target: string; kind: 'action' | 'command'; value: string }
export interface ScriptSpec { action?: string; lines: ScriptLine[]; missing: 'ignore' | 'ko' | 'own'; onFail: 'all' | 'stop'; timeoutSec?: number }
/** An action that has a name of its own ("test", "lint"): each repository says what it runs. */
export interface NamedAction { name: string; description?: string }

export const blankScript = (): ScriptSpec => ({ lines: [], missing: 'ignore', onFail: 'all' });
export const scriptOf = (s: ScriptSpec | undefined): ScriptSpec => ({ ...blankScript(), ...(s ?? {}), lines: s?.lines ?? [] });
/** The ways out of a script station: "unconfigured" only when it is asked for. */
export const scriptOutcomes = (s: ScriptSpec): string[] => (s.missing === 'own' ? ['ok', 'ko', 'unconfigured'] : ['ok', 'ko']);
export const targetName = (t: string): string => (t === ANY_REPO ? 'any repository' : t === WORKSPACE ? 'ticket workspace' : t);
/** A line that has nothing to run yet: the floor is saved without it. */
export const incompleteLine = (l: ScriptLine): boolean => !l.value.trim();

/** What a script station runs, in a few words, for the line under its name. */
export function scriptSummary(s: ScriptSpec | undefined): string {
  const spec = scriptOf(s), n = spec.lines.length, parts = [spec.action ? `default "${spec.action}"` : '', n ? `${n} line${n === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.length ? parts.join(' + ') : 'nothing to run yet';
}
/** What it runs, line by line, for the plate shown beside it. */
export function scriptPlate(s: ScriptSpec | undefined): string[] {
  const spec = scriptOf(s), short = (v: string) => (v.length > 34 ? `${v.slice(0, 33)}…` : v);
  const out = spec.lines.map((l) => `${targetName(l.target).split('/').pop()} $ ${l.kind === 'action' ? `action ${l.value}` : short(l.value)}`);
  if (spec.action) out.push(`others $ action ${spec.action}`);
  if (!out.length) out.push('nothing to run yet');
  out.push(`no command: ${spec.missing === 'ignore' ? 'skipped' : spec.missing === 'ko' ? 'failure' : 'unconfigured'}`);
  return out;
}
/** A name fit for an action: lower case, no spaces, short. */
export const actionName = (v: string): string => v.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
