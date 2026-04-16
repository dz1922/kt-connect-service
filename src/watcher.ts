import * as fs from 'fs';
import { connect, getStatus, forceCleanup, getCurrentContext } from './connection';
import { reporter } from './reporter';
import { ServiceStatus } from './types';

export interface WatchOptions {
  context?: string;
  namespace?: string;
  image?: string;
  kubeconfig?: string;
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

  if (newSize <= lastLogSize) return { healthy: true, newSize };

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

  const startContext = getCurrentContext();

  await connect({
    context: opts.context,
    namespace: opts.namespace,
    image: opts.image,
    kubeconfig: opts.kubeconfig,
  });
  reporter.log('info', 'Watcher active — will auto-reconnect on drop (Ctrl+C to stop)');

  const status = getStatus();
  if (status.logFile && fs.existsSync(status.logFile)) {
    lastLogSize = fs.statSync(status.logFile).size;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((r) => setTimeout(r, interval));

    const currentContext = getCurrentContext();
    if (startContext && currentContext !== startContext) {
      reporter.log('error',
        `Context changed externally: "${startContext}" → "${currentContext}". Watcher stopping.`
      );
      process.exit(1);
    }

    const currentStatus = getStatus();

    if (currentStatus.running && currentStatus.pid && isProcessRunning(currentStatus.pid)) {
      const healthResult = isHealthy(currentStatus, lastLogSize);
      lastLogSize = healthResult.newSize;
      if (healthResult.healthy) {
        fails = 0;
        backoff = 1_000;
        continue;
      }
      reporter.log('warn', 'Detected fatal error in ktctl logs');
    }

    fails++;
    if (fails >= maxFail) {
      reporter.log('error', `${maxFail} consecutive failures — giving up`);
      process.exit(1);
    }

    reporter.log('warn', `Connection lost (${fails}/${maxFail}), reconnecting in ${backoff / 1000}s`);
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 60_000);

    try {
      await forceCleanup();
      await connect({
        context: opts.context,
        namespace: opts.namespace,
        image: opts.image,
        kubeconfig: opts.kubeconfig,
      });
      fails = 0;
      backoff = 1_000;

      const newStatus = getStatus();
      lastLogSize = newStatus.logFile && fs.existsSync(newStatus.logFile)
        ? fs.statSync(newStatus.logFile).size
        : 0;

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
