import type { PipeFunction } from './types';

export const trim: PipeFunction = {
  name: 'trim',
  fn: (value) => value.trim(),
};
