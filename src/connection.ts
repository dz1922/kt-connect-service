import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync, spawnSync, ChildProcess } from 'child_process';
import { getProfile, getLogDir, getPidFile, setActiveProfile, getActiveProfile, getKtctlPath } from './config';
import { findKtctl } from './installer';
import { ServiceStatus, ConnectionProfile, ConnectOptions } from './types';
import { reporter } from './reporter';

interface ProcessInfo {
  pid: number;
  profile: string;
  namespace?: string;
  startedAt: string;
  logFile: string;
}

function getProcessInfo(): ProcessInfo | null {
  const pidFile = getPidFile();
  if (!fs.existsSync(pidFile)) {
    return null;
  }

  try {
    const content = fs.readFileSync(pidFile, 'utf-8');
    return JSON.parse(content) as ProcessInfo;
  } catch {
    return null;
  }
}

function saveProcessInfo(info: ProcessInfo): void {
  const pidFile = getPidFile();
  fs.writeFileSync(pidFile, JSON.stringify(info, null, 2));
}

function clearProcessInfo(): void {
  const pidFile = getPidFile();
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}

// Readiness markers ktctl prints when tunnel is established
const READINESS_MARKERS = [
  'KT proxy is ready',
  'Tunnel is ready',
  'tun device',
  'Connect to cluster',
  'Route to',
  'successful',
];
const READINESS_TIMEOUT_MS = 30_000;
const READINESS_POLL_MS = 500;

function safeReadTail(file: string, lines: number): string {
  try {
    const all = fs.readFileSync(file, 'utf-8').split('\n');
    return all.slice(-lines).join('\n');
  } catch {
    return '(log unavailable)';
  }
}

async function waitForReadiness(pid: number, logFile: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < READINESS_TIMEOUT_MS) {
    if (!isProcessRunning(pid)) {
      const tail = safeReadTail(logFile, 50);
      throw new Error(`ktctl exited during startup.\n\n${tail}`);
    }
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf-8');
      if (READINESS_MARKERS.some((m) => content.toLowerCase().includes(m.toLowerCase()))) {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, READINESS_POLL_MS));
  }
  // Timeout — process alive but no readiness signal. Warn but don't fail hard.
  reporter.log('warn',
    `ktctl did not signal readiness within ${READINESS_TIMEOUT_MS / 1000}s. ` +
    `It may still be starting. Check logs: ${logFile}`
  );
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getStatus(): ServiceStatus {
  const processInfo = getProcessInfo();

  if (!processInfo) {
    return { running: false };
  }

  const running = isProcessRunning(processInfo.pid);

  if (!running) {
    // Process died, clean up pid file
    clearProcessInfo();
    return { running: false };
  }

  return {
    running: true,
    pid: processInfo.pid,
    profile: processInfo.profile,
    namespace: processInfo.namespace,
    startedAt: processInfo.startedAt,
    logFile: processInfo.logFile,
  };
}

export async function connect(options: ConnectOptions = {}): Promise<void> {
  const status = getStatus();
  if (status.running) {
    throw new Error(
      `kt-connect is already running (PID: ${status.pid}, profile: ${status.profile}). ` +
        'Please disconnect first using "ktcs disconnect".'
    );
  }

  // Determine which profile to use
  const profileName = options.profile || getActiveProfile();
  if (!profileName) {
    throw new Error('No profile specified and no active profile set. Use "ktcs profile add" to create a profile first.');
  }

  const profile = getProfile(profileName);
  if (!profile) {
    throw new Error(`Profile "${profileName}" not found. Use "ktcs profile list" to see available profiles.`);
  }

  // Find ktctl binary
  const ktctlPath = findKtctl();
  if (!ktctlPath) {
    throw new Error('ktctl not found. Please install it first using "ktcs install".');
  }

  // Build command arguments
  const args: string[] = ['connect'];

  // Add image
  args.push('-i', profile.image);

  // Add namespace (command line override takes precedence)
  const namespace = options.namespace || profile.namespace;
  if (namespace) {
    args.push('-n', namespace);
  }

  // Add kubeconfig if specified
  if (profile.kubeconfig) {
    args.push('--kubeconfig', profile.kubeconfig);
  }

  // Add extra arguments
  if (profile.extraArgs && profile.extraArgs.length > 0) {
    args.push(...profile.extraArgs);
  }

  // Setup logging
  const logDir = getLogDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logDir, `ktctl-${timestamp}.log`);

  // Check if running as root
  const isRoot = process.getuid && process.getuid() === 0;
  if (!isRoot) {
    throw new Error('kt-connect requires root privileges. Please run with sudo:\n  sudo ktcs connect');
  }

  reporter.log('debug', `Starting kt-connect with profile: ${profileName}`);
  reporter.log('debug', `Command: ${ktctlPath} ${args.join(' ')}`);
  reporter.log('debug', `Log file: ${logFile}`);

  // Start ktctl in background (already running as root)
  const logStream = fs.openSync(logFile, 'a');

  const child = spawn(ktctlPath, args, {
    detached: true,
    stdio: ['ignore', logStream, logStream],
  });

  child.unref();
  fs.closeSync(logStream);

  if (!child.pid) {
    throw new Error('Failed to start ktctl process');
  }

  // Wait for ktctl to signal readiness (or timeout with warning)
  await waitForReadiness(child.pid, logFile);

  // Save process info
  const processInfo: ProcessInfo = {
    pid: child.pid,
    profile: profileName,
    namespace: namespace,
    startedAt: new Date().toISOString(),
    logFile: logFile,
  };
  saveProcessInfo(processInfo);
  setActiveProfile(profileName);

  reporter.log('debug', `kt-connect started (PID: ${child.pid})`);
}

