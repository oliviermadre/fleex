import { readFileSync } from 'node:fs';
import { ANNOTATION_TONES, isAnnotationTone } from '@fleex/shared';
import type { AnnotationTone } from '@fleex/shared';
import { die } from '../../../core/colors.ts';

export function assertValidTone(t: string): asserts t is AnnotationTone {
  if (!isAnnotationTone(t)) die(`Invalid tone: ${t} (valid: ${ANNOTATION_TONES.join(', ')})`);
}

/** The body from --body or --body-file (at most one); undefined when neither is given. */
export function resolveBody(opts: { body?: string; bodyFile?: string }): string | undefined {
  if (opts.body !== undefined && opts.bodyFile !== undefined) die('Use either --body or --body-file, not both.');
  if (opts.body !== undefined) return opts.body;
  if (opts.bodyFile === undefined) return undefined;
  try {
    return readFileSync(opts.bodyFile, 'utf8');
  } catch (e) {
    die(`Cannot read --body-file ${opts.bodyFile}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
