import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Config', () => {
  let tmpDir: string;
  let configModule: typeof import('../src/config');

  beforeEach(async () => {
    // Create a temp directory for config isolation
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ktcs-test-'));

    // Set env to redirect config to tmpDir
    vi.stubEnv('HOME', tmpDir);
    vi.stubEnv('APPDATA', tmpDir);
    // Remove SUDO_USER so getRealHomeDir uses HOME
    delete process.env.SUDO_USER;

    // Force re-import to pick up new HOME
    vi.resetModules();
    configModule = await import('../src/config');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    // Clean up temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('profile CRUD', () => {
    it('should add and retrieve a profile', () => {
      const profile = {
        name: 'test',
        image: 'test-image',
        namespace: 'default',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      configModule.addProfile(profile);
      const retrieved = configModule.getProfile('test');
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('test');
      expect(retrieved!.image).toBe('test-image');
    });

    it('should return undefined for non-existent profile', () => {
      expect(configModule.getProfile('nonexistent')).toBeUndefined();
    });

    it('should list all profiles', () => {
      configModule.addProfile({
        name: 'a',
        image: 'img-a',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      configModule.addProfile({
        name: 'b',
        image: 'img-b',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const all = configModule.getAllProfiles();
      expect(all).toHaveLength(2);
    });

    it('should update a profile', () => {
      configModule.addProfile({
        name: 'up',
        image: 'old',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      configModule.updateProfile('up', { image: 'new' });
      expect(configModule.getProfile('up')!.image).toBe('new');
    });

    it('should remove a profile', () => {
      configModule.addProfile({
        name: 'rm',
        image: 'x',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      expect(configModule.removeProfile('rm')).toBe(true);
      expect(configModule.getProfile('rm')).toBeUndefined();
    });

    it('should return false when removing non-existent profile', () => {
      expect(configModule.removeProfile('nope')).toBe(false);
    });
  });

  describe('active profile', () => {
    it('should set and get active profile', () => {
      configModule.addProfile({
        name: 'act',
        image: 'i',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      configModule.setActiveProfile('act');
      expect(configModule.getActiveProfile()).toBe('act');
    });

    it('should clear active profile when removed', () => {
      configModule.addProfile({
        name: 'gone',
        image: 'i',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      configModule.setActiveProfile('gone');
      configModule.removeProfile('gone');
      expect(configModule.getActiveProfile()).toBeUndefined();
    });

    it('should clear active profile when set to undefined', () => {
      configModule.setActiveProfile('test');
      configModule.setActiveProfile(undefined);
      expect(configModule.getActiveProfile()).toBeUndefined();
    });
  });
});
