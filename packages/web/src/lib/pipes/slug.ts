import type { PipeFunction } from './types';

export const slug: PipeFunction = {
  name: 'slug',
  fn: (value) =>
    value
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, ''),
};
