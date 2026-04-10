import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface FleexPaths {
  /** config.json, .env */
  configDir: string;
  /** fleex.db, projects/, sessions.json, files/ */
  dataDir: string;
  /** logs/, run/ */
  stateDir: string;
  /** cloned repo source code */
  libDir: string;
}

/**
 * Resolve fleex directories following the XDG Base Directory Specification.
 *
 * Priority:
 * 1. `FLEEX_HOME` env var → legacy single-directory layout
 * 2. `~/.fleex/` exists and XDG config dir does not → legacy (unmigrated)
 * 3. Otherwise → XDG layout
 */
export function resolvePaths(home: string): FleexPaths {
  const fleexHome = process.env['FLEEX_HOME'];
  if (fleexHome) {
    return {
      configDir: fleexHome,
      dataDir: fleexHome,
      stateDir: fleexHome,
      libDir: join(fleexHome, 'repo'),
    };
  }

  const legacyDir = join(home, '.fleex');
  const xdgConfigDir = join(
    process.env['XDG_CONFIG_HOME'] || join(home, '.config'),
    'fleex',
  );

  if (existsSync(legacyDir) && !existsSync(xdgConfigDir)) {
    return {
      configDir: legacyDir,
      dataDir: legacyDir,
      stateDir: legacyDir,
      libDir: join(legacyDir, 'repo'),
    };
  }

  return {
    configDir: xdgConfigDir,
    dataDir: join(
      process.env['XDG_DATA_HOME'] || join(home, '.local', 'share'),
      'fleex',
    ),
    stateDir: join(
      process.env['XDG_STATE_HOME'] || join(home, '.local', 'state'),
      'fleex',
    ),
    libDir: join(home, '.local', 'lib', 'fleex'),
  };
}
