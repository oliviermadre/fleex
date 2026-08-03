import type { PipeFunction } from './types.js';

export const lower: PipeFunction = {
  name: 'lower',
  fn: (value) => value.toLowerCase(),
};
