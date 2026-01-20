import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import {
  PROFILES_DIR,
  SETTINGS_PATH,
  CLAUDE_JSON_PATH,
  LAST_PROFILE_PATH,
  SKILLS_DIR,
  MCP_REGISTRY_URL,
  SKILL_SOURCES,
  MCP_PAGE_SIZE,
  FETCH_TIMEOUT,
  NPM_OUTDATED_TIMEOUT,
  GIT_CLONE_TIMEOUT,
  GIT_SPARSE_TIMEOUT,
  GIT_MOVE_TIMEOUT,
  GIT_CLEANUP_TIMEOUT,
  DEFAULT_SETTINGS,
  API_TIMEOUT_MS,
} from './constants.js';
import { mcpCache, skillsCache } from './cache.js';

// ============================================================================
// Directory & File Utilities
// ============================================================================

/** Ensure profiles directory exists */
export const ensureProfilesDir = () => {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
};

/** Logging utility */
export const logError = (context, error) => {
  if (process.env.DEBUG || process.env.CM_DEBUG) {
    console.error(`[${context}]`, error?.message || error);
  }
};

/** Safe parse integer */
export const safeParseInt = (value, defaultValue = null) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
};

/** Sanitize profile name for filename */
export const sanitizeProfileName = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

/** Sanitize file path to prevent directory traversal */
const sanitizeFilePath = (filename, baseDir) => {
  const sanitized = path.basename(filename);
  const resolved = path.resolve(baseDir, sanitized);
  if (!resolved.startsWith(baseDir)) {
    return null;
  }
  return sanitized;
};

// ============================================================================
// Profile Management
// ============================================================================

/** Load all profiles from the profiles directory */
export const loadProfiles = () => {
  const profiles = [];
  ensureProfilesDir();

  if (!fs.existsSync(PROFILES_DIR)) {
    return profiles;
  }

  const files = fs.readdirSync(PROFILES_DIR).sort();
  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = path.join(PROFILES_DIR, file);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      profiles.push({
        label: content.name || file.replace('.json', ''),
        value: file,
        key: file,
        group: content.group || null,
        data: content,
      });
    } catch (error) {
      logError('loadProfiles', error);
    }
  }
  return profiles;
};

