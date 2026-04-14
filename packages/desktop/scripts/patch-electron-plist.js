/**
 * Patches the Electron.app bundle so macOS shows "Fleex" in the dock,
 * menu bar, and tooltip. Renames the .app bundle and patches Info.plist.
 * Runs as a postinstall hook.
 */
const { execSync } = require('child_process');
const { existsSync, renameSync } = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
const electronApp = path.join(distDir, 'Electron.app');
const fleexApp = path.join(distDir, 'Fleex.app');

// Determine which bundle exists (idempotent — supports re-runs)
let appPath;
if (existsSync(fleexApp)) {
  appPath = fleexApp;
} else if (existsSync(electronApp)) {
  renameSync(electronApp, fleexApp);
  appPath = fleexApp;
  console.log('Renamed Electron.app → Fleex.app');
} else {
  console.log('Electron app bundle not found, skipping patch.');
  process.exit(0);
}

// Patch Info.plist
const plist = path.join(appPath, 'Contents', 'Info.plist');
const patches = {
  CFBundleName: 'Fleex',
  CFBundleDisplayName: 'Fleex',
  CFBundleIdentifier: 'dev.fleex.desktop',
};

for (const [key, value] of Object.entries(patches)) {
  execSync(`plutil -replace "${key}" -string "${value}" "${plist}"`);
}

// Update electron's path.txt so the module can find the renamed binary
const pathTxt = path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt');
if (existsSync(pathTxt)) {
  const { readFileSync, writeFileSync } = require('fs');
  const current = readFileSync(pathTxt, 'utf-8');
  const updated = current.replace('Electron.app', 'Fleex.app');
  if (current !== updated) {
    writeFileSync(pathTxt, updated);
    console.log('Updated electron path.txt → Fleex.app');
  }
}

// Re-register with Launch Services so macOS picks up the change
execSync(`/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "${appPath}"`);

console.log('Patched Fleex.app Info.plist and registered with Launch Services.');
