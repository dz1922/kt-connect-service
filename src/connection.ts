import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { getDefaults, getLogDir, getPidFile } from './config';
import { findKtctl, ensureKtctl } from './installer';
import { ServiceStatus, ConnectOptions } from './types';
import { reporter } from './reporter';

interface ProcessInfo {
  pid: number;
  context?: string;
  namespace?: string;
  startedAt: string;
  logFile: string;
}

function getProcessInfo(): ProcessInfo | null {
  const pidFile = getPidFile();
  if (!fs.existsSync(pidFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(pidFile, 'utf-8')) as ProcessInfo;
  } catch {
    return null;
  }
}

function saveProcessInfo(info: ProcessInfo): void {
  const pidFile = getPidFile();
  fs.writeFileSync(pidFile, JSON.stringify(info, null, 2));
  // When running under sudo, chown file back to the real user so
  // non-sudo ktcs invocations can still read/update it.
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser && process.getuid && process.getuid() === 0) {
    const uid = parseInt((spawnSync('id', ['-u', sudoUser], { encoding: 'utf-8' }).stdout ?? '').trim(), 10);
    const gid = parseInt((spawnSync('id', ['-g', sudoUser], { encoding: 'utf-8' }).stdout ?? '').trim(), 10);
    if (!isNaN(uid) && !isNaN(gid)) {
      try { fs.chownSync(pidFile, uid, gid); } catch { /* best-effort */ }
    }
  }
}

function clearProcessInfo(): void {
  const pidFile = getPidFile();
  if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Find any running `ktctl connect` via pgrep. Needed because ktctl forks at startup. */
function findKtctlConnectPid(): number | null {
  const result = spawnSync('pgrep', ['-f', 'ktctl connect'], { encoding: 'utf-8' });
  if (result.status !== 0) return null;
  const pids = (result.stdout ?? '')
    .trim()
    .split('\n')
    .map((p) => parseInt(p, 10))
    .filter((p) => !isNaN(p) && p !== process.pid);
  return pids.length > 0 ? pids[0] : null;
}

const READINESS_MARKERS = [
  'KT proxy is ready',
  'Tunnel is ready',
  'tun device',
  'Connect to cluster',
  'Route to',
  'All looks good',
];
const READINESS_TIMEOUT_MS = 30_000;
const READINESS_POLL_MS = 500;

function safeReadTail(file: string, lines: number): string {
  try {
    return fs.readFileSync(file, 'utf-8').split('\n').slice(-lines).join('\n');
  } catch {
    return '(log unavailable)';
  }
}

async function waitForReadiness(pid: number, logFile: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < READINESS_TIMEOUT_MS) {
    if (!isProcessRunning(pid) && !findKtctlConnectPid()) {
      throw new Error(`ktctl exited during startup.\n\n${safeReadTail(logFile, 50)}`);
    }
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf-8').toLowerCase();
      if (READINESS_MARKERS.some((m) => content.includes(m.toLowerCase()))) return;
    }
    await new Promise((r) => setTimeout(r, READINESS_POLL_MS));
  }
  reporter.log('warn',
    `ktctl did not signal readiness within ${READINESS_TIMEOUT_MS / 1000}s. ` +
    `It may still be starting. Check logs: ${logFile}`
  );
}

export function getStatus(): ServiceStatus {
  const info = getProcessInfo();

  if (info && isProcessRunning(info.pid)) {
    return {
      running: true,
      pid: info.pid,
      context: info.context,
      namespace: info.namespace,
      startedAt: info.startedAt,
      logFile: info.logFile,
    };
  }

  // Fallback: covers forked ktctl + root-owned process from non-sudo ktcs
  const livePid = findKtctlConnectPid();
  if (livePid) {
    if (info) {
      if (info.pid !== livePid) {
        try { saveProcessInfo({ ...info, pid: livePid }); } catch { /* read-only */ }
      }
      return {
        running: true,
        pid: livePid,
        context: info.context,
        namespace: info.namespace,
        startedAt: info.startedAt,
        logFile: info.logFile,
      };
    }
    return { running: true, pid: livePid };
  }

  if (info) {
    try { clearProcessInfo(); } catch { /* may fail without sudo */ }
  }
  return { running: false };
}

