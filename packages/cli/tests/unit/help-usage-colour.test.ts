import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import chalk from 'chalk';
import { colourUsage } from '../../src/core/help.ts';

// Chalk emits nothing when it thinks nobody is watching, and the defect only
// exists once escapes are in the string — so the test has to ask for colour.
let level: typeof chalk.level;
beforeAll(() => {
  level = chalk.level;
  chalk.level = 3;
});
afterAll(() => {
  chalk.level = level;
});

const ESC = '';

/**
 * `fleex --help` printed `fleex [2m[options][22m [command]`.
 *
 * Styling ran in three passes: dim `[command]`, dim `[options]`, then colour
 * every remaining bracketed token. The third pass re-read what the first two had
 * written, and in `\x1b[2m[options]` the `[` of the escape sequence opens a
 * bracket as validly as any other — so the match started inside the escape, `[2m`
 * was coloured as if it were text, and the ESC was stranded ahead of it where the
 * terminal had nothing to do with it.
 */
describe('colourUsage', () => {
  it('never leaves an escape sequence in the visible text', () => {
    const out = colourUsage('[options] [command]');
    // Strip every escape and the visible text must be exactly what came in. When
    // a pass matched inside an escape, `[2m` survived this strip as text.
    expect(out.replace(new RegExp(`${ESC}\\[\\d+m`, 'g'), '')).toBe('[options] [command]');
  });

  it('never strands an ESC with nothing after it', () => {
    // The stranded ESC is the other half of the symptom: `^[^[[35m`.
    expect(colourUsage('[options] [command]')).not.toMatch(new RegExp(`${ESC}${ESC}`));
  });

  it('dims the structural placeholders', () => {
    const out = colourUsage('[options] [command]');
    expect(out).toBe(`${chalk.dim('[options]')} ${chalk.dim('[command]')}`);
  });

  it('colours a real argument differently from a placeholder', () => {
    // `<ticket>` is something the reader must supply; `[options]` is not.
    const out = colourUsage('[options] <ticket> [mentions...]');
    expect(out).toBe(
      `${chalk.dim('[options]')} ${chalk.magenta('<ticket>')} ${chalk.magenta('[mentions...]')}`,
    );
  });

  it('leaves a usage line with no tokens untouched', () => {
    expect(colourUsage('fleex')).toBe('fleex');
  });

  it('survives a bracket that never closes', () => {
    expect(colourUsage('[unclosed')).toBe('[unclosed');
  });

  it('does not corrupt text it has already styled', () => {
    // The property that actually failed. A second pass re-applies the same dim
    // pair, which renders identically — what must never happen again is an
    // escape being swallowed into the visible text. Nothing calls this twice
    // today; the guarantee is that the scan is safe on styled input, which is
    // exactly what the three passes were not.
    const twice = colourUsage(colourUsage('[options] <ticket>'));
    expect(twice.replace(new RegExp(`${ESC}\\[\\d+m`, 'g'), '')).toBe('[options] <ticket>');
    expect(twice).not.toMatch(new RegExp(`${ESC}${ESC}`));
  });
});
