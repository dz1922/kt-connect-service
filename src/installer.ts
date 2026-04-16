import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawnSync } from 'child_process';
import fetch from 'node-fetch';
import * as tar from 'tar';
import { setKtctlPath, getKtctlPath } from './config';
import { InstallOptions } from './types';
import { reporter } from './reporter';

const GITHUB_API_URL = 'https://api.github.com/repos/alibaba/kt-connect/releases/latest';
const DOWNLOAD_BASE_URL = 'https://github.com/alibaba/kt-connect/releases/download';
const MIRROR_BASE_URL = 'https://ghproxy.com/https://github.com/alibaba/kt-connect/releases/download';

interface GithubRelease {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

/** Default binary location — user-writable, no sudo needed */
function getDefaultBinDir(): string {
  const home = getRealHomeDir();
  return path.join(home, '.kt-connect-service', 'bin');
}

function getRealHomeDir(): string {
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser) {
    if (process.platform === 'darwin') return `/Users/${sudoUser}`;
    return `/home/${sudoUser}`;
  }
  return os.homedir();
}

function getPlatform(): string {
  const platform = os.platform();
  switch (platform) {
    case 'darwin': return 'MacOS';
    case 'linux': return 'Linux';
    case 'win32': return 'Windows';
    default: throw new Error(`Unsupported platform: ${platform}`);
  }
}

function getArch(): string {
  const arch = os.arch();
  switch (arch) {
    case 'x64': return 'x86_64';
    case 'arm64': return 'arm_64';
    case 'ia32': return 'i386';
    default: throw new Error(`Unsupported architecture: ${arch}`);
  }
}

export async function getLatestVersion(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(GITHUB_API_URL, {
      signal: controller.signal as any,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch latest version: ${response.statusText}`);
    }
    const data = (await response.json()) as GithubRelease;
    return data.tag_name;
  } finally {
    clearTimeout(timeout);
  }
}

export function getDownloadUrl(version: string, useMirror: boolean = false): string {
  const platform = getPlatform();
  const arch = getArch();
  const extension = platform === 'Windows' ? 'zip' : 'tar.gz';
  const versionNum = version.startsWith('v') ? version.slice(1) : version;
  const baseUrl = useMirror ? MIRROR_BASE_URL : DOWNLOAD_BASE_URL;
  return `${baseUrl}/${version}/ktctl_${versionNum}_${platform}_${arch}.${extension}`;
}

export async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number, downloaded: number, total: number) => void
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300000);

  try {
    const response = await fetch(url, {
      signal: controller.signal as any,
    });

    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
    let downloadedSize = 0;

    const chunks: Buffer[] = [];

    for await (const chunk of response.body as any) {
      chunks.push(chunk);
      downloadedSize += chunk.length;

      if (onProgress && totalSize > 0) {
        const percent = Math.round((downloadedSize / totalSize) * 100);
        onProgress(percent, downloadedSize, totalSize);
      }
    }

    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(destPath, buffer);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Install ktctl binary. Defaults to ~/.kt-connect-service/bin/ (user-writable).
 */
export async function install(options: InstallOptions = {}): Promise<string> {
  const version = options.version || (await getLatestVersion());
  const installPath = options.installPath || getDefaultBinDir();
  const ktctlPath = path.join(installPath, 'ktctl');

  // Ensure install directory exists
  if (!fs.existsSync(installPath)) {
    fs.mkdirSync(installPath, { recursive: true });
  }

  // Check if already installed
  if (!options.force && fs.existsSync(ktctlPath)) {
    const existingVersion = getInstalledVersion(ktctlPath);
    if (existingVersion) {
      reporter.log('debug', `ktctl already installed (${existingVersion})`);
      setKtctlPath(ktctlPath);
      return ktctlPath;
    }
  }

  const useMirror = options.mirror || false;
  const downloadUrl = getDownloadUrl(version, useMirror);

  reporter.log('info', `Downloading ktctl ${version}...`);
  reporter.log('debug', `URL: ${downloadUrl}`);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ktctl-'));
  const archivePath = path.join(tempDir, 'ktctl.tar.gz');

  try {
    let lastPercent = -1;
    await downloadFile(downloadUrl, archivePath, (percent, downloaded, total) => {
      if (percent !== lastPercent && percent % 10 === 0) {
        const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
        const totalMB = (total / 1024 / 1024).toFixed(1);
        reporter.log('info', `  Progress: ${percent}% (${downloadedMB}/${totalMB} MB)`);
        lastPercent = percent;
      }
    });

    reporter.log('debug', 'Download complete. Extracting...');

    await tar.x({
      file: archivePath,
      cwd: tempDir,
    });

    const extractedKtctl = path.join(tempDir, 'ktctl');
    if (!fs.existsSync(extractedKtctl)) {
      throw new Error('ktctl binary not found in archive');
    }

    // Copy to install path (user-writable by default, no sudo needed)
    fs.copyFileSync(extractedKtctl, ktctlPath);
    fs.chmodSync(ktctlPath, 0o755);

    // macOS quarantine removal
    if (os.platform() === 'darwin') {
      try {
        spawnSync('xattr', ['-d', 'com.apple.quarantine', ktctlPath], { stdio: 'pipe' });
      } catch {
        // Ignore if xattr fails
      }
    }

    setKtctlPath(ktctlPath);
    reporter.log('success', `ktctl ${version} installed at ${ktctlPath}`);

    return ktctlPath;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Find ktctl binary, searching bundled location first, then system paths.
 */
export function findKtctl(): string | null {
  // 1. Check configured path
  const configuredPath = getKtctlPath();
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  // 2. Check bundled location (~/.kt-connect-service/bin/ktctl)
  const bundledPath = path.join(getDefaultBinDir(), 'ktctl');
  if (fs.existsSync(bundledPath)) {
    setKtctlPath(bundledPath);
    return bundledPath;
  }

  // 3. Check common system locations
  const commonPaths = ['/usr/local/bin/ktctl', '/usr/bin/ktctl', path.join(os.homedir(), '.local/bin/ktctl')];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      setKtctlPath(p);
      return p;
    }
  }

  // 4. Check PATH
  const result = spawnSync('which', ['ktctl'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status === 0) {
    const foundPath = (result.stdout ?? '').trim();
    if (foundPath) {
      setKtctlPath(foundPath);
      return foundPath;
    }
  }

  return null;
}

/**
 * Ensure ktctl is available — auto-download if not found.
 * This is the main entry point used by connect/watch/switch.
 */
export async function ensureKtctl(): Promise<string> {
  const existing = findKtctl();
  if (existing) return existing;

  reporter.log('info', 'ktctl not found, downloading automatically...');
  return install();
}

export function getInstalledVersion(ktctlPath?: string): string | null {
  const binPath = ktctlPath || getKtctlPath() || 'ktctl';

  const result = spawnSync(binPath, ['version'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.status !== 0) return null;
  const output = result.stdout ?? '';
  const match = output.match(/version[:\s]+v?(\d+\.\d+\.\d+)/i);
  return match ? match[1] : output.trim() || null;
}

export function isKtctlInstalled(): boolean {
  return findKtctl() !== null;
}
