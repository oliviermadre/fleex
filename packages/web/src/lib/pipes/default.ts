import type { PipeFunction } from './types';

export const defaultPipe: PipeFunction = {
  name: 'default',
  fn: (value, fallback = '') => (value === '' ? fallback : value),
};
