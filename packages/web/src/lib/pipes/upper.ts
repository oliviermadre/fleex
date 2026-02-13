import type { PipeFunction } from './types';

export const upper: PipeFunction = {
  name: 'upper',
  fn: (value) => value.toUpperCase(),
};
