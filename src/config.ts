import Conf from 'conf';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { Config, ConnectionProfile } from './types';

// Use original user's home when running with sudo, otherwise use current user's home
function getRealHomeDir(): string {
  // Check if running with sudo and get the original user's home
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser) {
    // On macOS, home is /Users/username; on Linux, it's /home/username
    if (process.platform === 'darwin') {
      return `/Users/${sudoUser}`;
    } else {
      return `/home/${sudoUser}`;
    }
  }
  return os.homedir();
}

const REAL_HOME = getRealHomeDir();
const CONFIG_DIR = path.join(REAL_HOME, '.kt-connect-service');
const DEFAULT_LOG_DIR = path.join(CONFIG_DIR, 'logs');
const DEFAULT_PID_FILE = path.join(CONFIG_DIR, 'ktctl.pid');

const config = new Conf<Config>({
  projectName: 'kt-connect-service',
  cwd: CONFIG_DIR, // Use fixed config directory regardless of sudo
  defaults: {
    profiles: {},
    logDir: DEFAULT_LOG_DIR,
    pidFile: DEFAULT_PID_FILE,
  },
});

// Ensure directories exist
function ensureDirectories(): void {
  const logDir = config.get('logDir');
  const pidDir = path.dirname(config.get('pidFile'));

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  if (!fs.existsSync(pidDir)) {
    fs.mkdirSync(pidDir, { recursive: true });
  }
}

ensureDirectories();

export function getConfig(): Config {
  return {
    profiles: config.get('profiles'),
    activeProfile: config.get('activeProfile'),
    ktctlPath: config.get('ktctlPath'),
    logDir: config.get('logDir'),
    pidFile: config.get('pidFile'),
  };
}

export function setKtctlPath(ktctlPath: string): void {
  config.set('ktctlPath', ktctlPath);
}

export function getKtctlPath(): string | undefined {
  return config.get('ktctlPath');
}

export function getLogDir(): string {
  return config.get('logDir');
}

export function getPidFile(): string {
  return config.get('pidFile');
}

// Profile management
export function addProfile(profile: ConnectionProfile): void {
  const profiles = config.get('profiles');
  profiles[profile.name] = {
    ...profile,
    createdAt: profile.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  config.set('profiles', profiles);
}

export function getProfile(name: string): ConnectionProfile | undefined {
  const profiles = config.get('profiles');
  return profiles[name];
}

export function getAllProfiles(): ConnectionProfile[] {
  const profiles = config.get('profiles');
  return Object.values(profiles);
}

export function removeProfile(name: string): boolean {
  const profiles = config.get('profiles');
  if (profiles[name]) {
    delete profiles[name];
    config.set('profiles', profiles);

    // Clear active profile if it was removed
    if (config.get('activeProfile') === name) {
      config.delete('activeProfile');
    }
    return true;
  }
  return false;
}

export function updateProfile(name: string, updates: Partial<ConnectionProfile>): boolean {
  const profiles = config.get('profiles');
  if (profiles[name]) {
    profiles[name] = {
      ...profiles[name],
      ...updates,
      name, // Ensure name cannot be changed
      updatedAt: new Date().toISOString(),
    };
    config.set('profiles', profiles);
    return true;
  }
  return false;
}

export function setActiveProfile(name: string | undefined): void {
  if (name === undefined) {
    config.delete('activeProfile');
  } else {
    config.set('activeProfile', name);
  }
}

export function getActiveProfile(): string | undefined {
  return config.get('activeProfile');
}

export function clearConfig(): void {
  config.clear();
  ensureDirectories();
}

export default config;
