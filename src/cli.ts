#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  addProfile,
  getProfile,
  getAllProfiles,
  removeProfile,
  updateProfile,
  setActiveProfile,
  getActiveProfile,
  getConfig,
} from './config';
import { install, getLatestVersion, getInstalledVersion, findKtctl, ensureKtctl } from './installer';
import { connect, disconnect, getStatus, getLogs, cleanup, forceCleanup, switchContext, getContexts, getCurrentContext, beginSwitch, rollbackSwitch } from './connection';
import { ConnectionProfile, DEFAULT_IMAGE, DEFAULT_NAMESPACE, DEFAULT_DESCRIPTION } from './types';
import { reporter } from './reporter';
import { watch } from './watcher';

const packageJson = require('../package.json');
const program = new Command();

program
  .name('ktcs')
  .description('kt-connect service - Background service for managing kt-connect connections')
  .version(packageJson.version)
  .option('--verbose', 'Show internal steps and commands')
  .hook('preAction', (_thisCommand, actionCommand) => {
    reporter.setVerbose(!!actionCommand.optsWithGlobals().verbose);
  });

// Install command
program
  .command('install')
  .description('Download or upgrade ktctl (auto-installed on first use)')
  .option('-v, --version <version>', 'Specific version to install')
  .option('-p, --path <path>', 'Installation path (default: ~/.kt-connect-service/bin)')
  .option('-f, --force', 'Force reinstall even if already installed')
  .option('-m, --mirror', 'Use GitHub mirror for faster download in China')
  .action(async (options) => {
    try {
      const installedPath = await install({
        version: options.version,
        installPath: options.path,
        force: options.force,
        mirror: options.mirror,
      });

      // Show version
      const version = getInstalledVersion(installedPath);
      if (version) {
        reporter.log('success', `Installed version: ${version}`);
      }
    } catch (error) {
      reporter.failStep('Installation failed: ' + (error as Error).message);
      process.exit(1);
    }
  });

// Version info command
program
  .command('version')
  .description('Show ktctl version information')
  .action(async () => {
    const ktctlPath = findKtctl();
    if (!ktctlPath) {
      reporter.log('warn', 'ktctl is not installed. It will be downloaded automatically on first connect.');
      return;
    }

    const installedVersion = getInstalledVersion(ktctlPath);
    console.log(`ktctl path: ${ktctlPath}`);
    console.log(`Installed version: ${installedVersion || 'unknown'}`);

    try {
      const latestVersion = await getLatestVersion();
      console.log(`Latest version: ${latestVersion}`);
    } catch {
      console.log('Could not fetch latest version.');
    }
  });

// Profile commands
const profileCmd = program.command('profile').description('Manage connection profiles');

