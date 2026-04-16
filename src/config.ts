import Conf from 'conf';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { Config, Defaults, DEFAULT_IMAGE, DEFAULT_NAMESPACE } from './types';

function getRealHomeDir(): string {
  const sudoUser = process.env.SUDO_USER;
  if (sudoUser) {
    if (process.platform === 'darwin') return `/Users/${sudoUser}`;
    return `/home/${sudoUser}`;
  }
  return os.homedir();
}

const REAL_HOME = getRealHomeDir();
const CONFIG_DIR = path.join(REAL_HOME, '.kt-connect-service');
const DEFAULT_LOG_DIR = path.join(CONFIG_DIR, 'logs');
const DEFAULT_PID_FILE = path.join(CONFIG_DIR, 'ktctl.pid');

const DEFAULTS: Defaults = {
  image: DEFAULT_IMAGE,
  namespace: DEFAULT_NAMESPACE,
};

const config = new Conf<Config>({
  projectName: 'kt-connect-service',
  cwd: CONFIG_DIR,
  defaults: {
    defaults: DEFAULTS,
    logDir: DEFAULT_LOG_DIR,
    pidFile: DEFAULT_PID_FILE,
  },
});

function ensureDirectories(): void {
  const logDir = config.get('logDir');
  const pidDir = path.dirname(config.get('pidFile'));
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  if (!fs.existsSync(pidDir)) fs.mkdirSync(pidDir, { recursive: true });
}

ensureDirectories();
migrateLegacyConfig();

/**
 * One-time migration: pre-0.2 used `profiles`. If found, copy the active
 * profile's image into `defaults` (only if user hasn't already customized it),
 * then strip the legacy keys.
 */
function migrateLegacyConfig(): void {
  const store = config.store as any;
  if (!store.profiles) return;

  const activeName = store.activeProfile;
  const activeProfile = activeName && store.profiles[activeName];
  const currentDefaults = config.get('defaults');

  if (activeProfile && activeProfile.image && currentDefaults.image === DEFAULT_IMAGE) {
    const migrated: Defaults = {
      ...currentDefaults,
      image: activeProfile.image,
    };
    if (activeProfile.namespace) migrated.namespace = activeProfile.namespace;
    if (activeProfile.kubeconfig) migrated.kubeconfig = activeProfile.kubeconfig;
    if (activeProfile.extraArgs) migrated.extraArgs = activeProfile.extraArgs;
    config.set('defaults', migrated);
  }

  (config as any).delete('profiles');
  (config as any).delete('activeProfile');
}

export function getConfig(): Config {
  return {
    defaults: config.get('defaults'),
    logDir: config.get('logDir'),
    pidFile: config.get('pidFile'),
    ktctlPath: config.get('ktctlPath'),
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

// Defaults management — replaces profile system
const VALID_KEYS = ['image', 'namespace', 'kubeconfig', 'extraArgs'] as const;
type DefaultKey = (typeof VALID_KEYS)[number];

export function isValidDefaultKey(key: string): key is DefaultKey {
  return (VALID_KEYS as readonly string[]).includes(key);
}

export function getDefaults(): Defaults {
  return config.get('defaults');
}

export function getDefault<K extends DefaultKey>(key: K): Defaults[K] {
  return getDefaults()[key];
}

export function setDefault(key: DefaultKey, value: string | string[]): void {
  const current = getDefaults();
  const updated: Defaults = { ...current, [key]: value };
  config.set('defaults', updated);
}

export function unsetDefault(key: DefaultKey): void {
  const current = getDefaults();
  const updated = { ...current } as any;
  delete updated[key];
  // Restore hard defaults for required keys
  if (key === 'image') updated.image = DEFAULT_IMAGE;
  if (key === 'namespace') updated.namespace = DEFAULT_NAMESPACE;
  config.set('defaults', updated);
}

export function clearConfig(): void {
  config.clear();
  ensureDirectories();
}

export default config;
