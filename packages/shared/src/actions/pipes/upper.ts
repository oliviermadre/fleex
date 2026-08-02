import type { PipeFunction } from './types.js';

export const upper: PipeFunction = {
  name: 'upper',
  fn: (value) => value.toUpperCase(),
};
