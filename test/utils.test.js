import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  safeParseInt,
  sanitizeProfileName,
  validateProfile,
  buildProfileData,
  logError,
} from '../src/utils.js';
import { Cache } from '../src/cache.js';

// Mock console.error
const originalError = console.error;

describe('safeParseInt', () => {
  it('should parse valid integers', () => {
    expect(safeParseInt('42')).toBe(42);
    expect(safeParseInt('0')).toBe(0);
    expect(safeParseInt('123')).toBe(123);
  });

  it('should return default value for invalid input', () => {
    expect(safeParseInt('abc', 0)).toBe(0);
    expect(safeParseInt('', -1)).toBe(-1);
    expect(safeParseInt(null, 5)).toBe(5);
    expect(safeParseInt(undefined, 10)).toBe(10);
  });

  it('should return null as default when not specified', () => {
    expect(safeParseInt('invalid')).toBe(null);
  });
});

describe('sanitizeProfileName', () => {
  it('should convert to lowercase and replace special chars', () => {
    expect(sanitizeProfileName('My Profile')).toBe('my-profile');
    expect(sanitizeProfileName('Test@Profile!')).toBe('test-profile');
    expect(sanitizeProfileName('Hello   World')).toBe('hello-world');
  });

  it('should handle valid characters', () => {
    expect(sanitizeProfileName('my-profile_123')).toBe('my-profile_123');
    expect(sanitizeProfileName('Test-Profile')).toBe('test-profile');
  });

  it('should trim leading/trailing dashes', () => {
    expect(sanitizeProfileName('--test--')).toBe('test');
    expect(sanitizeProfileName('---profile---')).toBe('profile');
  });

  it('should collapse multiple dashes', () => {
    expect(sanitizeProfileName('test---profile')).toBe('test-profile');
    expect(sanitizeProfileName('hello----world')).toBe('hello-world');
  });
});

describe('validateProfile', () => {
  const PROVIDERS = [
    { label: 'Anthropic (Direct)', value: 'anthropic', url: '', needsKey: true },
    { label: 'Z.AI', value: 'zai', url: 'https://api.z.ai/api/anthropic', needsKey: true },
    { label: 'MiniMax', value: 'minimax', url: 'https://api.minimax.io/anthropic', needsKey: true },
    { label: 'Kimi for Coding', value: 'kimi', url: 'https://api.kimi.com/coding/', needsKey: true },
  ];

  it('should reject profile without name', () => {
    const result = validateProfile({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Profile name is required');
  });

  it('should accept valid Anthropic profile', () => {
    const profile = {
      name: 'Test Profile',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'sk-ant-api123-very-long-key',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      },
    };
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject invalid API key format for Anthropic', () => {
    const profile = {
      name: 'Test Profile',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'invalid-key',
      },
    };
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('sk-ant-'))).toBe(true);
  });

  it('should accept MiniMax with sk-cp- keys', () => {
    const profile = {
      name: 'MiniMax Profile',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'sk-cp-123456789012345678901234',
        ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
      },
    };
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
  });

  it('should accept Kimi with various model formats', () => {
    const profile = {
      name: 'Kimi Profile',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'sk-anything-long-enough-key',
        ANTHROPIC_MODEL: 'kimi-for-coding',
        ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/',
      },
    };
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
  });

  it('should reject invalid URLs', () => {
    const profile = {
      name: 'Test Profile',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'sk-ant-api123',
        ANTHROPIC_BASE_URL: 'not-a-url',
      },
    };
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Base URL is not a valid URL');
  });

  it('should reject API keys that are too short', () => {
    const profile = {
      name: 'Test Profile',
      env: {
        ANTHROPIC_AUTH_TOKEN: 'sk-ant-short',
      },
    };
    const result = validateProfile(profile);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('API key appears too short');
  });
});

describe('buildProfileData', () => {
  const PROVIDERS = [
    { label: 'Anthropic (Direct)', value: 'anthropic', url: '', needsKey: true },
    { label: 'Z.AI', value: 'zai', url: 'https://api.z.ai/api/anthropic', needsKey: true },
  ];

  it('should build profile with all fields', () => {
    const profile = buildProfileData(
      'Test Profile',
      'zai',
      'sk-ant-api123',
      'claude-3-5-sonnet-20241022',
      'providers',
      PROVIDERS
    );

    expect(profile.name).toBe('Test Profile');
    expect(profile.group).toBe('providers');
    expect(profile.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-ant-api123');
    expect(profile.env.ANTHROPIC_MODEL).toBe('claude-3-5-sonnet-20241022');
    expect(profile.env.ANTHROPIC_BASE_URL).toBe('https://api.z.ai/api/anthropic');
    expect(profile.model).toBe('opus');
    expect(profile.alwaysThinkingEnabled).toBe(true);
    expect(profile.defaultMode).toBe('bypassPermissions');
  });

  it('should build minimal profile', () => {
    const profile = buildProfileData('Minimal', 'anthropic', null, null, null, PROVIDERS);

    expect(profile.name).toBe('Minimal');
    expect(profile.group).toBe(undefined);
    expect(profile.env.ANTHROPIC_AUTH_TOKEN).toBe(undefined);
    expect(profile.env.ANTHROPIC_BASE_URL).toBe(undefined);
  });
});

describe('logError', () => {
  beforeEach(() => {
    console.error = vi.fn();
    process.env.DEBUG = '1';
  });

  afterEach(() => {
    console.error = originalError;
    delete process.env.DEBUG;
    delete process.env.CM_DEBUG;
  });

  it('should log error when DEBUG is set', () => {
    const error = new Error('Test error');
    logError('test-context', error);
    expect(console.error).toHaveBeenCalledWith('[test-context]', 'Test error');
  });

  it('should log error message when DEBUG is set', () => {
    logError('test-context', 'Simple error message');
    expect(console.error).toHaveBeenCalledWith('[test-context]', 'Simple error message');
  });

  it('should not log when DEBUG is not set', () => {
    delete process.env.DEBUG;
    logError('test-context', new Error('Test error'));
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('Cache', () => {
  let cache;

  beforeEach(() => {
    cache = new Cache(1000); // 1 second TTL for testing
  });

  it('should store and retrieve values', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for non-existent keys', () => {
    expect(cache.get('nonexistent')).toBe(undefined);
  });

  it('should check if key exists', () => {
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('nonexistent')).toBe(false);
  });

  it('should expire values after TTL', async () => {
    cache.set('key1', 'value1', 100); // 100ms TTL
    expect(cache.get('key1')).toBe('value1');
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(cache.get('key1')).toBe(undefined);
  });

  it('should clear specific key', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear('key1');
    expect(cache.get('key1')).toBe(undefined);
    expect(cache.get('key2')).toBe('value2');
  });

  it('should clear all keys', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.clear();
    expect(cache.get('key1')).toBe(undefined);
    expect(cache.get('key2')).toBe(undefined);
  });

  it('should compute and cache value', async () => {
    let computeCount = 0;
    const computeFn = async () => {
      computeCount++;
      return 'computed-value';
    };

    const value1 = await cache.getOrCompute('expensive', computeFn);
    expect(value1).toBe('computed-value');
    expect(computeCount).toBe(1);

    const value2 = await cache.getOrCompute('expensive', computeFn);
    expect(value2).toBe('computed-value');
    expect(computeCount).toBe(1); // Should not recompute
  });
});
