import type { PipeFunction } from './types.js';

export const defaultPipe: PipeFunction = {
  name: 'default',
  fn: (value, fallback = '') => (value === '' ? fallback : value),
};
