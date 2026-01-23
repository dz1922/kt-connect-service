"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStatus = getStatus;
exports.connect = connect;
exports.disconnect = disconnect;
exports.cleanup = cleanup;
exports.forceCleanup = forceCleanup;
exports.switchContext = switchContext;
exports.getContexts = getContexts;
exports.getCurrentContext = getCurrentContext;
exports.getLogs = getLogs;
exports.switchNamespace = switchNamespace;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const config_1 = require("./config");
const installer_1 = require("./installer");
function getProcessInfo() {
    const pidFile = (0, config_1.getPidFile)();
    if (!fs.existsSync(pidFile)) {
        return null;
    }
    try {
        const content = fs.readFileSync(pidFile, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
function saveProcessInfo(info) {
    const pidFile = (0, config_1.getPidFile)();
    fs.writeFileSync(pidFile, JSON.stringify(info, null, 2));
}
function clearProcessInfo() {
    const pidFile = (0, config_1.getPidFile)();
    if (fs.existsSync(pidFile)) {
        fs.unlinkSync(pidFile);
    }
}
function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function getStatus() {
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
async function connect(options = {}) {
    const status = getStatus();
    if (status.running) {
        throw new Error(`kt-connect is already running (PID: ${status.pid}, profile: ${status.profile}). ` +
            'Please disconnect first using "ktcs disconnect".');
    }
    // Determine which profile to use
    const profileName = options.profile || (0, config_1.getActiveProfile)();
    if (!profileName) {
        throw new Error('No profile specified and no active profile set. Use "ktcs profile add" to create a profile first.');
    }
    const profile = (0, config_1.getProfile)(profileName);
    if (!profile) {
        throw new Error(`Profile "${profileName}" not found. Use "ktcs profile list" to see available profiles.`);
    }
    // Find ktctl binary
    const ktctlPath = (0, installer_1.findKtctl)();
    if (!ktctlPath) {
        throw new Error('ktctl not found. Please install it first using "ktcs install".');
    }
    // Build command arguments
    const args = ['connect'];
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
    const logDir = (0, config_1.getLogDir)();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logDir, `ktctl-${timestamp}.log`);
    // Check if running as root
    const isRoot = process.getuid && process.getuid() === 0;
    if (!isRoot) {
        throw new Error('kt-connect requires root privileges. Please run with sudo:\n  sudo ktcs connect');
    }
    console.log(`Starting kt-connect with profile: ${profileName}`);
    console.log(`Command: ${ktctlPath} ${args.join(' ')}`);
    console.log(`Log file: ${logFile}`);
    // Start ktctl in background (already running as root)
    const logStream = fs.openSync(logFile, 'a');
    const child = (0, child_process_1.spawn)(ktctlPath, args, {
        detached: true,
        stdio: ['ignore', logStream, logStream],
    });
    child.unref();
    fs.closeSync(logStream);
    // Wait a moment to check if process started successfully
    await new Promise((resolve) => setTimeout(resolve, 2000));
    // Check if process is still running
    if (!isProcessRunning(child.pid)) {
        const logContent = fs.readFileSync(logFile, 'utf-8');
        throw new Error(`kt-connect failed to start. Check log file: ${logFile}\n\nLog output:\n${logContent}`);
    }
    // Save process info
    const processInfo = {
        pid: child.pid,
        profile: profileName,
        namespace: namespace,
        startedAt: new Date().toISOString(),
        logFile: logFile,
    };
    saveProcessInfo(processInfo);
    (0, config_1.setActiveProfile)(profileName);
    console.log(`kt-connect started successfully (PID: ${child.pid})`);
}
async function disconnect() {
    const status = getStatus();
    if (!status.running) {
        console.log('kt-connect is not running.');
        // Still run cleanup
        await cleanup();
        return;
    }
    // Check if running as root (needed to kill the process)
    const isRoot = process.getuid && process.getuid() === 0;
    if (!isRoot) {
        throw new Error('Disconnect requires root privileges. Please run with sudo:\n  sudo ktcs disconnect');
    }
    console.log(`Stopping kt-connect (PID: ${status.pid})...`);
    try {
        // Send SIGTERM to the process
        process.kill(status.pid, 'SIGTERM');
        // Wait for process to terminate
        let retries = 10;
        while (retries > 0 && isProcessRunning(status.pid)) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            retries--;
        }
        // Force kill if still running
        if (isProcessRunning(status.pid)) {
            console.log('Process did not terminate gracefully, force killing...');
            process.kill(status.pid, 'SIGKILL');
        }
    }
    catch (error) {
        // Process might already be dead
        console.log('Process may have already terminated.');
    }
    clearProcessInfo();
    console.log('kt-connect stopped.');
    // Run cleanup
    await cleanup();
}
async function cleanup() {
    const ktctlPath = (0, installer_1.findKtctl)();
    if (!ktctlPath) {
        console.log('ktctl not found, skipping cleanup.');
        return;
    }
    console.log('Running ktctl clean (10s timeout)...');
    try {
        (0, child_process_1.execSync)(`${ktctlPath} clean`, {
            stdio: 'pipe',
            timeout: 10000, // 10 second timeout
        });
        console.log('Cleanup complete.');
    }
    catch (error) {
        if (error.killed) {
            console.log('Cleanup timed out (this is usually fine).');
        }
        else {
            console.log('Cleanup command finished.');
        }
    }
}
// Force cleanup - kills ALL kt-connect related processes and cleans up
async function forceCleanup() {
    console.log('Force cleaning kt-connect environment...');
    // 1. Kill all ktctl processes (including orphaned ones)
    console.log('Killing all ktctl processes...');
    try {
        // Find and kill all ktctl processes
        (0, child_process_1.execSync)('pkill -9 -f "ktctl" 2>/dev/null || true', { stdio: 'pipe' });
    }
    catch {
        // Ignore errors - process might not exist
    }
    // 2. Kill any kt-connect related processes
    try {
        (0, child_process_1.execSync)('pkill -9 -f "kt-connect" 2>/dev/null || true', { stdio: 'pipe' });
    }
    catch {
        // Ignore errors
    }
    // Wait for processes to die
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // 3. Clear our PID file
    clearProcessInfo();
    // 4. Run ktctl clean to remove k8s resources
    const ktctlPath = (0, installer_1.findKtctl)();
    if (ktctlPath) {
        console.log('Cleaning up Kubernetes resources...');
        try {
            (0, child_process_1.execSync)(`${ktctlPath} clean`, {
                stdio: 'pipe',
                timeout: 15000,
            });
        }
        catch {
            // Ignore cleanup errors
        }
    }
    console.log('Force cleanup complete.');
}
// Switch kubeconfig context
function switchContext(context) {
    console.log(`Switching to context: ${context}`);
    try {
        (0, child_process_1.execSync)(`kubectl config use-context ${context}`, { stdio: 'inherit' });
        console.log(`Switched to context: ${context}`);
    }
    catch (error) {
        throw new Error(`Failed to switch context: ${error.message}`);
    }
}
// Get available kubeconfig contexts
function getContexts() {
    try {
        const output = (0, child_process_1.execSync)('kubectl config get-contexts -o name', { encoding: 'utf-8' });
        return output.trim().split('\n').filter(Boolean);
    }
    catch {
        return [];
    }
}
// Get current kubeconfig context
function getCurrentContext() {
    try {
        const output = (0, child_process_1.execSync)('kubectl config current-context', { encoding: 'utf-8' });
        return output.trim();
    }
    catch {
        return null;
    }
}
function getLogs(lines = 50) {
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
function switchNamespace(namespace) {
    const status = getStatus();
    if (status.running) {
        throw new Error('Cannot switch namespace while kt-connect is running. ' + 'Please disconnect first, then reconnect with the new namespace.');
    }
    const activeProfile = (0, config_1.getActiveProfile)();
    if (!activeProfile) {
        throw new Error('No active profile. Set one using "ktcs profile use <name>".');
    }
    console.log(`To connect with namespace "${namespace}", run:`);
    console.log(`  ktcs connect -n ${namespace}`);
}
//# sourceMappingURL=connection.js.map