profileCmd
  .command('add <name>')
  .description('Add a new connection profile')
  .option('-i, --image <image>', `Shadow image URL (default: ${DEFAULT_IMAGE})`)
  .option('-n, --namespace <namespace>', `Default namespace (default: ${DEFAULT_NAMESPACE})`)
  .option('-k, --kubeconfig <path>', 'Path to kubeconfig file')
  .option('-d, --description <description>', `Profile description (default: ${DEFAULT_DESCRIPTION})`)
  .option('-a, --args <args...>', 'Extra arguments to pass to ktctl')
  .action((name, options) => {
    const existing = getProfile(name);
    if (existing) {
      reporter.failStep(`Profile "${name}" already exists. Use "ktcs profile update" to modify it.`);
      process.exit(1);
    }

    const profile: ConnectionProfile = {
      name,
      image: options.image || DEFAULT_IMAGE,
      namespace: options.namespace || DEFAULT_NAMESPACE,
      kubeconfig: options.kubeconfig,
      description: options.description || DEFAULT_DESCRIPTION,
      extraArgs: options.args,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    addProfile(profile);
    reporter.log('success', `Profile "${name}" added`);
    reporter.log('debug', `Image:     ${profile.image}`);
    reporter.log('debug', `Namespace: ${profile.namespace}`);

    // Set as active if no active profile
    if (!getActiveProfile()) {
      setActiveProfile(name);
      reporter.log('info', `Set "${name}" as the active profile`);
    }
  });

profileCmd
  .command('list')
  .alias('ls')
  .description('List all connection profiles')
  .action(() => {
    const profiles = getAllProfiles();
    const activeProfile = getActiveProfile();

    if (profiles.length === 0) {
      reporter.log('warn', 'No profiles configured. Use "ktcs profile add" to add one.');
      return;
    }

    const table = new Table({
      head: ['Name', 'Image', 'Namespace', 'Description', 'Active'],
      style: { head: ['cyan'] },
    });

    profiles.forEach((profile) => {
      const isActive = profile.name === activeProfile;
      table.push([
        isActive ? chalk.green(profile.name) : profile.name,
        truncate(profile.image, 50),
        profile.namespace || '-',
        profile.description || '-',
        isActive ? chalk.green('*') : '',
      ]);
    });

    console.log(table.toString());
  });

profileCmd
  .command('show <name>')
  .description('Show details of a profile')
  .action((name) => {
    const profile = getProfile(name);
    if (!profile) {
      reporter.failStep(`Profile "${name}" not found.`);
      process.exit(1);
    }

    const activeProfile = getActiveProfile();
    console.log(chalk.cyan('Profile Details:'));
    console.log(`  Name:        ${profile.name}${profile.name === activeProfile ? chalk.green(' (active)') : ''}`);
    console.log(`  Image:       ${profile.image}`);
    console.log(`  Namespace:   ${profile.namespace || '(default)'}`);
    console.log(`  Kubeconfig:  ${profile.kubeconfig || '(default)'}`);
    console.log(`  Description: ${profile.description || '-'}`);
    console.log(`  Extra Args:  ${profile.extraArgs?.join(' ') || '-'}`);
    console.log(`  Created:     ${profile.createdAt}`);
    console.log(`  Updated:     ${profile.updatedAt}`);
  });

profileCmd
  .command('remove <name>')
  .alias('rm')
  .description('Remove a connection profile')
  .action((name) => {
    const removed = removeProfile(name);
    if (removed) {
      reporter.log('success', `Profile "${name}" removed`);
    } else {
      reporter.failStep(`Profile "${name}" not found.`);
      process.exit(1);
    }
  });

profileCmd
  .command('use <name>')
  .description('Set the active profile')
  .action((name) => {
    const profile = getProfile(name);
    if (!profile) {
      reporter.failStep(`Profile "${name}" not found.`);
      process.exit(1);
    }

    setActiveProfile(name);
    reporter.log('success', `Active profile set to "${name}"`);
  });

profileCmd
  .command('update <name>')
  .description('Update an existing profile')
  .option('-i, --image <image>', 'Shadow image URL')
  .option('-n, --namespace <namespace>', 'Default namespace')
  .option('-k, --kubeconfig <path>', 'Path to kubeconfig file')
  .option('-d, --description <description>', 'Profile description')
  .option('-a, --args <args...>', 'Extra arguments to pass to ktctl')
  .action((name, options) => {
    const profile = getProfile(name);
    if (!profile) {
      reporter.failStep(`Profile "${name}" not found.`);
      process.exit(1);
    }

    const updates: Partial<ConnectionProfile> = {};
    if (options.image) updates.image = options.image;
    if (options.namespace) updates.namespace = options.namespace;
    if (options.kubeconfig) updates.kubeconfig = options.kubeconfig;
    if (options.description) updates.description = options.description;
    if (options.args) updates.extraArgs = options.args;

    if (Object.keys(updates).length === 0) {
      reporter.log('warn', 'No updates specified.');
      return;
    }

    updateProfile(name, updates);
    reporter.log('success', `Profile "${name}" updated`);
  });

// Connect command
program
  .command('connect')
  .description('Connect to the cluster using kt-connect')
  .option('-p, --profile <name>', 'Profile to use (defaults to active profile)')
  .option('-n, --namespace <namespace>', 'Override namespace')
  .action(async (options) => {
    try {
      reporter.startStep('Connecting to cluster');
      await connect({
        profile: options.profile,
        namespace: options.namespace,
      });
      reporter.succeedStep('Connected to cluster');
    } catch (error) {
      reporter.failStep((error as Error).message);
      process.exit(1);
    }
  });

// Watch command - connect with auto-reconnect
program
  .command('watch')
  .description('Connect and auto-reconnect on drop (foreground)')
  .option('-p, --profile <name>', 'Profile to use')
  .option('-n, --namespace <namespace>', 'Override namespace')
  .option('--interval <ms>', 'Health check interval in ms', '10000')
  .option('--max-failures <n>', 'Stop after N consecutive failures', '5')
  .action(async (options) => {
    try {
      await watch({
        profile: options.profile,
        namespace: options.namespace,
        checkIntervalMs: parseInt(options.interval, 10) || 10_000,
        maxConsecutiveFailures: parseInt(options.maxFailures, 10) || 5,
      });
    } catch (error) {
      reporter.failStep((error as Error).message);
      process.exit(1);
    }
  });

// Disconnect command
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

// Status command
program
  .command('status')
  .description('Show the current connection status')
  .action(() => {
    const status = getStatus();
    const activeProfile = getActiveProfile();

    console.log(chalk.cyan('kt-connect Service Status:'));
    console.log();

    if (status.running) {
      console.log(`  Status:      ${chalk.green('Connected')}`);
      console.log(`  PID:         ${status.pid}`);
      console.log(`  Profile:     ${status.profile}`);
      console.log(`  Namespace:   ${status.namespace || '(default)'}`);
      console.log(`  Started:     ${status.startedAt}`);
      console.log(`  Log file:    ${status.logFile}`);
    } else {
      console.log(`  Status:      ${chalk.yellow('Disconnected')}`);
    }

    console.log();
    console.log(`  Active Profile: ${activeProfile || chalk.gray('(none)')}`);

    // ktctl info
    const ktctlPath = findKtctl();
    if (ktctlPath) {
      const version = getInstalledVersion(ktctlPath);
      console.log(`  ktctl:       ${ktctlPath} (v${version || 'unknown'})`);
    } else {
      console.log(`  ktctl:       ${chalk.yellow('Not installed')}`);
    }
  });

// Logs command
program
  .command('logs')
  .description('Show connection logs')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .option('-f, --follow', 'Follow log output (like tail -f)')
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
      const logs = getLogs(parseInt(options.lines, 10));
      console.log(logs);
    }
  });

