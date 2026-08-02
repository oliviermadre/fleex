import type { PipeFunction } from './types.js';
import { slug } from './slug.js';
import { lower } from './lower.js';
import { upper } from './upper.js';
import { replace } from './replace.js';
import { substr } from './substr.js';
import { trim } from './trim.js';
import { defaultPipe } from './default.js';

const pipes = new Map<string, PipeFunction>(
  [slug, lower, upper, replace, substr, trim, defaultPipe].map((p) => [p.name, p]),
);

export function getPipe(name: string): PipeFunction | undefined {
  return pipes.get(name);
}

export type { PipeFunction } from './types.js';
