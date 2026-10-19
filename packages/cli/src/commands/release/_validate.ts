import fs from 'node:fs';
import path from 'node:path';
import { parseReleaseEntry, parseReleaseHeader } from '@fleex/shared';

/** Above this a screenshot weighs on the repo and on Slack. A warning, not an error. */
export const MAX_IMAGE_BYTES = 300 * 1024;

export interface ReleaseProblem { file: string; level: 'error' | 'warning'; message: string }
export interface ValidationReport { fragments: number; releases: number; problems: ReleaseProblem[] }

function checkDir(root: string, dir: string, report: ValidationReport): void {
  const rel = (p: string) => path.relative(root, p);
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'release.md').sort()) {
    const file = path.join(dir, name);
    report.fragments++;
    const parsed = parseReleaseEntry(name.replace(/\.md$/, ''), fs.readFileSync(file, 'utf8'));
    if (!parsed.ok) {
      for (const message of parsed.errors) report.problems.push({ file: rel(file), level: 'error', message });
      continue;
    }
    for (const img of parsed.value.images) {
      for (const src of [img.src, img.light].filter((s): s is string => !!s)) {
        const p = path.join(dir, src);
        if (!fs.existsSync(p)) {
          report.problems.push({ file: rel(file), level: 'error', message: `image not found: ${src}` });
        } else if (fs.statSync(p).size > MAX_IMAGE_BYTES) {
          report.problems.push({ file: rel(file), level: 'warning', message: `${src} is ${Math.round(fs.statSync(p).size / 1024)} KB (> 300 KB)` });
        }
      }
    }
  }
}

/**
 * Validate `releases/`: every fragment (front-matter schema + images on disk)
 * in `unreleased/` and in each `<N>/`, and each `<N>/release.md` header.
 */
export function validateReleases(root: string): ValidationReport {
  const report: ValidationReport = { fragments: 0, releases: 0, problems: [] };
  if (!fs.existsSync(root)) {
    report.problems.push({ file: root, level: 'error', message: 'releases/ does not exist' });
    return report;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    if (entry.name === 'unreleased') {
      checkDir(root, dir, report);
      continue;
    }
    if (!/^\d+$/.test(entry.name)) {
      report.problems.push({ file: entry.name, level: 'error', message: 'a release directory is named by its number (e.g. 25) or "unreleased"' });
      continue;
    }
    report.releases++;
    const headerFile = path.join(dir, 'release.md');
    if (!fs.existsSync(headerFile)) {
      report.problems.push({ file: path.relative(root, dir), level: 'error', message: 'missing release.md (number, date, title)' });
    } else {
      const h = parseReleaseHeader(fs.readFileSync(headerFile, 'utf8'));
      if (!h.ok) for (const message of h.errors) report.problems.push({ file: path.relative(root, headerFile), level: 'error', message });
      else if (h.value.number !== Number(entry.name)) {
        report.problems.push({ file: path.relative(root, headerFile), level: 'error', message: `number ${h.value.number} does not match the directory ${entry.name}` });
      }
    }
    checkDir(root, dir, report);
  }
  return report;
}
