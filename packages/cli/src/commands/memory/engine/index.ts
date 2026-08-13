import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiBase, apiGet, apiPut } from '../../../core/api.ts';
import { die, info, ok, present } from '../../../core/colors.ts';
import { MEMORY_FEATURE_KEYS } from '../_shared.ts';

type FeatureKey = (typeof MEMORY_FEATURE_KEYS)[number];

interface Config {
  memoryEngine?: 'legacy' | 'semantic';
  memoryFeatures?: Partial<Record<FeatureKey, boolean>>;
}

interface EngineOptions {
  enable?: string[];
  disable?: string[];
}

function assertKnown(keys: string[] | undefined): FeatureKey[] {
  for (const key of keys ?? []) {
    if (!MEMORY_FEATURE_KEYS.includes(key as FeatureKey)) {
      die(`Unknown feature "${key}". Expected one of: ${MEMORY_FEATURE_KEYS.join(', ')}`);
    }
  }
  return (keys ?? []) as FeatureKey[];
}

/**
 * Read or change which context engine feeds agent prompts, and which of its
 * features are on.
 *
 * The same switches as Settings › Memory, for the case the panel cannot serve: a
 * headless instance, a script that sets an instance up, or checking from a
 * terminal what a run is about to be given.
 */
const def: CommandDef = {
  workspaceAware: true,
  name: 'engine',
  description: 'Show or change the context engine and its feature switches',
  setup(cmd) {
    cmd.argument('[mode]', 'Engine to use: legacy or semantic (omit to only report)');
    cmd.option('--enable <feature...>', 'Turn these features on');
    cmd.option('--disable <feature...>', 'Turn these features off');
  },
  action: async (mode: string | undefined, opts: EngineOptions) => {
    if (mode && mode !== 'legacy' && mode !== 'semantic') {
      die(`Unknown engine "${mode}". Expected "legacy" or "semantic".`);
    }
    const enable = assertKnown(opts.enable);
    const disable = assertKnown(opts.disable);

    const url = `${apiBase()}/api/config`;
    const config = await apiGet<Config>(url);

    if (mode || enable.length > 0 || disable.length > 0) {
      // The features are merged rather than replaced: PUT overwrites the object
      // wholesale, so sending only the changed keys would silently reset the rest.
      const features = { ...(config.memoryFeatures ?? {}) };
      for (const key of enable) features[key] = true;
      for (const key of disable) features[key] = false;

      await apiPut(url, {
        ...(mode ? { memoryEngine: mode } : {}),
        ...(enable.length > 0 || disable.length > 0 ? { memoryFeatures: features } : {}),
      });
      config.memoryEngine = (mode as Config['memoryEngine']) ?? config.memoryEngine;
      config.memoryFeatures = features;
    }

    const engine = config.memoryEngine ?? 'legacy';

    present(
      { engine, features: Object.fromEntries(MEMORY_FEATURE_KEYS.map((key) => [
        key, engine === 'semantic' && config.memoryFeatures?.[key] !== false,
      ])) },
      () => {
        if (mode) ok(`Engine set to ${mode}.`);
        else info(`Engine: ${chalk.bold(engine)}`);

        for (const key of MEMORY_FEATURE_KEYS) {
          // Absent means on: opting into the engine is already the deliberate
          // choice, so the report shows the effective state, not the stored one.
          const on = config.memoryFeatures?.[key] !== false;
          const effective = engine === 'semantic' && on;
          process.stdout.write(
            `  ${effective ? chalk.green('on ') : chalk.dim('off')} ${key}\n`,
          );
        }
        if (engine !== 'semantic') {
          info('Every feature above needs the semantic engine: fleex memory engine semantic');
        }
      },
    );
  },
};

export default def;
