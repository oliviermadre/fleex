import type { PipeFunction } from './types.js';

export const slug: PipeFunction = {
  name: 'slug',
  fn: (value) =>
    value
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
};
