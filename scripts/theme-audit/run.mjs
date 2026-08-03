/**
 * One-command theme contrast sweep (ticket #395, lot 4).
 *
 *   bun run audit:theme                      # sweep light + verdant on AUDIT_BASE
 *   AUDIT_BASE=http://localhost:PORT bun run audit:theme
 *   bun run audit:theme -- --seed            # seed the kitchen-sink board first
 *   bun run audit:theme -- --themes light    # restrict themes
 *   bun run audit:theme -- --out ./my-out
 *
 * Gate (exit 1 on failure):
 *   - any COLORED text/background pair below 4.5:1 fails;
 *   - achromatic (gray) pairs are "assumed faint" and must stay >= 3:1 —
 *     between 3 and 4.5 they are reported as warnings only.
 *
 * The sweep never writes to the target DB (GET /api/config is intercepted,
 * PUT blocked). Point AUDIT_BASE at a throwaway instance when using --seed:
 *   ./cli/fleex start --workspace sqlite
 */
import { sweep } from './audit.mjs';
import { seedKitchenSink } from './seed-kitchen-sink.mjs';

const args = process.argv.slice(2);
function flag(name) {
  return args.includes(name);
}
function opt(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const base = (opt('--base', process.env.AUDIT_BASE) || '').replace(/\/$/, '');
const themes = opt('--themes', 'light,verdant')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const outRoot = opt('--out', process.env.AUDIT_OUT || './theme-audit-out');

if (!base) {
  console.error(
    'No target instance. Set AUDIT_BASE (or --base) to the web URL of a running instance:\n' +
      '  ./cli/fleex start --workspace sqlite   # throwaway sqlite instance\n' +
      '  AUDIT_BASE=http://localhost:<web-port> bun run audit:theme -- --seed',
  );
  process.exit(2);
}

// Reachability check with a clear failure message.
try {
  await fetch(`${base}/api/tickets`, { signal: AbortSignal.timeout(5000) });
} catch {
  console.error(`Cannot reach ${base} — is the stack running?`);
  process.exit(2);
}

if (flag('--seed')) {
  console.log(`Seeding kitchen-sink board on ${base} ...`);
  await seedKitchenSink(base);
}

/** Achromatic = assumed-faint gray (threshold 3:1 instead of 4.5:1). */
function isGrayPair(pair) {
  const m = pair.color.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
  if (!m) return false;
  const [r, g, b] = [+m[1], +m[2], +m[3]];
  return Math.max(r, g, b) - Math.min(r, g, b) <= 24;
}

let failures = 0;
let warnings = 0;
for (const theme of themes) {
  console.log(`\n=== Sweep: ${theme} (${base}) ===`);
  const { pairs } = await sweep({ base, theme, out: `${outRoot}/${theme}` });
  for (const p of pairs) {
    const gray = isGrayPair(p);
    if (gray && p.ratio >= 3) {
      warnings++;
      console.log(
        `  WARN  ${p.ratio.toFixed(2)}:1 (assumed faint) ${p.color} on ${p.bg} — "${p.text}" [${p.screens}]`,
      );
    } else {
      failures++;
      console.log(
        `  FAIL  ${p.ratio.toFixed(2)}:1 ${p.color} on ${p.bg} — "${p.text}" [${p.screens}]`,
      );
    }
  }
}

console.log(
  `\nContrast gate: ${failures} failure(s), ${warnings} assumed-faint warning(s) → ${outRoot}/ (screenshots + findings.json + aggregated.json)`,
);
process.exit(failures > 0 ? 1 : 0);
