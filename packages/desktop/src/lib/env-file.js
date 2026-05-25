/**
 * Minimal .env file parser. Supports:
 *   - KEY=VALUE
 *   - KEY="VALUE"      (preserves leading/trailing spaces, strips quotes)
 *   - KEY='VALUE'
 *   - comments starting with #
 *   - blank lines
 *   - trailing inline comments only for unquoted values (`KEY=foo # comment`)
 *   - export KEY=VALUE
 *
 * NOT a full dotenv replacement — no multi-line, no shell expansion.
 * Kept dependency-free so it works in both Electron main and Node server.
 */

const fs = require('node:fs');

/**
 * @param {string} content
 * @returns {Record<string, string>}
 */
function parseEnvFile(content) {
  /** @type {Record<string, string>} */
  const out = {};
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    // strip `export ` prefix
    const stripped = line.startsWith('export ') ? line.slice('export '.length).trimStart() : line;

    const eq = stripped.indexOf('=');
    if (eq === -1) continue;

    const key = stripped.slice(0, eq).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    let value = stripped.slice(eq + 1);
    // trim leading whitespace only — quoted values may have meaningful trailing space
    value = value.replace(/^[\t ]+/, '');

    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      const end = findClosingQuote(value, quote);
      if (end === -1) {
        // malformed — skip
        continue;
      }
      out[key] = unescapeQuoted(value.slice(1, end));
      continue;
    }

    // unquoted — strip trailing inline comment (` # ...`) and trailing whitespace
    const hashIdx = findUnquotedHash(value);
    if (hashIdx !== -1) value = value.slice(0, hashIdx);
    out[key] = value.trimEnd();
  }
  return out;
}

/**
 * Read and parse a .env file. Returns {} if file doesn't exist or fails to read.
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
function readEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return parseEnvFile(content);
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    return {};
  }
}

/**
 * Serialize an object to a .env file string. Quotes values that contain
 * whitespace, `#`, `=`, or start with a quote. Always overwrites — does not
 * preserve comments from a previous file.
 * @param {Record<string, string>} obj
 * @returns {string}
 */
function serializeEnvFile(obj) {
  const lines = [];
  for (const key of Object.keys(obj)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = String(obj[key] ?? '');
    if (needsQuoting(value)) {
      lines.push(`${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  return lines.join('\n') + '\n';
}

/**
 * Merge `updates` into existing env file at `filePath` (read → merge → write).
 * Creates parent dirs and writes with mode 0600.
 * @param {string} filePath
 * @param {Record<string, string>} updates
 */
function updateEnvFile(filePath, updates) {
  const path = require('node:path');
  const existing = readEnvFile(filePath);
  const merged = { ...existing, ...updates };
  // Drop keys whose value was explicitly set to empty string — caller can use this to delete a key.
  for (const k of Object.keys(updates)) {
    if (updates[k] === '') delete merged[k];
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeEnvFile(merged), { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best effort on macOS/Linux; ignored on Windows
  }
}

function unescapeQuoted(s) {
  // Mirrors serializeEnvFile: only `\\` and `\"` (or `\'`) are special.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      const next = s[i + 1];
      if (next === '\\' || next === '"' || next === "'") {
        out += next;
        i += 1;
        continue;
      }
    }
    out += s[i];
  }
  return out;
}

function findClosingQuote(value, quote) {
  for (let i = 1; i < value.length; i++) {
    if (value[i] === '\\') {
      i += 1; // skip escaped char
      continue;
    }
    if (value[i] === quote) return i;
  }
  return -1;
}

function findUnquotedHash(value) {
  // Returns index of `#` preceded by whitespace, or -1
  for (let i = 0; i < value.length; i++) {
    if (value[i] === '#' && (i === 0 || /\s/.test(value[i - 1]))) return i;
  }
  return -1;
}

function needsQuoting(v) {
  if (v === '') return false;
  return /[\s#"'=]/.test(v) || v.startsWith(' ') || v.endsWith(' ');
}

module.exports = { parseEnvFile, readEnvFile, serializeEnvFile, updateEnvFile };
