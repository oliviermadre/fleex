import type { PipeFunction } from './types';

export const substr: PipeFunction = {
  name: 'substr',
  fn: (value, start, length?) => {
    const s = parseInt(start, 10);
    if (length !== undefined) {
      return value.substring(s, s + parseInt(length, 10));
    }
    return value.substring(s);
  },
};