// Clean command
program
  .command('clean')
  .description('Clean up kt-connect resources')
  .option('-f, --force', 'Force cleanup - kill all kt-connect processes')
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

// Switch command - switch kubeconfig context and reconnect
program
  .command('switch [context]')
  .description('Switch kubeconfig context and reconnect kt-connect')
  .option('-p, --profile <name>', 'Profile to use for reconnection')
  .option('-n, --namespace <namespace>', 'Override namespace')
  .option('-l, --list', 'List available contexts')
  .action(async (context, options) => {
    try {
      // List contexts
      if (options.list) {
        const contexts = getContexts();
        const current = getCurrentContext();
        console.log(chalk.cyan('Available contexts:'));
        contexts.forEach((ctx) => {
          if (ctx === current) {
            console.log(chalk.green(`  * ${ctx} (current)`));
          } else {
            console.log(`    ${ctx}`);
          }
        });
        return;
      }

      if (!context) {
        reporter.failStep('Please specify a context or use -l to list available contexts.');
        process.exit(1);
      }

      const tx = beginSwitch();
      reporter.startStep('Switching environment');

      try {
        // Step 1: Force cleanup
        reporter.updateStep('Cleaning up previous connection');
        await forceCleanup();

        // Step 2: Switch context
        reporter.updateStep(`Switching context → ${context}`);
        switchContext(context);

        // Step 3: Reconnect
        reporter.updateStep('Reconnecting kt-connect');
        await connect({
          profile: options.profile,
          namespace: options.namespace,
        });

        reporter.succeedStep(`Switched to "${context}" and reconnected`);
      } catch (err) {
        reporter.failStep(`Switch failed: ${(err as Error).message}`);
        reporter.startStep('Rolling back to previous state');
        await rollbackSwitch(tx);
        reporter.succeedStep(
          `Rolled back to "${tx.previousContext ?? 'previous'}" (disconnected — run 'ktcs connect' to resume)`
        );
        process.exit(1);
      }
    } catch (error) {
      reporter.failStep((error as Error).message);
      process.exit(1);
    }
  });

// Config command
program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    const config = getConfig();
    console.log(chalk.cyan('Configuration:'));
    console.log(JSON.stringify(config, null, 2));
  });

// Helper functions
function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.substring(0, length - 3) + '...';
}

// Parse and run
program.parse();
