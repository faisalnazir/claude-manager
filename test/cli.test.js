import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const CLI = path.resolve(process.cwd(), 'dist/cli.js');

const exec = (args) => {
  try {
    return { stdout: execSync(`node ${CLI} ${args}`, { encoding: 'utf8' }), exitCode: 0 };
  } catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, exitCode: error.status || 1 };
  }
};

describe('CLI Commands', () => {
  describe('--version', () => {
    it('should display version', () => {
      const result = exec('--version');
      expect(result.stdout).toContain('cm v');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('--help', () => {
    it('should display help', () => {
      const result = exec('--help');
      expect(result.stdout).toContain('Claude Settings Manager');
      expect(result.stdout).toContain('Usage:');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('list', () => {
    it('should list profiles', () => {
      const result = exec('list');
      expect(result.stdout).toMatch(/Profiles/);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('status', () => {
    it('should show status', () => {
      const result = exec('status');
      expect(result.stdout).toMatch(/Claude Settings Manager/);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('parallel list', () => {
    it('should list profiles for parallel launch', () => {
      const result = exec('parallel list');
      expect(result.stdout).toMatch(/Available Profiles/);
      expect(result.exitCode).toBe(0);
    });
  });
});

describe('Utility Functions', () => {
  describe('safeParseInt', () => {
    it('should parse valid integers', async () => {
      const { safeParseInt } = await import('../src/utils.js');
      expect(safeParseInt('42')).toBe(42);
      expect(safeParseInt('0')).toBe(0);
      expect(safeParseInt('123')).toBe(123);
    });

    it('should return default for invalid input', async () => {
      const { safeParseInt } = await import('../src/utils.js');
      expect(safeParseInt('abc')).toBe(null);
      expect(safeParseInt('')).toBe(null);
      expect(safeParseInt('invalid')).toBe(null);
    });

    it('should return custom default value', async () => {
      const { safeParseInt } = await import('../src/utils.js');
      expect(safeParseInt('abc', 0)).toBe(0);
      expect(safeParseInt('', -1)).toBe(-1);
    });
  });

  describe('sanitizeProfileName', () => {
    it('should sanitize profile names', async () => {
      const { sanitizeProfileName } = await import('../src/utils.js');
      expect(sanitizeProfileName('My Profile')).toBe('my-profile');
      expect(sanitizeProfileName('Test@Profile!')).toBe('test-profile');
      expect(sanitizeProfileName('Hello   World')).toBe('hello-world');
    });

    it('should handle valid input', async () => {
      const { sanitizeProfileName } = await import('../src/utils.js');
      expect(sanitizeProfileName('my-profile_123')).toBe('my-profile_123');
      expect(sanitizeProfileName('--test--')).toBe('test');
      expect(sanitizeProfileName('test---profile')).toBe('test-profile');
    });
  });
});
