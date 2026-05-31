import type { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { MARKETPLACE_SCHEMA_VERSION } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { c, ok, info, warn, die } from '../../../core/colors.ts';
import {
  MARKETPLACES_DIR,
  deriveName,
  git,
  getMarketplace,
  loadManifest,
  upsertMarketplace,
} from '../../../core/registry.ts';

interface AddOptions {
  name?: string;
  force?: boolean;
}

const def: CommandDef = {
  name: 'add',
  description: 'Register a marketplace by cloning its git repository',
  setup(cmd: Command) {
    cmd.argument('<git-url>', 'git URL of the marketplace repository');
    cmd.option('--name <name>', 'local name for the marketplace (default: owner-repo)');
    cmd.option('--force', 're-clone if a marketplace with this name already exists');
  },
  async action(url: string, opts: AddOptions) {
    const name = opts.name || deriveName(url);
    const dest = path.join(MARKETPLACES_DIR, name);

    if (getMarketplace(name) && !opts.force) {
      die(`Marketplace "${name}" is already registered. Use "fleex marketplace update ${name}" or --force.`);
    }

    if (fs.existsSync(dest)) {
      if (!opts.force) die(`Directory ${dest} already exists. Use --force to replace it.`);
      fs.rmSync(dest, { recursive: true, force: true });
    }

    fs.mkdirSync(MARKETPLACES_DIR, { recursive: true });
    info(`Cloning ${c.cyan(url)} …`);
    const cloned = git(['clone', '--depth', '1', url, dest]);
    if (!cloned.ok) {
      die(`git clone failed:\n${cloned.output}\n\nCheck the URL and that you have access (private repos use your git credentials).`);
    }

    // Validate it's actually a marketplace.
    let manifest;
    try {
      manifest = loadManifest(dest);
    } catch (e) {
      fs.rmSync(dest, { recursive: true, force: true });
      die(`${url} is not a fleex marketplace: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (manifest.schemaVersion > MARKETPLACE_SCHEMA_VERSION) {
      warn(`marketplace.json schemaVersion is ${manifest.schemaVersion}; this fleex supports ${MARKETPLACE_SCHEMA_VERSION}. Consider updating fleex.`);
    }

    upsertMarketplace({ name, url, path: dest });
    ok(`Registered "${c.cyan(name)}" — ${manifest.primitives.length} primitive(s) available.`);
    info(`Install with: ${c.bold(`fleex import --marketplace ${name}`)}`);
  },
};

export default def;
