import type { PipeFunction } from './types';

export const replace: PipeFunction = {
  name: 'replace',
  fn: (value, search, replacement = '') => value.replaceAll(search, replacement),
};
