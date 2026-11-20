#!/usr/bin/env node
/** Install, inspect, or remove the one-per-user automatic remote watcher. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const action = process.argv[2] || 'status';
const launchLabel = 'com.dormcheck.remote-watch';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watcher = join(root, 'scripts', 'remote-awareness.mjs');
const quote = (value) => `"${value.replaceAll('"', '\\"')}"`;
// A path segment that looks like a release version: .../Cellar/node/26.0.0/...
// or .../nvm/versions/node/v26.0.0/.... Baking one of those into a login-time
// launcher means the next Node upgrade silently deletes the watcher's binary.
const VERSIONED_SEGMENT = /[\\/][^\\/]*\d+\.\d+\.\d+[^\\/]*[\\/]/;
let resolvedNode;

function run(command, args, { allowFailure = false } = {}) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    if (allowFailure) return '';
    throw new Error(error.stderr?.toString().trim() || error.message);
  }
}

/**
 * A Node path safe to bake into a login-time launcher: stable across upgrades,
 * still on the same major as the Node running this install.
 */
function stableNodePath() {
  if (resolvedNode) return resolvedNode;
  const candidates = process.platform === 'win32'
    ? run('where', ['node'], { allowFailure: true }).split(/\r?\n/)
    : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', run('which', ['node'], { allowFailure: true })];
  const major = process.version.split('.')[0];
  for (const candidate of candidates.map((value) => value.trim()).filter(Boolean)) {
    if (VERSIONED_SEGMENT.test(candidate)) continue;
    if (!existsSync(candidate)) continue;
    if (run(candidate, ['--version'], { allowFailure: true }).trim().split('.')[0] !== major) continue;
    resolvedNode = candidate;
    return resolvedNode;
  }
  console.error(`WARNING: no version-stable node found; using ${process.execPath}. The watcher may break on a Node upgrade.`);
  resolvedNode = process.execPath;
  return resolvedNode;
}

function windowsLogPath() {
  return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Dormcheck', 'remote-watch.log');
}

function windowsLauncherPath() {
  const roaming = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  return join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Dormcheck Remote Watch.vbs');
}

function legacyWindowsLauncherPath() {
  return windowsLauncherPath().replace(/\.vbs$/i, '.cmd');
}

function installWindows() {
  const log = windowsLogPath();
  const launcher = windowsLauncherPath();
  mkdirSync(dirname(log), { recursive: true });
  mkdirSync(dirname(launcher), { recursive: true });
  // Run the login command through Windows Script Host with window style 0
  // (hidden). A visible .cmd launcher makes a terminal flash whenever Git
  // refreshes, which is unacceptable for a background monitor.
  const command = `${quote(stableNodePath())} ${quote(watcher)} watch --repo ${quote(root)} >> ${quote(log)} 2>&1`;
  const vbsCommand = command.replaceAll('"', '""');
  writeFileSync(launcher, `Set shell = CreateObject("WScript.Shell")\r\nshell.Run "cmd.exe /d /s /c ""${vbsCommand}""", 0, False\r\n`);
  rmSync(legacyWindowsLauncherPath(), { force: true });
  // Use the same GUI-hosted launcher immediately and at next sign-in. Starting
  // Node directly can still let Git create a flashing console on some Windows
  // hosts; wscript.exe has no console and the VBS requests window style 0.
  run('wscript.exe', [launcher]);
  console.log('Installed one Windows Startup-folder watcher.');
  console.log(`Launcher: ${launcher}`);
  console.log(`Watcher log: ${log}`);
}

function warnIfNodeMissing(recorded) {
  if (recorded && !existsSync(recorded)) {
    console.log(`WARNING: recorded node binary is missing: ${recorded}. Run: npm run remote:service:install`);
  }
}