/** Apply a profile by writing settings and updating MCP servers */
export const applyProfile = (filename) => {
  const profilePath = path.join(PROFILES_DIR, filename);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${filename}`);
  }

  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const { name, mcpServers, ...settings } = profile;

  // Write settings.json
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));

  // Update MCP servers in .claude.json if specified
  if (mcpServers !== undefined) {
    try {
      const claudeJson = fs.existsSync(CLAUDE_JSON_PATH)
        ? JSON.parse(fs.readFileSync(CLAUDE_JSON_PATH, 'utf8'))
        : {};
      claudeJson.mcpServers = mcpServers;
      fs.writeFileSync(CLAUDE_JSON_PATH, JSON.stringify(claudeJson, null, 2));
    } catch (error) {
      logError('applyProfile-mcp', error);
    }
  }

  fs.writeFileSync(LAST_PROFILE_PATH, filename);
  return name || filename;
};

/** Get the last used profile */
export const getLastProfile = () => {
  try {
    const content = fs.readFileSync(LAST_PROFILE_PATH, 'utf8');
    return content.trim() || null;
  } catch {
    return null;
  }
};

/** Check for project-specific profile */
export const checkProjectProfile = () => {
  const localProfile = path.join(process.cwd(), '.claude-profile');
  if (fs.existsSync(localProfile)) {
    try {
      return fs.readFileSync(localProfile, 'utf8').trim();
    } catch (error) {
      logError('checkProjectProfile', error);
    }
  }
  return null;
};

// ============================================================================
// User Interaction
// ============================================================================

/** Confirmation dialog */
export const confirm = (message) => {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
};

// ============================================================================
// Validation
// ============================================================================

/** Provider-specific validation patterns */
const PROVIDER_PATTERNS = {
  minimax: {
    hosts: ['minimax.io', 'minimaxi.com'],
    keyPrefixes: ['sk-ant-', 'sk-cp-'],
  },
  kimi: {
    hosts: ['moonshot.cn', 'kimi.com'],
    keyPrefixes: ['sk-'], // Any sk- prefix accepted
    modelPatterns: [/^moonshot-v1/, /^kimi-k2/, /^kimi-/, /^kimi-for-coding/, /^abab/, /^sk-/],
  },
};

/** Validate profile configuration */
export const validateProfile = (profile) => {
  const errors = [];

  // Name validation
  if (!profile.name?.trim()) {
    errors.push('Profile name is required');
  }

  // API key validation
  if (profile.env?.ANTHROPIC_AUTH_TOKEN) {
    const key = profile.env.ANTHROPIC_AUTH_TOKEN;
    const baseUrl = profile.env?.ANTHROPIC_BASE_URL || '';

    const provider = Object.entries(PROVIDER_PATTERNS).find(([, config]) =>
      config.hosts.some(host => baseUrl.includes(host))
    );
    const [, config] = provider || [, null];

    if (config) {
      if (!config.keyPrefixes.some(prefix => key.startsWith(prefix))) {
        errors.push(`API key should start with "${config.keyPrefixes.join('" or "')}"`);
      }
    } else if (!key.startsWith('sk-ant-')) {
      errors.push('API key should start with "sk-ant-"');
    }

    if (key.length < 20) {
      errors.push('API key appears too short');
    }
  }

  // Model validation
  if (profile.env?.ANTHROPIC_MODEL) {
    const model = profile.env.ANTHROPIC_MODEL;
    const baseUrl = profile.env?.ANTHROPIC_BASE_URL || '';
    const isKimi = PROVIDER_PATTERNS.kimi.hosts.some(host => baseUrl.includes(host));

    if (isKimi) {
      if (!PROVIDER_PATTERNS.kimi.modelPatterns.some(p => p.test(model)) && model.length < 3) {
        errors.push(`Model format looks invalid for Kimi: ${model}`);
      }
    } else {
      const validPatterns = [
        /^claude-\d+(\.\d+)?(-\d+)?$/,
        /^glm-/,
        /^minimax-/,
        /^MiniMax-M\d+(\.\d+)?$/,
        /^anthropic\.claude-/
      ];
      if (!validPatterns.some(p => p.test(model))) {
        errors.push(`Model format looks invalid: ${model}`);
      }
    }
  }

  // URL validation
  if (profile.env?.ANTHROPIC_BASE_URL) {
    try {
      new URL(profile.env.ANTHROPIC_BASE_URL);
    } catch {
      errors.push('Base URL is not a valid URL');
    }
  }

  return { valid: errors.length === 0, errors };
};

// ============================================================================
// Skills Management
// ============================================================================

/** Get installed skills */
export const getInstalledSkills = () => {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  try {
    return fs.readdirSync(SKILLS_DIR).filter(f => {
      const skillPath = path.join(SKILLS_DIR, f);
      try {
        return fs.statSync(skillPath).isDirectory() && !f.startsWith('.');
      } catch {
        return false;
      }
    });
  } catch (error) {
    logError('getInstalledSkills', error);
    return [];
  }
};

/** Remove a skill */
export const removeSkill = (skillName) => {
  const skillPath = path.join(SKILLS_DIR, skillName);
  if (!fs.existsSync(skillPath)) {
    return { success: false, message: 'Skill not found' };
  }
  try {
    fs.rmSync(skillPath, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    logError('removeSkill', error);
    return { success: false, message: 'Failed to remove skill' };
  }
};

/** Fetch skills from all sources with caching */
export const fetchSkills = async () => {
  return skillsCache.getOrCompute('all-skills', async () => {
    const seen = new Set();
    const skills = [];

    const fetchSource = async (source) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      try {
        const res = await fetch(source.url, {
          signal: controller.signal,
          headers: { 'Accept': 'application/vnd.github.v3+json' }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (Array.isArray(data)) {
          for (const s of data.filter(item => item.type === 'dir')) {
            if (!seen.has(s.name)) {
              seen.add(s.name);
              skills.push({
                label: s.name,
                value: `${source.base}/${s.name}`,
                key: s.name,
              });
            }
          }
        }
      } catch (error) {
        logError(`fetchSkills(${source.url})`, error);
      } finally {
        clearTimeout(timeout);
      }
    };

    await Promise.all(SKILL_SOURCES.map(fetchSource));

    return skills.sort((a, b) => a.label.localeCompare(b.label));
  });
};

/** Add skill to Claude from GitHub URL */
export const addSkillToClaudeJson = (skillName, skillUrl) => {
  try {
    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true });
    }

    const skillPath = path.join(SKILLS_DIR, skillName);
    if (fs.existsSync(skillPath)) {
      return { success: false, message: 'Skill already installed' };
    }

    // Validate and parse GitHub URL
    const match = skillUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/);
    if (!match) return { success: false, message: 'Invalid skill URL' };

    const [, owner, repo, , skillSubPath] = match;
    const sanitizedTempDir = sanitizeFilePath(`skill-clone-${Date.now()}`, '/tmp');
    const finalTempDir = path.join('/tmp', sanitizedTempDir || 'skill-clone');

    // Clone with sparse checkout
    execSync(
      `git clone --depth 1 --filter=blob:none --sparse "https://github.com/${owner}/${repo}.git" "${finalTempDir}"`,
      { timeout: GIT_CLONE_TIMEOUT, stdio: 'ignore' }
    );
    execSync(
      `cd "${finalTempDir}" && git sparse-checkout set "${skillSubPath}"`,
      { timeout: GIT_SPARSE_TIMEOUT, stdio: 'ignore' }
    );

    // Move skill to destination
    const sourcePath = path.join(finalTempDir, skillSubPath);
    if (fs.existsSync(sourcePath)) {
      execSync(`mv "${sourcePath}" "${skillPath}"`, { timeout: GIT_MOVE_TIMEOUT, stdio: 'ignore' });
    }

    // Cleanup
    execSync(`rm -rf "${finalTempDir}"`, { timeout: GIT_CLEANUP_TIMEOUT, stdio: 'ignore' });

    // Invalidate cache
    skillsCache.clear('all-skills');

    return { success: true };
  } catch (e) {
    logError('addSkillToClaudeJson', e);
    return { success: false, message: 'Failed to download skill' };
  }
};

// ============================================================================
// MCP Server Management
// ============================================================================

/** Search MCP servers with caching */
export const searchMcpServers = async (query, offset = 0) => {
  const cacheKey = `mcp-search-${query || 'all'}`;

  const allServers = await mcpCache.getOrCompute(cacheKey, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const res = await fetch(`${MCP_REGISTRY_URL}?limit=200`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const seen = new Set();
      return data.servers.filter(s => {
        if (seen.has(s.server.name)) return false;
        seen.add(s.server.name);
        const isLatest = s._meta?.['io.modelcontextprotocol.registry/official']?.isLatest !== false;
        const matchesQuery = !query ||
          s.server.name.toLowerCase().includes(query.toLowerCase()) ||
          s.server.description?.toLowerCase().includes(query.toLowerCase());
        return isLatest && matchesQuery;
      });
    } catch (error) {
      logError('searchMcpServers', error);
      return [];
    } finally {
      clearTimeout(timeout);
    }
  });

  return {
    servers: allServers.slice(offset, offset + MCP_PAGE_SIZE),
    total: allServers.length,
    hasMore: offset + MCP_PAGE_SIZE < allServers.length,
    offset
  };
};

/** Add MCP server to profile */
export const addMcpToProfile = (server, profileFile) => {
  const sanitizedFile = sanitizeFilePath(profileFile, PROFILES_DIR);
  if (!sanitizedFile) {
    throw new Error('Invalid profile file');
  }

  const profilePath = path.join(PROFILES_DIR, sanitizedFile);
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  if (!profile.mcpServers) profile.mcpServers = {};

  const s = server.server;
  const name = s.name.split('/').pop();

  if (s.remotes?.[0]) {
    const remote = s.remotes[0];
    profile.mcpServers[name] = {
      type: remote.type === 'streamable-http' ? 'http' : remote.type,
      url: remote.url,
    };
  } else if (s.packages?.[0]) {
    const pkg = s.packages[0];
    if (pkg.registryType === 'npm') {
      profile.mcpServers[name] = {
        type: 'stdio',
        command: 'npx',
        args: ['-y', pkg.identifier],
      };
    } else if (pkg.registryType === 'pypi') {
      profile.mcpServers[name] = {
        type: 'stdio',
        command: 'uvx',
        args: [pkg.identifier],
      };
    }
  }

  fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
  return name;
};

// ============================================================================
// Settings & Launch
// ============================================================================

/** Create default settings file */
export const createDefaultSettings = () => {
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  }
};

/** Build profile data for new profile */
export const buildProfileData = (name, provider, apiKey, model, group, providers) => {
  const prov = providers.find(p => p.value === provider);
  return {
    name,
    group: group || undefined,
    env: {
      ...(apiKey && { ANTHROPIC_AUTH_TOKEN: apiKey }),
      ...(model && { ANTHROPIC_MODEL: model }),
      ...(prov?.url && { ANTHROPIC_BASE_URL: prov.url }),
      API_TIMEOUT_MS,
    },
    model: 'opus',
    alwaysThinkingEnabled: true,
    defaultMode: 'bypassPermissions',
  };
};

/** Check for Claude Code updates */
export const checkForUpdate = async (skipUpdate) => {
  if (skipUpdate) return { needsUpdate: false };

  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    // Get current version
    const versionResult = await execAsync('claude --version 2>/dev/null').catch(() => ({ stdout: '' }));
    const current = versionResult.stdout.match(/(\d+\.\d+\.\d+)/)?.[1];
    if (!current) return { needsUpdate: false };

    let needsUpdate = false;

    // Check if installed via brew (macOS)
    if (process.platform === 'darwin') {
      const outdatedResult = await execAsync('brew outdated claude-code 2>&1 || true').catch(() => ({ stdout: '' }));
      needsUpdate = outdatedResult.stdout.includes('claude-code');
    }

    // Check if installed via npm
    if (!needsUpdate) {
      const npmListResult = await execAsync('npm list -g @anthropic-ai/claude-code 2>/dev/null').catch(() => ({ stdout: '' }));
      if (npmListResult.stdout.includes('@anthropic-ai/claude-code')) {
        try {
          const npmOutdated = await execAsync('npm outdated -g @anthropic-ai/claude-code --json 2>/dev/null || true', { timeout: NPM_OUTDATED_TIMEOUT });
          needsUpdate = npmOutdated.stdout.length > 0;
        } catch {
          needsUpdate = true;
        }
      }
    }

    return { current, needsUpdate };
  } catch (error) {
    logError('checkForUpdate', error);
    return { needsUpdate: false };
  }
};

/** Launch Claude Code */
export const launchClaude = (dangerMode) => {
  try {
    const args = dangerMode ? ['--dangerously-skip-permissions'] : [];
    const command = `claude ${args.join(' ')}`;
    execSync(command, { stdio: 'inherit' });
  } catch (e) {
    process.exit(e.status || 1);
  }
  process.exit(0);
};
