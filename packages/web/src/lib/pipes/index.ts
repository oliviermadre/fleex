import { defaultPipe } from './default';
import { lower } from './lower';
import { replace } from './replace';
import { slug } from './slug';
import { substr } from './substr';
import { trim } from './trim';
import { upper } from './upper';

import type { PipeFunction } from './types';

const pipes = new Map<string, PipeFunction>(
  [slug, lower, upper, replace, substr, trim, defaultPipe].map((p) => [p.name, p]),
);

export function getPipe(name: string): PipeFunction | undefined {
  return pipes.get(name);
}

export type { PipeFunction } from './types';
