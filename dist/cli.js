#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const chalk_1 = __importDefault(require("chalk"));
const cli_table3_1 = __importDefault(require("cli-table3"));
const config_1 = require("./config");
const installer_1 = require("./installer");
const connection_1 = require("./connection");
const types_1 = require("./types");
const packageJson = require('../package.json');
const program = new commander_1.Command();
program
    .name('ktcs')
    .description('kt-connect service - Background service for managing kt-connect connections')
    .version(packageJson.version);
// Install command
program
    .command('install')
    .description('Download and install ktctl')
    .option('-v, --version <version>', 'Specific version to install')
    .option('-p, --path <path>', 'Installation path (default: /usr/local/bin)')
    .option('-f, --force', 'Force reinstall even if already installed')
    .option('-m, --mirror', 'Use GitHub mirror for faster download in China')
    .action(async (options) => {
    try {
        const installedPath = await (0, installer_1.install)({
            version: options.version,
            installPath: options.path,
            force: options.force,
            mirror: options.mirror,
        });
        // Show version
        const version = (0, installer_1.getInstalledVersion)(installedPath);
        if (version) {
            console.log(chalk_1.default.green(`Installed version: ${version}`));
        }
    }
    catch (error) {
        console.error(chalk_1.default.red('Installation failed: ' + error.message));
        process.exit(1);
    }
});
// Version info command
program
    .command('version')
    .description('Show ktctl version information')
    .action(async () => {
    const ktctlPath = (0, installer_1.findKtctl)();
    if (!ktctlPath) {
        console.log(chalk_1.default.yellow('ktctl is not installed. Run "ktcs install" to install it.'));
        return;
    }
    const installedVersion = (0, installer_1.getInstalledVersion)(ktctlPath);
    console.log(`ktctl path: ${ktctlPath}`);
    console.log(`Installed version: ${installedVersion || 'unknown'}`);
    try {
        const latestVersion = await (0, installer_1.getLatestVersion)();
        console.log(`Latest version: ${latestVersion}`);
    }
    catch {
        console.log('Could not fetch latest version.');
    }
});
// Profile commands
const profileCmd = program.command('profile').description('Manage connection profiles');
profileCmd
    .command('add <name>')
    .description('Add a new connection profile')
    .option('-i, --image <image>', `Shadow image URL (default: ${types_1.DEFAULT_IMAGE})`)
    .option('-n, --namespace <namespace>', `Default namespace (default: ${types_1.DEFAULT_NAMESPACE})`)
    .option('-k, --kubeconfig <path>', 'Path to kubeconfig file')
    .option('-d, --description <description>', `Profile description (default: ${types_1.DEFAULT_DESCRIPTION})`)
    .option('-a, --args <args...>', 'Extra arguments to pass to ktctl')
    .action((name, options) => {
    const existing = (0, config_1.getProfile)(name);
    if (existing) {
        console.error(chalk_1.default.red(`Profile "${name}" already exists. Use "ktcs profile update" to modify it.`));
        process.exit(1);
    }
    const profile = {
        name,
        image: options.image || types_1.DEFAULT_IMAGE,
        namespace: options.namespace || types_1.DEFAULT_NAMESPACE,
        kubeconfig: options.kubeconfig,
        description: options.description || types_1.DEFAULT_DESCRIPTION,
        extraArgs: options.args,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    (0, config_1.addProfile)(profile);
    console.log(chalk_1.default.green(`Profile "${name}" added successfully.`));
    console.log(chalk_1.default.gray(`  Image:     ${profile.image}`));
    console.log(chalk_1.default.gray(`  Namespace: ${profile.namespace}`));
    // Set as active if no active profile
    if (!(0, config_1.getActiveProfile)()) {
        (0, config_1.setActiveProfile)(name);
        console.log(chalk_1.default.blue(`Set "${name}" as the active profile.`));
    }
});
profileCmd
    .command('list')
    .alias('ls')
    .description('List all connection profiles')
    .action(() => {
    const profiles = (0, config_1.getAllProfiles)();
    const activeProfile = (0, config_1.getActiveProfile)();
    if (profiles.length === 0) {
        console.log(chalk_1.default.yellow('No profiles configured. Use "ktcs profile add" to add one.'));
        return;
    }
    const table = new cli_table3_1.default({
        head: ['Name', 'Image', 'Namespace', 'Description', 'Active'],
        style: { head: ['cyan'] },
    });
    profiles.forEach((profile) => {
        const isActive = profile.name === activeProfile;
        table.push([
            isActive ? chalk_1.default.green(profile.name) : profile.name,
            truncate(profile.image, 50),
            profile.namespace || '-',
            profile.description || '-',
            isActive ? chalk_1.default.green('*') : '',
        ]);
    });
    console.log(table.toString());
});
profileCmd
    .command('show <name>')
    .description('Show details of a profile')
    .action((name) => {
    const profile = (0, config_1.getProfile)(name);
    if (!profile) {
        console.error(chalk_1.default.red(`Profile "${name}" not found.`));
        process.exit(1);
    }
    const activeProfile = (0, config_1.getActiveProfile)();
    console.log(chalk_1.default.cyan('Profile Details:'));
    console.log(`  Name:        ${profile.name}${profile.name === activeProfile ? chalk_1.default.green(' (active)') : ''}`);
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
    const removed = (0, config_1.removeProfile)(name);
    if (removed) {
        console.log(chalk_1.default.green(`Profile "${name}" removed.`));
    }
    else {
        console.error(chalk_1.default.red(`Profile "${name}" not found.`));
        process.exit(1);
    }
});
profileCmd
    .command('use <name>')
    .description('Set the active profile')
    .action((name) => {
    const profile = (0, config_1.getProfile)(name);
    if (!profile) {
        console.error(chalk_1.default.red(`Profile "${name}" not found.`));
        process.exit(1);
    }
    (0, config_1.setActiveProfile)(name);
    console.log(chalk_1.default.green(`Active profile set to "${name}".`));
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
    const profile = (0, config_1.getProfile)(name);
    if (!profile) {
        console.error(chalk_1.default.red(`Profile "${name}" not found.`));
        process.exit(1);
    }
    const updates = {};
    if (options.image)
        updates.image = options.image;
    if (options.namespace)
        updates.namespace = options.namespace;
    if (options.kubeconfig)
        updates.kubeconfig = options.kubeconfig;
    if (options.description)
        updates.description = options.description;
    if (options.args)
        updates.extraArgs = options.args;
    if (Object.keys(updates).length === 0) {
        console.log(chalk_1.default.yellow('No updates specified.'));
        return;
    }
    (0, config_1.updateProfile)(name, updates);
    console.log(chalk_1.default.green(`Profile "${name}" updated.`));
});
// Connect command
program
    .command('connect')
    .description('Connect to the cluster using kt-connect')
    .option('-p, --profile <name>', 'Profile to use (defaults to active profile)')
    .option('-n, --namespace <namespace>', 'Override namespace')
    .action(async (options) => {
    try {
        await (0, connection_1.connect)({
            profile: options.profile,
            namespace: options.namespace,
        });
    }
    catch (error) {
        console.error(chalk_1.default.red(error.message));
        process.exit(1);
    }
});
// Disconnect command
program
    .command('disconnect')
    .description('Disconnect from the cluster')
    .action(async () => {
    try {
        await (0, connection_1.disconnect)();
    }
    catch (error) {
        console.error(chalk_1.default.red(error.message));
        process.exit(1);
    }
});
// Status command
program
    .command('status')
    .description('Show the current connection status')
    .action(() => {
    const status = (0, connection_1.getStatus)();
    const activeProfile = (0, config_1.getActiveProfile)();
    console.log(chalk_1.default.cyan('kt-connect Service Status:'));
    console.log();
    if (status.running) {
        console.log(`  Status:      ${chalk_1.default.green('Connected')}`);
        console.log(`  PID:         ${status.pid}`);
        console.log(`  Profile:     ${status.profile}`);
        console.log(`  Namespace:   ${status.namespace || '(default)'}`);
        console.log(`  Started:     ${status.startedAt}`);
        console.log(`  Log file:    ${status.logFile}`);
    }
    else {
        console.log(`  Status:      ${chalk_1.default.yellow('Disconnected')}`);
    }
    console.log();
    console.log(`  Active Profile: ${activeProfile || chalk_1.default.gray('(none)')}`);
    // ktctl info
    const ktctlPath = (0, installer_1.findKtctl)();
    if (ktctlPath) {
        const version = (0, installer_1.getInstalledVersion)(ktctlPath);
        console.log(`  ktctl:       ${ktctlPath} (v${version || 'unknown'})`);
    }
    else {
        console.log(`  ktctl:       ${chalk_1.default.yellow('Not installed')}`);
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
        const status = (0, connection_1.getStatus)();
        if (!status.running || !status.logFile) {
            console.error(chalk_1.default.red('No active connection or log file found.'));
            process.exit(1);
        }
        console.log(chalk_1.default.cyan(`Following logs from ${status.logFile}...`));
        console.log(chalk_1.default.gray('Press Ctrl+C to stop.\n'));
        const { spawn } = require('child_process');
        const tail = spawn('tail', ['-f', status.logFile], { stdio: 'inherit' });
        process.on('SIGINT', () => {
            tail.kill();
            process.exit(0);
        });
    }
    else {
        const logs = (0, connection_1.getLogs)(parseInt(options.lines, 10));
        console.log(logs);
    }
});
// Clean command
program
    .command('clean')
    .description('Clean up kt-connect resources')
    .action(async () => {
    try {
        await (0, connection_1.cleanup)();
    }
    catch (error) {
        console.error(chalk_1.default.red(error.message));
        process.exit(1);
    }
});
// Config command
program
    .command('config')
    .description('Show current configuration')
    .action(() => {
    const config = (0, config_1.getConfig)();
    console.log(chalk_1.default.cyan('Configuration:'));
    console.log(JSON.stringify(config, null, 2));
});
// Helper functions
function truncate(str, length) {
    if (str.length <= length)
        return str;
    return str.substring(0, length - 3) + '...';
}
// Parse and run
program.parse();
//# sourceMappingURL=cli.js.map