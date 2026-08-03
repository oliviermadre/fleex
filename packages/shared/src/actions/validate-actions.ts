import {
  ACTION_CONTEXT_VARIABLES,
  ACTION_PARAM_NAME_RE,
  ACTION_TIMEOUT_MAX_MS,
  ACTION_TIMEOUT_MIN_MS,
} from '../types/action.js';
import type { ActionDef, ActionKind, ActionParamType, ActionScope } from '../types/action.js';
import { anchoredPattern } from './action-params.js';
import { templateVariables } from './template.js';

export interface ActionDefError {
  /** Dotted path of the offending field, e.g. `actions[1].params[0].name`. */
  field: string;
  reason: string;
}

const KINDS: ActionKind[] = ['url', 'exec', 'shell'];
const SCOPES: ActionScope[] = ['global', 'workspace'];
const PARAM_TYPES: ActionParamType[] = ['string', 'number', 'boolean', 'enum'];
const ICON_TYPES = ['svg', 'base64', 'path', 'url'];

/**
 * Guards the only door into the registry (`PUT /api/config`).
 *
 * Note the threat model: the config author is trusted (they can legitimately
 * declare `command: 'rm'`). What we prevent here is a *malformed* definition —
 * in particular a `command`/`script` carrying a placeholder, which is the one
 * shape that would let a runtime value be spliced into the executable itself.
 */
export function validateActionDefs(input: unknown): ActionDefError[] {
  if (!Array.isArray(input)) {
    return [{ field: 'actions', reason: 'expected an array' }];
  }

  const errors: ActionDefError[] = [];
  const seenIds = new Set<string>();

  input.forEach((raw, index) => {
    const at = `actions[${index}]`;

    if (typeof raw !== 'object' || raw === null) {
      errors.push({ field: at, reason: 'expected an object' });
      return;
    }
    const action = raw as Partial<ActionDef>;

    if (typeof action.id !== 'string' || action.id.trim() === '') {
      errors.push({ field: `${at}.id`, reason: 'required, non-empty string' });
    } else if (seenIds.has(action.id)) {
      errors.push({ field: `${at}.id`, reason: `duplicate id: ${action.id}` });
    } else {
      seenIds.add(action.id);
    }

    if (typeof action.label !== 'string' || action.label.trim() === '') {
      errors.push({ field: `${at}.label`, reason: 'required, non-empty string' });
    }

    if (!SCOPES.includes(action.scope as ActionScope)) {
      errors.push({ field: `${at}.scope`, reason: `expected one of: ${SCOPES.join(', ')}` });
    }

    if (action.iconType !== undefined && !ICON_TYPES.includes(action.iconType)) {
      errors.push({ field: `${at}.iconType`, reason: `expected one of: ${ICON_TYPES.join(', ')}` });
    }

    if (!KINDS.includes(action.kind as ActionKind)) {
      errors.push({ field: `${at}.kind`, reason: `expected one of: ${KINDS.join(', ')}` });
      return; // Per-kind checks below are meaningless without a valid kind.
    }

    const paramNames = validateParams(action, at, errors);
    const knownVariables = new Set<string>([...ACTION_CONTEXT_VARIABLES, ...paramNames]);

    if (action.timeoutMs !== undefined) {
      if (typeof action.timeoutMs !== 'number' || !Number.isFinite(action.timeoutMs)) {
        errors.push({ field: `${at}.timeoutMs`, reason: 'expected a number' });
      } else if (
        action.timeoutMs < ACTION_TIMEOUT_MIN_MS ||
        action.timeoutMs > ACTION_TIMEOUT_MAX_MS
      ) {
        errors.push({
          field: `${at}.timeoutMs`,
          reason: `expected between ${ACTION_TIMEOUT_MIN_MS} and ${ACTION_TIMEOUT_MAX_MS}`,
        });
      }
    }

    switch (action.kind) {
      case 'url':
        if (typeof action.url !== 'string' || action.url.trim() === '') {
          errors.push({ field: `${at}.url`, reason: 'required for kind=url' });
        }
        break;

      case 'exec':
        if (typeof action.command !== 'string' || action.command.trim() === '') {
          errors.push({ field: `${at}.command`, reason: 'required for kind=exec' });
        } else if (action.command.includes('{{')) {
          errors.push({
            field: `${at}.command`,
            reason: 'must be a literal — put dynamic values in args',
          });
        }
        break;

      case 'shell':
        if (typeof action.script !== 'string' || action.script.trim() === '') {
          errors.push({ field: `${at}.script`, reason: 'required for kind=shell' });
        } else if (action.script.includes('{{')) {
          errors.push({
            field: `${at}.script`,
            reason: 'must be a literal — put dynamic values in args and read them as $1, $2, …',
          });
        }
        break;
    }

    if (action.args !== undefined) {
      if (!Array.isArray(action.args)) {
        errors.push({ field: `${at}.args`, reason: 'expected an array of strings' });
      } else {
        action.args.forEach((arg, argIndex) => {
          if (typeof arg !== 'string') {
            errors.push({ field: `${at}.args[${argIndex}]`, reason: 'expected a string' });
            return;
          }
          checkPlaceholders(arg, `${at}.args[${argIndex}]`, knownVariables, errors);
        });
      }
    }

    if (action.cwd !== undefined) {
      if (typeof action.cwd !== 'string') {
        errors.push({ field: `${at}.cwd`, reason: 'expected a string' });
      } else {
        checkPlaceholders(action.cwd, `${at}.cwd`, knownVariables, errors);
      }
    }
  });

  return errors;
}

function validateParams(
  action: Partial<ActionDef>,
  at: string,
  errors: ActionDefError[],
): string[] {
  if (action.params === undefined) return [];
  if (!Array.isArray(action.params)) {
    errors.push({ field: `${at}.params`, reason: 'expected an array' });
    return [];
  }

  const names: string[] = [];
  action.params.forEach((param, index) => {
    const paramAt = `${at}.params[${index}]`;
    if (typeof param !== 'object' || param === null) {
      errors.push({ field: paramAt, reason: 'expected an object' });
      return;
    }

    if (typeof param.name !== 'string' || !ACTION_PARAM_NAME_RE.test(param.name)) {
      errors.push({
        field: `${paramAt}.name`,
        reason: `must match ${ACTION_PARAM_NAME_RE.source}`,
      });
    } else if (names.includes(param.name)) {
      errors.push({ field: `${paramAt}.name`, reason: `duplicate parameter: ${param.name}` });
    } else {
      names.push(param.name);
    }

    if (!PARAM_TYPES.includes(param.type)) {
      errors.push({ field: `${paramAt}.type`, reason: `expected one of: ${PARAM_TYPES.join(', ')}` });
      return;
    }

    if (param.type === 'enum' && (!Array.isArray(param.values) || param.values.length === 0)) {
      errors.push({ field: `${paramAt}.values`, reason: 'required and non-empty for type=enum' });
    }

    if (param.pattern !== undefined) {
      if (typeof param.pattern !== 'string') {
        errors.push({ field: `${paramAt}.pattern`, reason: 'expected a string' });
      } else {
        try {
          anchoredPattern(param.pattern);
        } catch {
          errors.push({ field: `${paramAt}.pattern`, reason: 'not a valid regular expression' });
        }
      }
    }
  });

  return names;
}

function checkPlaceholders(
  template: string,
  field: string,
  known: Set<string>,
  errors: ActionDefError[],
): void {
  for (const variable of templateVariables(template)) {
    if (!known.has(variable)) {
      errors.push({ field, reason: `unknown template variable: ${variable}` });
    }
  }
}
