import type { PipeFunction } from './types.js';

export const replace: PipeFunction = {
  name: 'replace',
  fn: (value, search, replacement = '') => value.replaceAll(search, replacement),
};
