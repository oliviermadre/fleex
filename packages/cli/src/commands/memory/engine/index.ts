import chalk from 'chalk';
import type { CommandDef } from '../../../core/types.ts';
import { apiBase, apiGet, apiPut } from '../../../core/api.ts';
import { die, info, ok, present } from '../../../core/colors.ts';
import {
  CLI_DEFAULT_EMBEDDING_MODEL as DEFAULT_EMBEDDING_MODEL,
  CLI_EMBEDDING_MODELS as EMBEDDING_MODELS,
  MEMORY_FEATURE_KEYS,
} from '../_shared.ts';

type FeatureKey = (typeof MEMORY_FEATURE_KEYS)[number];

interface Config {
  memoryEngine?: 'legacy' | 'semantic';
  memoryFeatures?: Partial<Record<FeatureKey, boolean>>;
  memoryEmbeddingModel?: string;
  memoryEmbeddingProvider?: 'transformers' | 'ollama';
  memoryInjectionCharBudget?: number;
  memoryShadowMode?: boolean;
}

interface EngineOptions {
  enable?: string[];
  disable?: string[];
  model?: string;
  runtime?: string;
  budget?: string;
  shadow?: boolean;
  noShadow?: boolean;
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
    cmd.option('--model <id>', `Encoder to use (${EMBEDDING_MODELS.map((m) => m.label).join(', ')})`);
    cmd.option('--runtime <where>', 'Where embeddings run: transformers (in-process) or ollama');
    cmd.option('--budget <chars>', 'Character ceiling on injected memory (500-60000)');
    cmd.option('--shadow', 'Under the current engine, record what the semantic engine would have injected');
    cmd.option('--no-shadow', 'Stop recording the comparison');
  },
  action: async (mode: string | undefined, opts: EngineOptions) => {
    if (mode && mode !== 'legacy' && mode !== 'semantic') {
      die(`Unknown engine "${mode}". Expected "legacy" or "semantic".`);
    }
    const enable = assertKnown(opts.enable);
    const disable = assertKnown(opts.disable);

    // Accepted by label as well as by id: nobody wants to type an org-prefixed
    // Hugging Face path to switch encoder.
    const model = opts.model
      ? EMBEDDING_MODELS.find((m) => m.id === opts.model || m.label === opts.model)
      : undefined;
    if (opts.model && !model) {
      die(`Unknown model "${opts.model}". Expected one of: ${EMBEDDING_MODELS.map((m) => m.label).join(', ')}`);
    }

    if (opts.runtime && opts.runtime !== 'transformers' && opts.runtime !== 'ollama') {
      die(`Unknown runtime "${opts.runtime}". Expected "transformers" or "ollama".`);
    }

    let budget: number | undefined;
    if (opts.budget !== undefined) {
      budget = Number.parseInt(opts.budget, 10);
      if (!Number.isFinite(budget) || budget < 500 || budget > 60_000) {
        die('--budget must be between 500 and 60000 characters.');
      }
    }

    const url = `${apiBase()}/api/config`;
    const config = await apiGet<Config>(url);

    // Commander sets `shadow` to false for `--no-shadow`, so presence and value
    // both have to be read to tell "asked to turn it off" from "not mentioned".
    const shadow = opts.shadow === false ? false : opts.shadow === true ? true : undefined;
    const changed = mode || enable.length > 0 || disable.length > 0 || model || opts.runtime
      || budget || shadow !== undefined;
    if (changed) {
      // The features are merged rather than replaced: PUT overwrites the object
      // wholesale, so sending only the changed keys would silently reset the rest.
      const features = { ...(config.memoryFeatures ?? {}) };
      for (const key of enable) features[key] = true;
      for (const key of disable) features[key] = false;

      await apiPut(url, {
        ...(mode ? { memoryEngine: mode } : {}),
        ...(enable.length > 0 || disable.length > 0 ? { memoryFeatures: features } : {}),
        ...(model ? { memoryEmbeddingModel: model.id } : {}),
        ...(opts.runtime ? { memoryEmbeddingProvider: opts.runtime } : {}),
        ...(budget ? { memoryInjectionCharBudget: budget } : {}),
        ...(shadow !== undefined ? { memoryShadowMode: shadow } : {}),
      });
      config.memoryEngine = (mode as Config['memoryEngine']) ?? config.memoryEngine;
      config.memoryFeatures = features;
      if (model) config.memoryEmbeddingModel = model.id;
      if (opts.runtime) config.memoryEmbeddingProvider = opts.runtime as Config['memoryEmbeddingProvider'];
      if (budget) config.memoryInjectionCharBudget = budget;
      if (shadow !== undefined) config.memoryShadowMode = shadow;
    }

    const engine = config.memoryEngine ?? 'legacy';

    const activeModel = EMBEDDING_MODELS.find((m) => m.id === config.memoryEmbeddingModel)
      ?? DEFAULT_EMBEDDING_MODEL;
    const runtime = config.memoryEmbeddingProvider ?? 'transformers';

    present(
      {
        engine,
        model: activeModel.id,
        dimensions: activeModel.dimensions,
        runtime,
        injectionCharBudget: config.memoryInjectionCharBudget ?? null,
        shadowMode: config.memoryShadowMode === true,
        features: Object.fromEntries(MEMORY_FEATURE_KEYS.map((key) => [
          key, engine === 'semantic' && config.memoryFeatures?.[key] !== false,
        ])),
      },
      () => {
        if (mode) ok(`Engine set to ${mode}.`);
        else info(`Engine: ${chalk.bold(engine)}`);
        info(`Encoder: ${chalk.bold(activeModel.label)} (${activeModel.dimensions} dims, ${runtime})`);
        if (model || opts.runtime) {
          info('Restart the instance to load it; the index re-embeds itself in the background.');
        }
        info(`Injection budget: ${config.memoryInjectionCharBudget ?? 'default (10000)'} characters`);
        if (engine === 'legacy') {
          info(`Shadow comparison: ${config.memoryShadowMode ? 'on' : 'off'}`);
        }
        process.stdout.write('\n');

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
