import type { ActionParamDef } from '../types/action.js';

export interface ActionParamError {
  param: string;
  reason: string;
}

export type ActionParamResult =
  | { ok: true; values: Record<string, string> }
  | { ok: false; errors: ActionParamError[] };

/**
 * Validates the caller-supplied params against the action's declared schema and
 * returns them as strings ready for template substitution.
 *
 * Values are never inspected for "dangerous" characters: under `execFile` an
 * argv element is never re-parsed, so `; rm -rf /` is just a filename. Rejecting
 * on content would be security theatre AND would break legitimate values.
 */
export function validateActionParams(
  defs: ActionParamDef[] | undefined,
  input: Record<string, unknown> | undefined,
): ActionParamResult {
  const declared = defs ?? [];
  const supplied = input ?? {};
  const errors: ActionParamError[] = [];
  const values: Record<string, string> = {};

  // Unknown params are rejected rather than ignored: silently dropping them
  // would let a caller believe an option took effect when it did not.
  for (const name of Object.keys(supplied)) {
    if (!declared.some((d) => d.name === name)) {
      errors.push({ param: name, reason: 'unknown parameter' });
    }
  }

  for (const def of declared) {
    const raw = Object.prototype.hasOwnProperty.call(supplied, def.name)
      ? supplied[def.name]
      : undefined;

    const provided = raw !== undefined && raw !== null;
    if (!provided) {
      if (def.default !== undefined) {
        values[def.name] = String(def.default);
        continue;
      }
      if (def.required) {
        errors.push({ param: def.name, reason: 'required' });
        continue;
      }
      values[def.name] = '';
      continue;
    }

    const coerced = coerce(def, raw);
    if ('error' in coerced) {
      errors.push({ param: def.name, reason: coerced.error });
      continue;
    }
    values[def.name] = coerced.value;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, values };
}

function coerce(def: ActionParamDef, raw: unknown): { value: string } | { error: string } {
  switch (def.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return { error: 'expected a number' };
      return { value: String(n) };
    }

    case 'boolean': {
      if (typeof raw === 'boolean') return { value: String(raw) };
      const s = String(raw).trim().toLowerCase();
      if (s === 'true' || s === 'false') return { value: s };
      return { error: 'expected a boolean' };
    }

    case 'enum': {
      const allowed = def.values ?? [];
      const s = String(raw);
      if (!allowed.includes(s)) {
        return { error: `expected one of: ${allowed.join(', ')}` };
      }
      return { value: s };
    }

    case 'string': {
      const s = String(raw);
      if (def.pattern) {
        let re: RegExp;
        try {
          re = anchoredPattern(def.pattern);
        } catch {
          return { error: 'invalid pattern in action definition' };
        }
        if (!re.test(s)) return { error: `does not match pattern ${def.pattern}` };
      }
      return { value: s };
    }

    default:
      return { error: `unsupported parameter type: ${String(def.type)}` };
  }
}

/**
 * Anchors the declared pattern so `pattern: 'main'` means the whole value, not
 * "contains". An unanchored pattern would let `main; whatever` through.
 */
export function anchoredPattern(pattern: string): RegExp {
  const body = pattern.replace(/^\^/, '').replace(/\$$/, '');
  return new RegExp(`^(?:${body})$`);
}
