#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import {
  getConfig,
  getDefaults,
  setDefault,
  unsetDefault,
  isValidDefaultKey,
} from './config';
import { install, getLatestVersion, getInstalledVersion, findKtctl } from './installer';
import {
  connect,
  disconnect,
  getStatus,
  getLogs,
  cleanup,
  forceCleanup,
  switchContext,
  getContexts,
  getCurrentContext,
  beginSwitch,
  rollbackSwitch,
} from './connection';
import { reporter } from './reporter';
import { watch } from './watcher';

const packageJson = require('../package.json');
const program = new Command();

program
  .name('ktcs')
  .description('kt-connect service — manage kt-connect tunnels with kubectl-style CLI')
  .version(packageJson.version)
  .option('--verbose', 'Show internal steps and commands')
  .hook('preAction', (_thisCommand, actionCommand) => {
    reporter.setVerbose(!!actionCommand.optsWithGlobals().verbose);
  });

// ============================================================
// Connection lifecycle
// ============================================================

program
  .command('connect')
  .description('Connect to the cluster using kt-connect')
  .option('-c, --context <name>', 'kubeconfig context (switches kubectl context)')
  .option('-n, --namespace <namespace>', 'namespace (overrides default)')
  .option('-i, --image <url>', 'shadow image (overrides default)')
  .option('--kubeconfig <path>', 'kubeconfig file path')
  .action(async (options) => {
    try {
      reporter.startStep('Connecting to cluster');
      await connect({
        context: options.context,
        namespace: options.namespace,
        image: options.image,
        kubeconfig: options.kubeconfig,
      });
      reporter.succeedStep('Connected');
    } catch (error) {
      reporter.failStep((error as Error).message);
      process.exit(1);
    }
  });

program
  .command('disconnect')
  .description('Disconnect from the cluster')
  .action(async () => {
    try {
      reporter.startStep('Disconnecting');
      await disconnect();
      reporter.succeedStep('Disconnected');
    } catch (error) {
      reporter.failStep((error as Error).message);
      process.exit(1);
    }
  });

program
  .command('switch <context>')
  .description('Switch kubectl context and reconnect')
  .option('-n, --namespace <namespace>', 'namespace (overrides default)')
  .option('-i, --image <url>', 'shadow image (overrides default)')
  .option('--kubeconfig <path>', 'kubeconfig file path')
  .action(async (context, options) => {
    const tx = beginSwitch();
    reporter.startStep('Switching environment');
    try {
      reporter.updateStep('Cleaning up previous connection');
      await forceCleanup();

      reporter.updateStep(`Switching context → ${context}`);
      switchContext(context);

      reporter.updateStep('Reconnecting kt-connect');
      await connect({
        namespace: options.namespace,
        image: options.image,
        kubeconfig: options.kubeconfig,
      });

      reporter.succeedStep(`Switched to "${context}" and reconnected`);
    } catch (err) {
      reporter.failStep(`Switch failed: ${(err as Error).message}`);
      reporter.startStep('Rolling back');
      await rollbackSwitch(tx);
      reporter.succeedStep(
        `Rolled back to "${tx.previousContext ?? 'previous'}" (disconnected — run 'ktcs connect' to resume)`
      );
      process.exit(1);
    }
  });

program
  .command('watch')
  .description('Connect with auto-reconnect on drop (foreground)')
  .option('-c, --context <name>', 'kubeconfig context')
  .option('-n, --namespace <namespace>', 'namespace')
  .option('-i, --image <url>', 'shadow image')
  .option('--interval <ms>', 'health check interval in ms', '10000')
  .option('--max-failures <n>', 'stop after N consecutive failures', '5')
  .action(async (options) => {
    try {
      await watch({
        context: options.context,
        namespace: options.namespace,
        image: options.image,
        checkIntervalMs: parseInt(options.interval, 10) || 10_000,
        maxConsecutiveFailures: parseInt(options.maxFailures, 10) || 5,
      });
    } catch (error) {
      reporter.failStep((error as Error).message);
      process.exit(1);
    }
  });

program
  .command('clean')
  .description('Clean up kt-connect resources')
  .option('-f, --force', 'kill all ktctl processes forcefully')
  .action(async (options) => {
    try {
      reporter.startStep('Cleaning up');
      if (options.force) {
        await forceCleanup();
      } else {
        await cleanup();
      }
      reporter.succeedStep('Cleanup complete');
    } catch (error) {
      reporter.failStep((error as Error).message);
      process.exit(1);
    }
  });

// ============================================================
// Status / info
// ============================================================

program
  .command('status')
  .description('Show connection status')
  .action(() => {
    const status = getStatus();
    const currentContext = getCurrentContext();

    console.log(chalk.cyan('kt-connect Status:'));
    console.log();

    if (status.running) {
      const isOrphan = !status.context && !status.logFile;
      console.log(`  Status:      ${chalk.green('Connected')}${isOrphan ? chalk.yellow(' (orphan — not started by ktcs)') : ''}`);
      console.log(`  PID:         ${status.pid}`);
      if (status.context) console.log(`  Context:     ${status.context}`);
      if (status.namespace) console.log(`  Namespace:   ${status.namespace}`);
      if (status.startedAt) console.log(`  Started:     ${status.startedAt}`);
      if (status.logFile) console.log(`  Log file:    ${status.logFile}`);
    } else {
      console.log(`  Status:      ${chalk.yellow('Disconnected')}`);
    }

    console.log();
    console.log(`  Current kubectl context: ${currentContext ?? chalk.gray('(none)')}`);

    const ktctlPath = findKtctl();
    if (ktctlPath) {
      const version = getInstalledVersion(ktctlPath);
      console.log(`  ktctl:       ${ktctlPath}${version ? ` (v${version})` : ''}`);
    } else {
      console.log(`  ktctl:       ${chalk.yellow('Not installed (will auto-download on connect)')}`);
    }
  });

