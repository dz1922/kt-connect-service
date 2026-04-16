import * as fs from 'fs';
import { connect, disconnect, getStatus, forceCleanup, getCurrentContext } from './connection';
import { reporter } from './reporter';
import { ServiceStatus } from './types';

export interface WatchOptions {
  profile?: string;
  namespace?: string;
  checkIntervalMs?: number;
  maxConsecutiveFailures?: number;
}

const FATAL_PATTERNS = [
  /unauthorized/i,
  /forbidden/i,
  /invalid.*credentials/i,
  /context.*not found/i,
  /certificate.*expired/i,
];

function isFatalError(message: string): boolean {
  return FATAL_PATTERNS.some((p) => p.test(message));
}

/**
 * Check if the running ktctl process is healthy.
 * Only reads log content written since `lastLogSize` to avoid false positives
 * from stale log entries.
 */
function isHealthy(status: ServiceStatus, lastLogSize: number): { healthy: boolean; newSize: number } {
  if (!status.logFile || !fs.existsSync(status.logFile)) {
    return { healthy: true, newSize: lastLogSize };
  }

  const stat = fs.statSync(status.logFile);
  const newSize = stat.size;

  if (newSize <= lastLogSize) {
    // No new log content — assume healthy
    return { healthy: true, newSize };
  }

  // Read only the new portion of the log
  const fd = fs.openSync(status.logFile, 'r');
  const buf = Buffer.alloc(newSize - lastLogSize);
  fs.readSync(fd, buf, 0, buf.length, lastLogSize);
  fs.closeSync(fd);

  const newContent = buf.toString('utf-8');
  const hasFatal = FATAL_PATTERNS.some((p) => p.test(newContent));

  return { healthy: !hasFatal, newSize };
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function watch(opts: WatchOptions): Promise<never> {
  const interval = opts.checkIntervalMs ?? 10_000;
  const maxFail = opts.maxConsecutiveFailures ?? 5;
  let backoff = 1_000;
  let fails = 0;
  let lastLogSize = 0;

  // Capture the starting context to detect external context changes
  const startContext = getCurrentContext();

  // Initial connect
  await connect({ profile: opts.profile, namespace: opts.namespace });
  reporter.log('info', 'Watcher active — will auto-reconnect on drop (Ctrl+C to stop)');

  const status = getStatus();
  if (status.logFile && fs.existsSync(status.logFile)) {
    lastLogSize = fs.statSync(status.logFile).size;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, interval));

    // Check if context changed externally
    const currentContext = getCurrentContext();
    if (startContext && currentContext !== startContext) {
      reporter.log('error',
        `Context changed externally: "${startContext}" → "${currentContext}". ` +
        'Watcher stopping to avoid connecting to wrong cluster.'
      );
      process.exit(1);
    }

    const currentStatus = getStatus();

    // Check if process is alive
    if (currentStatus.running && currentStatus.pid && isProcessRunning(currentStatus.pid)) {
      // Process alive — check log health
      const healthResult = isHealthy(currentStatus, lastLogSize);
      lastLogSize = healthResult.newSize;

      if (healthResult.healthy) {
        fails = 0;
        backoff = 1_000;
        continue;
      }

      // Unhealthy — log has fatal errors
      reporter.log('warn', 'Detected fatal error in ktctl logs');
    }

    // Connection lost or unhealthy
    fails++;

    if (fails >= maxFail) {
      reporter.log('error', `${maxFail} consecutive failures — giving up`);
      process.exit(1);
    }

    reporter.log('warn', `Connection lost (failure ${fails}/${maxFail}), reconnecting in ${backoff / 1000}s`);
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 60_000);

    try {
      await forceCleanup();
      await connect({ profile: opts.profile, namespace: opts.namespace });
      fails = 0;
      backoff = 1_000;

      // Update log size for new connection
      const newStatus = getStatus();
      if (newStatus.logFile && fs.existsSync(newStatus.logFile)) {
        lastLogSize = fs.statSync(newStatus.logFile).size;
      } else {
        lastLogSize = 0;
      }

      reporter.log('success', 'Reconnected');
    } catch (err) {
      const msg = (err as Error).message;
      if (isFatalError(msg)) {
        reporter.log('error', `Fatal: ${msg}`);
        process.exit(1);
      }
    }
  }
}