export async function connect(options: ConnectOptions = {}): Promise<void> {
  const status = getStatus();
  if (status.running) {
    throw new Error(
      `kt-connect is already running (PID: ${status.pid}). ` +
        'Please disconnect first using "ktcs disconnect".'
    );
  }

  const isRoot = process.getuid && process.getuid() === 0;
  if (!isRoot) {
    throw new Error('kt-connect requires root privileges. Please run with sudo:\n  sudo ktcs connect');
  }

  // If caller wants a specific context, switch to it first
  if (options.context) {
    switchContext(options.context);
  }

  const defaults = getDefaults();
  const image = options.image ?? defaults.image;
  const namespace = options.namespace ?? defaults.namespace;
  const kubeconfig = options.kubeconfig ?? defaults.kubeconfig;
  const extraArgs = defaults.extraArgs ?? [];

  const ktctlPath = await ensureKtctl();

  const args: string[] = ['connect', '-i', image];
  if (namespace) args.push('-n', namespace);
  if (kubeconfig) args.push('--kubeconfig', kubeconfig);
  if (extraArgs.length > 0) args.push(...extraArgs);

  const logDir = getLogDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(logDir, `ktctl-${timestamp}.log`);

  const contextName = options.context ?? getCurrentContext() ?? undefined;

  reporter.log('debug', `Starting ktctl (context: ${contextName ?? 'current'})`);
  reporter.log('debug', `Command: ${ktctlPath} ${args.join(' ')}`);
  reporter.log('debug', `Log file: ${logFile}`);

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

  await waitForReadiness(child.pid, logFile);

  // ktctl forks during startup; save the actual worker PID
  const actualPid = findKtctlConnectPid() ?? child.pid;

  saveProcessInfo({
    pid: actualPid,
    context: contextName,
    namespace,
    startedAt: new Date().toISOString(),
    logFile,
  });

  reporter.log('debug', `kt-connect started (PID: ${actualPid})`);
}

export async function disconnect(): Promise<void> {
  const status = getStatus();

  if (!status.running) {
    reporter.log('info', 'kt-connect is not running.');
    await cleanup();
    return;
  }

  const isRoot = process.getuid && process.getuid() === 0;
  if (!isRoot) {
    throw new Error('Disconnect requires root privileges. Please run with sudo:\n  sudo ktcs disconnect');
  }

  reporter.log('debug', `Stopping kt-connect (PID: ${status.pid})`);

  try {
    process.kill(status.pid!, 'SIGTERM');
    let retries = 10;
    while (retries > 0 && isProcessRunning(status.pid!)) {
      await new Promise((r) => setTimeout(r, 500));
      retries--;
    }
    if (isProcessRunning(status.pid!)) {
      reporter.log('debug', 'Process did not terminate gracefully, force killing');
      process.kill(status.pid!, 'SIGKILL');
    }
  } catch {
    reporter.log('debug', 'Process may have already terminated');
  }

  clearProcessInfo();
  await cleanup();
}

export async function cleanup(): Promise<void> {
  const ktctlPath = findKtctl();
  if (!ktctlPath) {
    reporter.log('debug', 'ktctl not found, skipping cleanup');
    return;
  }
  reporter.log('debug', 'Running ktctl clean (10s timeout)');
  const result = spawnSync(ktctlPath, ['clean'], { stdio: 'pipe', timeout: 10_000 });
  if (result.error && (result.error as any).code === 'ETIMEDOUT') {
    reporter.log('debug', 'Cleanup timed out (usually fine)');
  } else {
    reporter.log('debug', 'Cleanup complete');
  }
}

export async function forceCleanup(): Promise<void> {
  reporter.log('debug', 'Force cleaning kt-connect environment');
  reporter.log('debug', 'Killing all ktctl processes');
  spawnSync('pkill', ['-9', '-f', 'ktctl'], { stdio: 'pipe' });
  spawnSync('pkill', ['-9', '-f', 'kt-connect'], { stdio: 'pipe' });
  await new Promise((r) => setTimeout(r, 1000));
  try { clearProcessInfo(); } catch { /* best-effort */ }
  const ktctlPath = findKtctl();
  if (ktctlPath) {
    reporter.log('debug', 'Cleaning up Kubernetes resources');
    spawnSync(ktctlPath, ['clean'], { stdio: 'pipe', timeout: 15_000 });
  }
  reporter.log('debug', 'Force cleanup complete');
}

export function switchContext(context: string): void {
  reporter.log('debug', `Switching to context: ${context}`);
  const result = spawnSync('kubectl', ['config', 'use-context', context], { stdio: 'pipe' });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? Buffer.from('')).toString().trim();
    throw new Error(stderr || `Failed to switch context (exit ${result.status})`);
  }
}

export function getContexts(): string[] {
  const result = spawnSync('kubectl', ['config', 'get-contexts', '-o', 'name'], { encoding: 'utf-8' });
  if (result.status !== 0) return [];
  return (result.stdout ?? '').trim().split('\n').filter(Boolean);
}

export function getCurrentContext(): string | null {
  const result = spawnSync('kubectl', ['config', 'current-context'], { encoding: 'utf-8' });
  if (result.status !== 0) return null;
  return (result.stdout ?? '').trim() || null;
}

export interface SwitchTransaction {
  previousContext: string | null;
}

export function beginSwitch(): SwitchTransaction {
  return { previousContext: getCurrentContext() };
}

export async function rollbackSwitch(tx: SwitchTransaction): Promise<void> {
  if (tx.previousContext) {
    try { switchContext(tx.previousContext); } catch { /* best-effort */ }
  }
  await forceCleanup();
}

export function getLogs(lines: number = 50): string {
  const info = getProcessInfo();
  if (!info || !info.logFile) return 'No active connection or log file found.';
  if (!fs.existsSync(info.logFile)) return `Log file not found: ${info.logFile}`;
  return safeReadTail(info.logFile, lines);
}
