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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLatestVersion = getLatestVersion;
exports.getDownloadUrl = getDownloadUrl;
exports.downloadFile = downloadFile;
exports.install = install;
exports.getInstalledVersion = getInstalledVersion;
exports.isKtctlInstalled = isKtctlInstalled;
exports.findKtctl = findKtctl;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const node_fetch_1 = __importDefault(require("node-fetch"));
const tar = __importStar(require("tar"));
const config_1 = require("./config");
const GITHUB_API_URL = 'https://api.github.com/repos/alibaba/kt-connect/releases/latest';
const DOWNLOAD_BASE_URL = 'https://github.com/alibaba/kt-connect/releases/download';
// China mirror (if available)
const MIRROR_BASE_URL = 'https://ghproxy.com/https://github.com/alibaba/kt-connect/releases/download';
function getPlatform() {
    const platform = os.platform();
    switch (platform) {
        case 'darwin':
            return 'MacOS';
        case 'linux':
            return 'Linux';
        case 'win32':
            return 'Windows';
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
}
function getArch() {
    const arch = os.arch();
    switch (arch) {
        case 'x64':
            return 'x86_64';
        case 'arm64':
            return 'arm_64';
        case 'ia32':
            return 'i386';
        default:
            throw new Error(`Unsupported architecture: ${arch}`);
    }
}
async function getLatestVersion() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await (0, node_fetch_1.default)(GITHUB_API_URL, {
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch latest version: ${response.statusText}`);
        }
        const data = (await response.json());
        return data.tag_name;
    }
    finally {
        clearTimeout(timeout);
    }
}
function getDownloadUrl(version, useMirror = false) {
    const platform = getPlatform();
    const arch = getArch();
    const extension = platform === 'Windows' ? 'zip' : 'tar.gz';
    const versionNum = version.startsWith('v') ? version.slice(1) : version;
    const baseUrl = useMirror ? MIRROR_BASE_URL : DOWNLOAD_BASE_URL;
    return `${baseUrl}/${version}/ktctl_${versionNum}_${platform}_${arch}.${extension}`;
}
async function downloadFile(url, destPath, onProgress) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout
    try {
        const response = await (0, node_fetch_1.default)(url, {
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
        }
        const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
        let downloadedSize = 0;
        const chunks = [];
        for await (const chunk of response.body) {
            chunks.push(chunk);
            downloadedSize += chunk.length;
            if (onProgress && totalSize > 0) {
                const percent = Math.round((downloadedSize / totalSize) * 100);
                onProgress(percent, downloadedSize, totalSize);
            }
        }
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(destPath, buffer);
    }
    finally {
        clearTimeout(timeout);
    }
}
async function install(options = {}) {
    const version = options.version || (await getLatestVersion());
    const installPath = options.installPath || '/usr/local/bin';
    const ktctlPath = path.join(installPath, 'ktctl');
    // Check if already installed
    if (!options.force && fs.existsSync(ktctlPath)) {
        const existingVersion = getInstalledVersion(ktctlPath);
        if (existingVersion) {
            console.log(`ktctl is already installed (version: ${existingVersion})`);
            (0, config_1.setKtctlPath)(ktctlPath);
            return ktctlPath;
        }
    }
    const useMirror = options.mirror || false;
    const downloadUrl = getDownloadUrl(version, useMirror);
    console.log(`Downloading ktctl ${version}...`);
    console.log(`URL: ${downloadUrl}`);
    if (!useMirror) {
        console.log(`(If slow, try: ktcs install --mirror)`);
    }
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ktctl-'));
    const archivePath = path.join(tempDir, 'ktctl.tar.gz');
    try {
        let lastPercent = -1;
        await downloadFile(downloadUrl, archivePath, (percent, downloaded, total) => {
            if (percent !== lastPercent && percent % 10 === 0) {
                const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
                const totalMB = (total / 1024 / 1024).toFixed(1);
                console.log(`  Progress: ${percent}% (${downloadedMB}/${totalMB} MB)`);
                lastPercent = percent;
            }
        });
        console.log('Download complete. Extracting...');
        // Extract the archive
        await tar.x({
            file: archivePath,
            cwd: tempDir,
        });
        // Find ktctl binary in extracted files
        const extractedKtctl = path.join(tempDir, 'ktctl');
        if (!fs.existsSync(extractedKtctl)) {
            throw new Error('ktctl binary not found in archive');
        }
        // Move to install path (requires sudo for /usr/local/bin)
        const destPath = path.join(installPath, 'ktctl');
        // Check if we need sudo
        const needsSudo = !fs.existsSync(installPath) || !isWritable(installPath);
        if (needsSudo) {
            console.log(`Installing to ${destPath} (requires sudo)...`);
            (0, child_process_1.execSync)(`sudo cp "${extractedKtctl}" "${destPath}"`, { stdio: 'inherit' });
            (0, child_process_1.execSync)(`sudo chmod +x "${destPath}"`, { stdio: 'inherit' });
            // macOS quarantine removal
            if (os.platform() === 'darwin') {
                try {
                    (0, child_process_1.execSync)(`sudo xattr -d com.apple.quarantine "${destPath}"`, { stdio: 'pipe' });
                }
                catch {
                    // Ignore if xattr fails (attribute might not exist)
                }
            }
        }
        else {
            fs.copyFileSync(extractedKtctl, destPath);
            fs.chmodSync(destPath, 0o755);
        }
        (0, config_1.setKtctlPath)(destPath);
        console.log(`ktctl ${version} installed successfully at ${destPath}`);
        return destPath;
    }
    finally {
        // Cleanup temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}
function isWritable(dirPath) {
    try {
        fs.accessSync(dirPath, fs.constants.W_OK);
        return true;
    }
    catch {
        return false;
    }
}
function getInstalledVersion(ktctlPath) {
    const binPath = ktctlPath || (0, config_1.getKtctlPath)() || 'ktctl';
    try {
        const result = (0, child_process_1.execSync)(`"${binPath}" version`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Parse version from output
        const match = result.match(/version[:\s]+v?(\d+\.\d+\.\d+)/i);
        return match ? match[1] : result.trim();
    }
    catch {
        return null;
    }
}
function isKtctlInstalled() {
    const ktctlPath = (0, config_1.getKtctlPath)();
    if (ktctlPath && fs.existsSync(ktctlPath)) {
        return true;
    }
    // Check if ktctl is in PATH
    try {
        (0, child_process_1.execSync)('which ktctl', { stdio: 'pipe' });
        return true;
    }
    catch {
        return false;
    }
}
function findKtctl() {
    // First check configured path
    const configuredPath = (0, config_1.getKtctlPath)();
    if (configuredPath && fs.existsSync(configuredPath)) {
        return configuredPath;
    }
    // Check common locations
    const commonPaths = ['/usr/local/bin/ktctl', '/usr/bin/ktctl', path.join(os.homedir(), '.local/bin/ktctl')];
    for (const p of commonPaths) {
        if (fs.existsSync(p)) {
            (0, config_1.setKtctlPath)(p);
            return p;
        }
    }
    // Check PATH
    try {
        const result = (0, child_process_1.execSync)('which ktctl', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        const foundPath = result.trim();
        if (foundPath) {
            (0, config_1.setKtctlPath)(foundPath);
            return foundPath;
        }
    }
    catch {
        // Not found in PATH
    }
    return null;
}
//# sourceMappingURL=installer.js.map