export async function disconnect(): Promise<void> {
  const status = getStatus();

  if (!status.running) {
    reporter.log('info', 'kt-connect is not running.');
    // Still run cleanup
    await cleanup();
    return;
  }

  // Check if running as root (needed to kill the process)
  const isRoot = process.getuid && process.getuid() === 0;
  if (!isRoot) {
    throw new Error('Disconnect requires root privileges. Please run with sudo:\n  sudo ktcs disconnect');
  }

  reporter.log('debug', `Stopping kt-connect (PID: ${status.pid})`);

  try {
    // Send SIGTERM to the process
    process.kill(status.pid!, 'SIGTERM');

    // Wait for process to terminate
    let retries = 10;
    while (retries > 0 && isProcessRunning(status.pid!)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      retries--;
    }

    // Force kill if still running
    if (isProcessRunning(status.pid!)) {
      reporter.log('debug', 'Process did not terminate gracefully, force killing');
      process.kill(status.pid!, 'SIGKILL');
    }
  } catch (error) {
    // Process might already be dead
    reporter.log('debug', 'Process may have already terminated');
  }

  clearProcessInfo();
  reporter.log('debug', 'kt-connect stopped');

  // Run cleanup
  await cleanup();
}

export async function cleanup(): Promise<void> {
  const ktctlPath = findKtctl();
  if (!ktctlPath) {
    reporter.log('debug', 'ktctl not found, skipping cleanup');
    return;
  }

  reporter.log('debug', 'Running ktctl clean (10s timeout)');
  try {
    execSync(`${ktctlPath} clean`, {
      stdio: 'pipe',
      timeout: 10000, // 10 second timeout
    });
    reporter.log('debug', 'Cleanup complete');
  } catch (error: any) {
    if (error.killed) {
      reporter.log('debug', 'Cleanup timed out (this is usually fine)');
    } else {
      reporter.log('debug', 'Cleanup command finished');
    }
  }
}

// Force cleanup - kills ALL kt-connect related processes and cleans up
export async function forceCleanup(): Promise<void> {
  reporter.log('debug', 'Force cleaning kt-connect environment');

  // 1. Kill all ktctl processes (including orphaned ones)
  reporter.log('debug', 'Killing all ktctl processes');
  try {
    // Find and kill all ktctl processes
    execSync('pkill -9 -f "ktctl" 2>/dev/null || true', { stdio: 'pipe' });
  } catch {
    // Ignore errors - process might not exist
  }

  // 2. Kill any kt-connect related processes
  try {
    execSync('pkill -9 -f "kt-connect" 2>/dev/null || true', { stdio: 'pipe' });
  } catch {
    // Ignore errors
  }

  // Wait for processes to die
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 3. Clear our PID file
  clearProcessInfo();

  // 4. Run ktctl clean to remove k8s resources
  const ktctlPath = findKtctl();
  if (ktctlPath) {
    reporter.log('debug', 'Cleaning up Kubernetes resources');
    try {
      execSync(`${ktctlPath} clean`, {
        stdio: 'pipe',
        timeout: 15000,
      });
    } catch {
      // Ignore cleanup errors
    }
  }

  reporter.log('debug', 'Force cleanup complete');
}

// Switch kubeconfig context
export function switchContext(context: string): void {
  reporter.log('debug', `Switching to context: ${context}`);
  const result = spawnSync('kubectl', ['config', 'use-context', context], { stdio: 'pipe' });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? Buffer.from('')).toString().trim();
    throw new Error(stderr || `Failed to switch context (exit ${result.status})`);
  }
}

// Get available kubeconfig contexts
export function getContexts(): string[] {
  const result = spawnSync('kubectl', ['config', 'get-contexts', '-o', 'name'], { encoding: 'utf-8' });
  if (result.status !== 0) return [];
  return (result.stdout ?? '').trim().split('\n').filter(Boolean);
}

// Get current kubeconfig context
export function getCurrentContext(): string | null {
  const result = spawnSync('kubectl', ['config', 'current-context'], { encoding: 'utf-8' });
  if (result.status !== 0) return null;
  return (result.stdout ?? '').trim() || null;
}

// Switch transaction for rollback support
export interface SwitchTransaction {
  previousContext: string | null;
}

export function beginSwitch(): SwitchTransaction {
  return {
    previousContext: getCurrentContext(),
  };
}

export async function rollbackSwitch(tx: SwitchTransaction): Promise<void> {
  if (tx.previousContext) {
    try {
      switchContext(tx.previousContext);
    } catch {
      // best-effort rollback
    }
  }
  await forceCleanup();
}

export function getLogs(lines: number = 50): string {
  const processInfo = getProcessInfo();

  if (!processInfo || !processInfo.logFile) {
    return 'No active connection or log file found.';
  }

  if (!fs.existsSync(processInfo.logFile)) {
    return `Log file not found: ${processInfo.logFile}`;
  }

  const content = fs.readFileSync(processInfo.logFile, 'utf-8');
  const allLines = content.split('\n');
  const lastLines = allLines.slice(-lines);
  return lastLines.join('\n');
}

export function switchNamespace(namespace: string): void {
  const status = getStatus();
  if (status.running) {
    throw new Error(
      'Cannot switch namespace while kt-connect is running. ' + 'Please disconnect first, then reconnect with the new namespace.'
    );
  }

  const activeProfile = getActiveProfile();
  if (!activeProfile) {
    throw new Error('No active profile. Set one using "ktcs profile use <name>".');
  }

  reporter.log('info', `To connect with namespace "${namespace}", run:\n  ktcs connect -n ${namespace}`);
}