function statusWindows() {
  const launcher = windowsLauncherPath();
  if (existsSync(launcher)) {
    // The .vbs embeds the command with doubled quotes; the first "..." pair
    // after the doubling is the node binary.
    const contents = readFileSync(launcher, 'utf8');
    warnIfNodeMissing(contents.match(/""([^"]+)""/)?.[1]);
  }
  console.log(existsSync(launcher)
    ? `Installed: Windows Startup-folder watcher\nLauncher: ${launcher}\nLog: ${windowsLogPath()}`
    : 'Not installed. Run: npm run remote:service:install');
}

function uninstallWindows() {
  const launcher = windowsLauncherPath();
  rmSync(launcher, { force: true });
  rmSync(legacyWindowsLauncherPath(), { force: true });
  console.log('Removed the Windows remote watcher launcher. It will not start at the next sign-in.');
}

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function macPaths() {
  const plist = join(homedir(), 'Library', 'LaunchAgents', `${launchLabel}.plist`);
  const logDir = join(homedir(), 'Library', 'Logs', 'Dormcheck');
  return { plist, stdout: join(logDir, 'remote-watch.log'), stderr: join(logDir, 'remote-watch.error.log') };
}

/** Block the (synchronous) install path without spawning a `sleep` process. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** launchctl print exit status: true while the label is still registered. */
function macServiceRegistered(target) {
  try {
    execFileSync('launchctl', ['print', target], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function macServiceRunning(target) {
  return /\bstate = running\b/.test(run('launchctl', ['print', target], { allowFailure: true }));
}

/**
 * `launchctl bootout` returns before the job has finished tearing down, so an
 * immediate bootstrap races it and dies with EIO. Wait for the label to
 * disappear; the bootstrap retry below is the backstop if it never does.
 */
function waitForMacTeardown(target) {
  for (let waited = 0; waited < 3000 && macServiceRegistered(target); waited += 100) sleepSync(100);
}

/** EIO here is the teardown race — worth retrying. Anything else is a real fault. */
function isBootstrapRace(message) {
  return /Bootstrap failed: 5|Input\/output error/i.test(message);
}

function bootstrapMac(domain, plist) {
  const backoff = [150, 300, 600];
  let last = '';
  for (let attempt = 0; ; attempt += 1) {
    try {
      run('launchctl', ['bootstrap', domain, plist]);
      return;
    } catch (error) {
      last = error.message;
      if (!isBootstrapRace(last) || attempt >= backoff.length) break;
      console.error(`bootstrap hit the teardown race (attempt ${attempt + 1}); retrying in ${backoff[attempt]}ms`);
      sleepSync(backoff[attempt]);
    }
  }
  throw new Error(`Failed to bootstrap ${launchLabel}: ${last}`);
}

function installMac() {
  const { plist, stdout, stderr } = macPaths();
  mkdirSync(dirname(plist), { recursive: true });
  mkdirSync(dirname(stdout), { recursive: true });
  const values = [stableNodePath(), watcher, 'watch', '--repo', root];
  const args = values.map((value) => `    <string>${xml(value)}</string>`).join('\n');
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>${launchLabel}</string>\n  <key>ProgramArguments</key><array>\n${args}\n  </array>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n  <key>ProcessType</key><string>Background</string>\n  <key>StandardOutPath</key><string>${xml(stdout)}</string>\n  <key>StandardErrorPath</key><string>${xml(stderr)}</string>\n</dict></plist>\n`);
  const domain = `gui/${process.getuid()}`;
  const target = `${domain}/${launchLabel}`;
  run('launchctl', ['bootout', target], { allowFailure: true });
  waitForMacTeardown(target);
  bootstrapMac(domain, plist);
  run('launchctl', ['kickstart', '-k', target]);
  // A success line that doesn't imply a live watcher is what makes this class
  // of failure silent, so assert the job actually came up before claiming it.
  let running = false;
  for (let waited = 0; waited < 3000 && !(running = macServiceRunning(target)); waited += 200) sleepSync(200);
  if (!running) {
    throw new Error(`${launchLabel} was bootstrapped but never reached state = running. Check ${stderr}.`);
  }
  console.log(`Installed one macOS login agent: ${launchLabel}`);
  console.log(`Watcher log: ${stdout}`);
}

function statusMac() {
  const { plist } = macPaths();
  if (existsSync(plist)) {
    const block = readFileSync(plist, 'utf8').split('<key>ProgramArguments</key>')[1] || '';
    warnIfNodeMissing(block.match(/<string>([^<]*)<\/string>/)?.[1]);
  }
  const output = run('launchctl', ['print', `gui/${process.getuid()}/${launchLabel}`], { allowFailure: true });
  console.log(output || `Not installed. Run: npm run remote:service:install`);
}

function uninstallMac() {
  const { plist } = macPaths();
  run('launchctl', ['bootout', `gui/${process.getuid()}/${launchLabel}`], { allowFailure: true });
  if (existsSync(plist)) run('rm', [plist]);
  console.log('Removed the macOS remote watcher agent.');
}

export { bootstrapMac, isBootstrapRace, macPaths, macServiceRunning, launchLabel, run, sleepSync };

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  if (!['install', 'status', 'uninstall'].includes(action)) {
    throw new Error('Usage: remote-service.mjs <install|status|uninstall>');
  }

  if (process.platform === 'win32') {
    if (action === 'install') installWindows();
    else if (action === 'status') statusWindows();
    else uninstallWindows();
  } else if (process.platform === 'darwin') {
    if (action === 'install') installMac();
    else if (action === 'status') statusMac();
    else uninstallMac();
  } else {
    throw new Error(`Automatic remote-watch service is supported on Windows and macOS, not ${process.platform}.`);
  }
}
