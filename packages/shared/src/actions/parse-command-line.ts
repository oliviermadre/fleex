/**
 * POSIX-ish tokenizer used to migrate legacy free-form action strings into a
 * declared `ActionDef`.
 *
 * The goal is NOT to emulate a shell — it is to answer one question: can this
 * string be executed as `execFile(command, argv)` with identical semantics? If
 * anything in it would have been interpreted by the shell (pipes, globs,
 * expansions, …), we say so and the caller falls back to `kind: 'shell'` rather
 * than silently changing what the command does.
 *
 * `{{placeholder}}` runs are preserved verbatim inside the tokens they belong
 * to. Under `execFile` an interpolated value stays a single argv element, so
 * this is safe by construction.
 */

/**
 * Characters that make the shell do something other than word-splitting.
 * `{`/`}` are included, but a `{{…}}` placeholder is recognised first so
 * templates don't spuriously force shell mode.
 */
const SHELL_METACHARS = new Set([
  '|',
  '&',
  ';',
  '<',
  '>',
  '(',
  ')',
  '$',
  '`',
  '*',
  '?',
  '[',
  ']',
  '{',
  '}',
  '~',
  '!',
]);

/** Inside double quotes the shell still expands these — quoting is not enough. */
const DOUBLE_QUOTE_EXPANDING = new Set(['$', '`']);

export interface ParsedCommandLine {
  /** First token; empty when the input has no tokens. */
  command: string;
  /** Remaining tokens, placeholders preserved verbatim. */
  args: string[];
  /**
   * True when the string relies on shell interpretation. Callers must NOT use
   * `command`/`args` in that case — the tokens are a best-effort split that
   * drops the operators.
   */
  needsShell: boolean;
}

export function parseCommandLine(input: string): ParsedCommandLine {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let needsShell = false;

  const flush = () => {
    if (started) {
      tokens.push(current);
      current = '';
      started = false;
    }
  };

  let i = 0;
  while (i < input.length) {
    const c = input[i]!;

    if (c === '\n' || c === '\r') {
      // Multi-line scripts are shell programs, not a single invocation.
      needsShell = true;
      flush();
      i++;
      continue;
    }

    if (c === ' ' || c === '\t') {
      flush();
      i++;
      continue;
    }

    // `{{ … }}` placeholder — copied through untouched.
    if (c === '{' && input[i + 1] === '{') {
      const end = input.indexOf('}}', i + 2);
      if (end !== -1) {
        current += input.slice(i, end + 2);
        started = true;
        i = end + 2;
        continue;
      }
      // Unterminated `{{` — fall through to the metachar branch below.
    }

    // An unquoted `#` at the start of a word begins a comment. Treating it as a
    // literal argument would silently pass `#` and the commentary to the program.
    if (c === '#' && !started) {
      needsShell = true;
      break;
    }

    if (c === '\\') {
      const next = input[i + 1];
      if (next === '\n' || next === '\r') {
        // Line continuation — shell syntax, not a character escape.
        needsShell = true;
        i += 2;
        continue;
      }
      if (next !== undefined) {
        current += next;
        started = true;
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (c === "'") {
      // Single quotes are fully literal, metacharacters included.
      const end = input.indexOf("'", i + 1);
      if (end === -1) {
        current += input.slice(i + 1);
        started = true;
        break;
      }
      current += input.slice(i + 1, end);
      started = true;
      i = end + 1;
      continue;
    }

    if (c === '"') {
      i++;
      started = true;
      while (i < input.length && input[i] !== '"') {
        const ch = input[i]!;
        if (ch === '\\' && input[i + 1] !== undefined) {
          current += input[i + 1];
          i += 2;
          continue;
        }
        // A `{{…}}` inside double quotes is still just a placeholder.
        if (ch === '{' && input[i + 1] === '{') {
          const end = input.indexOf('}}', i + 2);
          if (end !== -1) {
            current += input.slice(i, end + 2);
            i = end + 2;
            continue;
          }
        }
        // Double quotes suppress word-splitting and globbing, but NOT parameter
        // or command substitution — `"$HOME"` still expands, so it needs a shell.
        if (DOUBLE_QUOTE_EXPANDING.has(ch)) needsShell = true;
        current += ch;
        i++;
      }
      i++; // closing quote (or end of input)
      continue;
    }

    if (SHELL_METACHARS.has(c)) {
      needsShell = true;
      current += c;
      started = true;
      i++;
      continue;
    }

    current += c;
    started = true;
    i++;
  }

  flush();

  const command = tokens[0] ?? '';

  // `FOO=bar cmd …` is a shell environment prefix, not a program name. Left
  // alone it would make `execFile` look for a binary literally called `FOO=bar`.
  if (!needsShell && ENV_ASSIGNMENT.test(command)) needsShell = true;

  return {
    command,
    args: tokens.slice(1),
    needsShell,
  };
}

/** A leading `NAME=` token, i.e. a shell variable assignment prefix. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

export interface ExtractedPlaceholders {
  /** The original string with each placeholder replaced by a positional `$n`. */
  script: string;
  /** The `{{…}}` expressions, in order of appearance; index 0 becomes `$1`. */
  positional: string[];
}

/**
 * Rewrites `{{expr}}` occurrences into shell positional parameters so a legacy
 * one-liner keeps working as `kind: 'shell'` without any dynamic value ever
 * being concatenated into the script text.
 *
 * The substitution form depends on the surrounding quoting so the result is
 * always a single, unsplit word:
 *   - unquoted        → `"$1"`
 *   - inside `"…"`    → `$1`      (already protected by the enclosing quotes)
 *   - inside `'…'`    → `'"$1"'`  (leave the literal run, expand, re-enter it)
 */
export function extractPlaceholders(input: string): ExtractedPlaceholders {
  const positional: string[] = [];
  let script = '';
  let inSingle = false;
  let inDouble = false;

  let i = 0;
  while (i < input.length) {
    const c = input[i]!;

    if (c === '\\' && !inSingle && input[i + 1] !== undefined) {
      script += c + input[i + 1];
      i += 2;
      continue;
    }

    if (c === '{' && input[i + 1] === '{') {
      const end = input.indexOf('}}', i + 2);
      if (end !== -1) {
        positional.push(input.slice(i, end + 2));
        const n = positional.length;
        if (inSingle) {
          // Close the literal run, expand, then re-open it.
          script += `'"$${n}"'`;
        } else if (inDouble) {
          // Already inside quotes — adding more would end the quoted run and
          // re-expose the value to word splitting.
          script += `$${n}`;
        } else {
          script += `"$${n}"`;
        }
        i = end + 2;
        continue;
      }
    }

    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
      script += c;
      i++;
      continue;
    }

    if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      script += c;
      i++;
      continue;
    }

    script += c;
    i++;
  }

  return { script, positional };
}
