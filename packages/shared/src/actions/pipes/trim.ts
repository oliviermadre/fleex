import type { PipeFunction } from './types.js';

export const trim: PipeFunction = {
  name: 'trim',
  fn: (value) => value.trim(),
};
