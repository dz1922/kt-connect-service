import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Config', () => {
  let tmpDir: string;
  let configModule: typeof import('../src/config');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ktcs-test-'));
    vi.stubEnv('HOME', tmpDir);
    vi.stubEnv('APPDATA', tmpDir);
    delete process.env.SUDO_USER;

    vi.resetModules();
    configModule = await import('../src/config');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('defaults', () => {
    it('should return built-in defaults initially', () => {
      const d = configModule.getDefaults();
      expect(d.image).toContain('kt-connect-shadow');
      expect(d.namespace).toBe('default');
    });

    it('should set and get image', () => {
      configModule.setDefault('image', 'my-registry/shadow:latest');
      expect(configModule.getDefault('image')).toBe('my-registry/shadow:latest');
    });

    it('should set and get namespace', () => {
      configModule.setDefault('namespace', 'staging');
      expect(configModule.getDefault('namespace')).toBe('staging');
    });

    it('should set and get kubeconfig', () => {
      configModule.setDefault('kubeconfig', '/custom/kubeconfig');
      expect(configModule.getDefault('kubeconfig')).toBe('/custom/kubeconfig');
    });

    it('should set extraArgs as array', () => {
      configModule.setDefault('extraArgs', ['--debug', '--tunnel', 'true']);
      expect(configModule.getDefault('extraArgs')).toEqual(['--debug', '--tunnel', 'true']);
    });

    it('should unset image back to built-in', () => {
      configModule.setDefault('image', 'custom');
      configModule.unsetDefault('image');
      expect(configModule.getDefault('image')).toContain('kt-connect-shadow');
    });

    it('should unset namespace back to default', () => {
      configModule.setDefault('namespace', 'custom');
      configModule.unsetDefault('namespace');
      expect(configModule.getDefault('namespace')).toBe('default');
    });

    it('should unset kubeconfig to undefined', () => {
      configModule.setDefault('kubeconfig', '/foo');
      configModule.unsetDefault('kubeconfig');
      expect(configModule.getDefault('kubeconfig')).toBeUndefined();
    });
  });

  describe('isValidDefaultKey', () => {
    it('accepts known keys', () => {
      expect(configModule.isValidDefaultKey('image')).toBe(true);
      expect(configModule.isValidDefaultKey('namespace')).toBe(true);
      expect(configModule.isValidDefaultKey('kubeconfig')).toBe(true);
      expect(configModule.isValidDefaultKey('extraArgs')).toBe(true);
    });

    it('rejects unknown keys', () => {
      expect(configModule.isValidDefaultKey('bogus')).toBe(false);
      expect(configModule.isValidDefaultKey('profile')).toBe(false);
    });
  });
});
