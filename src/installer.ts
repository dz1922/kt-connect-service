import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';
import fetch from 'node-fetch';
import * as tar from 'tar';
import { setKtctlPath, getKtctlPath } from './config';
import { InstallOptions } from './types';

const GITHUB_API_URL = 'https://api.github.com/repos/alibaba/kt-connect/releases/latest';
const DOWNLOAD_BASE_URL = 'https://github.com/alibaba/kt-connect/releases/download';

// China mirror (if available)
const MIRROR_BASE_URL = 'https://ghproxy.com/https://github.com/alibaba/kt-connect/releases/download';

interface GithubRelease {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

function getPlatform(): string {
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

function getArch(): string {
  const arch = os.arch();
  switch (arch) {
    case 'x64':
      return 'amd64';
    case 'arm64':
      return 'arm64';
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
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
  const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout

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

export async function install(options: InstallOptions = {}): Promise<string> {
  const version = options.version || (await getLatestVersion());
  const installPath = options.installPath || '/usr/local/bin';
  const ktctlPath = path.join(installPath, 'ktctl');

  // Check if already installed
  if (!options.force && fs.existsSync(ktctlPath)) {
    const existingVersion = getInstalledVersion(ktctlPath);
    if (existingVersion) {
      console.log(`ktctl is already installed (version: ${existingVersion})`);
      setKtctlPath(ktctlPath);
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
      execSync(`sudo cp "${extractedKtctl}" "${destPath}"`, { stdio: 'inherit' });
      execSync(`sudo chmod +x "${destPath}"`, { stdio: 'inherit' });

      // macOS quarantine removal
      if (os.platform() === 'darwin') {
        try {
          execSync(`sudo xattr -d com.apple.quarantine "${destPath}"`, { stdio: 'pipe' });
        } catch {
          // Ignore if xattr fails (attribute might not exist)
        }
      }
    } else {
      fs.copyFileSync(extractedKtctl, destPath);
      fs.chmodSync(destPath, 0o755);
    }

    setKtctlPath(destPath);
    console.log(`ktctl ${version} installed successfully at ${destPath}`);

    return destPath;
  } finally {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function isWritable(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function getInstalledVersion(ktctlPath?: string): string | null {
  const binPath = ktctlPath || getKtctlPath() || 'ktctl';

  try {
    const result = execSync(`"${binPath}" version`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Parse version from output
    const match = result.match(/version[:\s]+v?(\d+\.\d+\.\d+)/i);
    return match ? match[1] : result.trim();
  } catch {
    return null;
  }
}

export function isKtctlInstalled(): boolean {
  const ktctlPath = getKtctlPath();
  if (ktctlPath && fs.existsSync(ktctlPath)) {
    return true;
  }

  // Check if ktctl is in PATH
  try {
    execSync('which ktctl', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function findKtctl(): string | null {
  // First check configured path
  const configuredPath = getKtctlPath();
  if (configuredPath && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  // Check common locations
  const commonPaths = ['/usr/local/bin/ktctl', '/usr/bin/ktctl', path.join(os.homedir(), '.local/bin/ktctl')];

  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      setKtctlPath(p);
      return p;
    }
  }

  // Check PATH
  try {
    const result = execSync('which ktctl', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const foundPath = result.trim();
    if (foundPath) {
      setKtctlPath(foundPath);
      return foundPath;
    }
  } catch {
    // Not found in PATH
  }

  return null;
}