program
  .command('logs')
  .description('Show connection logs')
  .option('-n, --lines <number>', 'number of lines to show', '50')
  .option('-f, --follow', 'follow log output (like tail -f)')
  .action((options) => {
    if (options.follow) {
      const status = getStatus();
      if (!status.running || !status.logFile) {
        reporter.failStep('No active connection or log file found.');
        process.exit(1);
      }
      console.log(chalk.cyan(`Following logs from ${status.logFile}...`));
      console.log(chalk.gray('Press Ctrl+C to stop.\n'));
      const { spawn } = require('child_process');
      const tail = spawn('tail', ['-f', status.logFile], { stdio: 'inherit' });
      process.on('SIGINT', () => {
        tail.kill();
        process.exit(0);
      });
    } else {
      console.log(getLogs(parseInt(options.lines, 10)));
    }
  });

program
  .command('get-contexts')
  .description('List available kubeconfig contexts')
  .action(() => {
    const contexts = getContexts();
    const current = getCurrentContext();
    if (contexts.length === 0) {
      reporter.log('warn', 'No kubectl contexts found.');
      return;
    }
    contexts.forEach((ctx) => {
      if (ctx === current) {
        console.log(chalk.green(`* ${ctx}`));
      } else {
        console.log(`  ${ctx}`);
      }
    });
  });

// ============================================================
// Config (global defaults)
// ============================================================

const configCmd = program.command('config').description('Manage default settings');

configCmd
  .command('show')
  .description('Show current defaults')
  .action(() => {
    console.log(JSON.stringify(getDefaults(), null, 2));
  });

configCmd
  .command('get [key]')
  .description('Get a default value (or all if no key)')
  .action((key) => {
    const defaults = getDefaults();
    if (!key) {
      console.log(JSON.stringify(defaults, null, 2));
      return;
    }
    if (!isValidDefaultKey(key)) {
      reporter.failStep(`Unknown key: ${key}. Valid keys: image, namespace, kubeconfig, extraArgs`);
      process.exit(1);
    }
    const val = defaults[key];
    console.log(val === undefined ? '' : typeof val === 'string' ? val : JSON.stringify(val));
  });

configCmd
  .command('set <key> <value>')
  .description('Set a default (key: image | namespace | kubeconfig | extraArgs)')
  .action((key, value) => {
    if (!isValidDefaultKey(key)) {
      reporter.failStep(`Unknown key: ${key}. Valid keys: image, namespace, kubeconfig, extraArgs`);
      process.exit(1);
    }
    // extraArgs accepts space-separated string → array
    if (key === 'extraArgs') {
      setDefault(key, value.split(/\s+/).filter(Boolean));
    } else {
      setDefault(key, value);
    }
    reporter.log('success', `${key} = ${value}`);
  });

configCmd
  .command('unset <key>')
  .description('Reset a default to its built-in value')
  .action((key) => {
    if (!isValidDefaultKey(key)) {
      reporter.failStep(`Unknown key: ${key}`);
      process.exit(1);
    }
    unsetDefault(key);
    reporter.log('success', `${key} reset to default`);
  });

configCmd
  .command('raw')
  .description('Show the raw config file contents')
  .action(() => {
    console.log(JSON.stringify(getConfig(), null, 2));
  });

// ============================================================
// ktctl binary management
// ============================================================

program
  .command('install')
  .description('Download or upgrade ktctl (auto-installed on first use)')
  .option('-v, --version <version>', 'specific version to install')
  .option('-p, --path <path>', 'installation path (default: ~/.kt-connect-service/bin)')
  .option('-f, --force', 'force reinstall')
  .option('-m, --mirror', 'use GitHub mirror for faster download in China')
  .action(async (options) => {
    try {
      const installedPath = await install({
        version: options.version,
        installPath: options.path,
        force: options.force,
        mirror: options.mirror,
      });
      const version = getInstalledVersion(installedPath);
      if (version) reporter.log('success', `Installed version: ${version}`);
    } catch (error) {
      reporter.failStep('Installation failed: ' + (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('ktctl-version')
  .description('Show installed ktctl version info')
  .action(async () => {
    const ktctlPath = findKtctl();
    if (!ktctlPath) {
      reporter.log('warn', 'ktctl is not installed. It will be downloaded on first connect.');
      return;
    }
    const installed = getInstalledVersion(ktctlPath);
    console.log(`ktctl path: ${ktctlPath}`);
    console.log(`Installed: ${installed || 'unknown'}`);
    try {
      const latest = await getLatestVersion();
      console.log(`Latest: ${latest}`);
    } catch {
      console.log('Could not fetch latest version.');
    }
  });

program.parse();
