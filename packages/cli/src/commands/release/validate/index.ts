import path from 'node:path';
import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { die, ok, present, err, warn } from '../../../core/colors.ts';
import { resolveInstance } from '../../../core/instance.ts';
import { validateReleases } from '../_validate.ts';

const def: CommandDef = {
  name: 'validate',
  description: 'Check every release fragment and release in releases/ (schema, images on disk, sizes)',
  setup(cmd) {
    cmd.argument('[dir]', 'releases directory (default: <repo>/releases)');
  },
  extraHelp: `\n${chalk.bold.yellow('Notes:')}
  Exits non-zero on any error; image size above 300 KB is a warning. Format: docs/releases.md.
`,
  action: async (dir: string | undefined) => {
    const root = path.resolve(dir ?? path.join(resolveInstance().repoDir, 'releases'));
    const report = validateReleases(root);
    const errors = report.problems.filter((p) => p.level === 'error');
    present(report, () => {
      for (const p of report.problems) (p.level === 'error' ? err : warn)(`${p.file}: ${p.message}`);
      if (!errors.length) ok(`releases/ is valid: ${report.fragments} fragment(s), ${report.releases} release(s).`);
    });
    if (errors.length) die(`${errors.length} error(s) in ${root}`);
  },
};

export default def;
