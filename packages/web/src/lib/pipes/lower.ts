import type { PipeFunction } from './types';

export const lower: PipeFunction = {
  name: 'lower',
  fn: (value) => value.toLowerCase(),
};
