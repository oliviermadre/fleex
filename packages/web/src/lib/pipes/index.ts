import type { PipeFunction } from './types';
import { slug } from './slug';
import { lower } from './lower';
import { upper } from './upper';
import { replace } from './replace';
import { substr } from './substr';
import { trim } from './trim';
import { defaultPipe } from './default';

const pipes = new Map<string, PipeFunction>(
  [slug, lower, upper, replace, substr, trim, defaultPipe].map((p) => [p.name, p]),
);

export function getPipe(name: string): PipeFunction | undefined {
  return pipes.get(name);
}

export type { PipeFunction } from './types';
