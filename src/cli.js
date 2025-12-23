import React, { useState, useEffect, useMemo } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawnSync } from 'child_process';
import { createInterface } from 'readline';
import Fuse from 'fuse.js';

const VERSION = "1.5.3";

// Constants
const LOGO = `██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝`;

const MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0/servers';
const PROFILES_DIR = path.join(os.homedir(), '.claude', 'profiles');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json');
const LAST_PROFILE_PATH = path.join(os.homedir(), '.claude', '.last-profile');

const args = process.argv.slice(2);
const cmd = args[0];

// Ensure profiles directory exists
if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });

// CLI flags
if (args.includes('-v') || args.includes('--version')) {
  console.log(`cm v${VERSION}`);
  process.exit(0);
}

if (args.includes('-h') || args.includes('--help')) {
  console.log(`cm v${VERSION} - Claude Settings Manager

Usage: cm [command] [options]

Commands:
  (none)          Select profile interactively
  new             Create a new profile
  edit <n>        Edit profile (by name or number)
  copy <n> <new>  Copy/duplicate a profile
  delete <n>      Delete profile (by name or number)
  status          Show current settings
  list            List all profiles
  config          Open Claude settings.json in editor
  mcp [query]     Search and add MCP servers
  mcp remove      Remove MCP server from profile
  skills          Browse and add Anthropic skills
  skills list     List installed skills
  skills remove   Remove an installed skill

Options:
  --last, -l      Use last profile without menu
  --skip-update   Skip update check
  --yolo          Run claude with --dangerously-skip-permissions
  --force, -f     Skip confirmation prompts (e.g., for delete)
  -v, --version   Show version
  -h, --help      Show help`);
  process.exit(0);
}

const skipUpdate = args.includes('--skip-update');
const useLast = args.includes('--last') || args.includes('-l');
const dangerMode = args.includes('--dangerously-skip-permissions') || args.includes('--yolo');

// Helper functions
const loadProfiles = () => {
  const profiles = [];
  if (fs.existsSync(PROFILES_DIR)) {
    for (const file of fs.readdirSync(PROFILES_DIR).sort()) {
      if (file.endsWith('.json')) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), 'utf8'));
          profiles.push({
            label: content.name || file.replace('.json', ''),
            value: file,
            key: file,
            group: content.group || null,
            data: content,
          });
        } catch {}
      }
    }
  }
  return profiles;
};

const applyProfile = (filename) => {
  const profilePath = path.join(PROFILES_DIR, filename);
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const { name, group, mcpServers, ...settings } = profile;
  
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
    } catch {}
  }
  
  fs.writeFileSync(LAST_PROFILE_PATH, filename);
  return name || filename;
};

const getLastProfile = () => {
  try { return fs.readFileSync(LAST_PROFILE_PATH, 'utf8').trim(); } catch { return null; }
};

const checkProjectProfile = () => {
  const localProfile = path.join(process.cwd(), '.claude-profile');
  if (fs.existsSync(localProfile)) {
    return fs.readFileSync(localProfile, 'utf8').trim();
  }
  return null;
};

const logError = (context, error) => {
  if (process.env.DEBUG || process.env.CM_DEBUG) {
    console.error(`[${context}]`, error?.message || error);
  }
};

const confirm = async (message) => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
};

// Profile validation
const validateProfile = (profile) => {
  const errors = [];

  if (!profile.name || profile.name.trim().length === 0) {
    errors.push('Profile name is required');
  }

  // Validate API key format if present
  if (profile.env?.ANTHROPIC_AUTH_TOKEN) {
    const key = profile.env.ANTHROPIC_AUTH_TOKEN;
    if (!key.startsWith('sk-ant-')) {
      errors.push('API key should start with "sk-ant-"');
    }
    if (key.length < 20) {
      errors.push('API key appears too short');
    }
  }

  // Validate model format if present
  if (profile.env?.ANTHROPIC_MODEL) {
    const model = profile.env.ANTHROPIC_MODEL;
    const validPatterns = [
      /^claude-\d+(\.\d+)?(-\d+)?$/,
      /^glm-/,
      /^minimax-/,
      /^anthropic\.claude-/
    ];
    if (!validPatterns.some(p => p.test(model))) {
      errors.push(`Model format looks invalid: ${model}`);
    }
  }

  // Validate URL if present
  if (profile.env?.ANTHROPIC_BASE_URL) {
    try {
      new URL(profile.env.ANTHROPIC_BASE_URL);
    } catch {
      errors.push('Base URL is not a valid URL');
    }
  }

  return { valid: errors.length === 0, errors };
};

// Get installed skills
const getInstalledSkills = () => {
  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  if (!fs.existsSync(skillsDir)) return [];
  return fs.readdirSync(skillsDir).filter(f => {
    const p = path.join(skillsDir, f);
    return fs.statSync(p).isDirectory() && !f.startsWith('.');
  });
};

// Remove a skill
const removeSkill = (skillName) => {
  const skillPath = path.join(os.homedir(), '.claude', 'skills', skillName);
  if (!fs.existsSync(skillPath)) {
    return { success: false, message: 'Skill not found' };
  }
  fs.rmSync(skillPath, { recursive: true, force: true });
  return { success: true };
};

const checkForUpdate = async () => {
  if (skipUpdate) return { needsUpdate: false };
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    // Get current version
    const versionResult = await execAsync('claude --version 2>/dev/null').catch(() => ({ stdout: '' }));
    const current = versionResult.stdout.match(/(\d+\.\d+\.\d+)/)?.[1];
    if (!current) return { needsUpdate: false };

    // Check for updates based on installation method
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
        // Installed via npm, check npm registry
        try {
          const npmOutdated = await execAsync('npm outdated -g @anthropic-ai/claude-code --json 2>/dev/null || true', { timeout: 5000 });
          needsUpdate = npmOutdated.stdout.length > 0;
        } catch {
          // npm outdated returns non-zero exit code when updates are available
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

const launchClaude = () => {
  try {
    const claudeArgs = dangerMode ? '--dangerously-skip-permissions' : '';
    execSync(`claude ${claudeArgs}`, { stdio: 'inherit' });
  } catch (e) {
    process.exit(e.status || 1);
  }
  process.exit(0);
};

// Handle --last flag
if (useLast) {
  const last = getLastProfile();
  if (last && fs.existsSync(path.join(PROFILES_DIR, last))) {
    const name = applyProfile(last);
    console.log(`\x1b[32m✓\x1b[0m Applied: ${name}\n`);
    launchClaude();
  } else {
    console.log('\x1b[31mNo last profile found\x1b[0m');
    process.exit(1);
  }
}

// Handle project profile
const projectProfile = checkProjectProfile();
if (projectProfile && !cmd) {
  const profiles = loadProfiles();
  const match = profiles.find(p => p.label === projectProfile || p.value === projectProfile + '.json');
  if (match) {
    console.log(`\x1b[36mUsing project profile: ${match.label}\x1b[0m`);
    applyProfile(match.value);
    launchClaude();
  }
}

// Handle commands
if (cmd === 'status') {
  const last = getLastProfile();
  const profiles = loadProfiles();
  const current = profiles.find(p => p.value === last);
  console.log(`\x1b[1m\x1b[36mClaude Settings Manager v${VERSION}\x1b[0m`);
  console.log(`─────────────────────────`);
  if (current) {
    console.log(`Current profile: \x1b[32m${current.label}\x1b[0m`);
    console.log(`Model: ${current.data.env?.ANTHROPIC_MODEL || 'default'}`);
    console.log(`Provider: ${current.data.env?.ANTHROPIC_BASE_URL || 'Anthropic Direct'}`);
    const mcpServers = current.data.mcpServers || {};
    if (Object.keys(mcpServers).length > 0) {
      console.log(`\nProfile MCP Servers (${Object.keys(mcpServers).length}):`);
      Object.keys(mcpServers).forEach(s => console.log(`  - ${s}`));
    }
  } else {
    console.log('No profile active');
  }
  // Show installed skills from ~/.claude/skills/
  const skillsDir = path.join(os.homedir(), '.claude', 'skills');
  try {
    if (fs.existsSync(skillsDir)) {
      const installedSkills = fs.readdirSync(skillsDir).filter(f => {
        const p = path.join(skillsDir, f);
        return fs.statSync(p).isDirectory() && !f.startsWith('.');
      });
      if (installedSkills.length > 0) {
        console.log(`\nInstalled Skills (${installedSkills.length}):`);
        installedSkills.forEach(s => console.log(`  - ${s}`));
      }
    }
  } catch {}
  // Show global MCP servers from ~/.claude.json
  try {
    const claudeJson = JSON.parse(fs.readFileSync(CLAUDE_JSON_PATH, 'utf8'));
    const globalMcp = claudeJson.mcpServers || {};
    if (Object.keys(globalMcp).length > 0) {
      console.log(`\nGlobal MCP Servers (${Object.keys(globalMcp).length}):`);
      Object.keys(globalMcp).forEach(s => console.log(`  - ${s}`));
    }
  } catch {}
  try {
    const ver = execSync('claude --version 2>/dev/null', { encoding: 'utf8' }).trim();
    console.log(`\nClaude: ${ver}`);
  } catch {}
  process.exit(0);
}

if (cmd === 'list') {
  const profiles = loadProfiles();
  console.log(`\x1b[1m\x1b[36mProfiles\x1b[0m (${profiles.length})`);
  console.log(`─────────────────────────`);
  profiles.forEach((p, i) => {
    const group = p.group ? `\x1b[33m[${p.group}]\x1b[0m ` : '';
    console.log(`${i + 1}. ${group}${p.label}`);
  });
  process.exit(0);
}

if (cmd === 'config') {
  const editor = process.env.EDITOR || 'nano';
  const configPath = SETTINGS_PATH;

  // Ensure settings file exists
  if (!fs.existsSync(configPath)) {
    console.log(`\x1b[33mSettings file not found. Creating default settings...\x1b[0m`);
    fs.writeFileSync(configPath, JSON.stringify({
      env: {},
      model: 'opus',
      alwaysThinkingEnabled: true,
      defaultMode: 'bypassPermissions',
    }, null, 2));
  }

  console.log(`Opening ${configPath} in ${editor}...`);
  spawnSync(editor, [configPath], { stdio: 'inherit' });
  process.exit(0);
}

if (cmd === 'delete') {
  const forceDelete = args.includes('--force') || args.includes('-f');
  const profiles = loadProfiles();
  const target = args[1];
  const idx = parseInt(target) - 1;
  const match = profiles[idx] || profiles.find(p => p.label.toLowerCase() === target?.toLowerCase());

  if (!match) {
    console.log(`\x1b[31mProfile not found: ${target}\x1b[0m`);
    process.exit(1);
  }

  const shouldDelete = forceDelete || await confirm(`Delete profile "${match.label}"?`);
  if (shouldDelete) {
    fs.unlinkSync(path.join(PROFILES_DIR, match.value));
    console.log(`\x1b[32m✓\x1b[0m Deleted: ${match.label}`);
  } else {
    console.log('\x1b[33mCancelled\x1b[0m');
  }
  process.exit(0);
}

if (cmd === 'edit') {
  const profiles = loadProfiles();
  const target = args[1];
  const idx = parseInt(target) - 1;
  const match = profiles[idx] || profiles.find(p => p.label.toLowerCase() === target?.toLowerCase());
  if (match) {
    const editor = process.env.EDITOR || 'nano';
    spawnSync(editor, [path.join(PROFILES_DIR, match.value)], { stdio: 'inherit' });
  } else {
    console.log(`\x1b[31mProfile not found: ${target}\x1b[0m`);
  }
  process.exit(0);
}

if (cmd === 'copy') {
  const profiles = loadProfiles();
  const target = args[1];
  const newName = args[2];

  if (!newName) {
    console.log('\x1b[31mUsage: cm copy <source> <new-name>\x1b[0m');
    console.log('  source: Profile name or number');
    console.log('  new-name: Name for the copied profile');
    process.exit(1);
  }

  const idx = parseInt(target) - 1;
  const match = profiles[idx] || profiles.find(p => p.label.toLowerCase() === target?.toLowerCase());

  if (!match) {
    console.log(`\x1b[31mProfile not found: ${target}\x1b[0m`);
    process.exit(1);
  }

  // Load and modify the profile
  const profile = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, match.value), 'utf8'));
  profile.name = newName;

  // Generate filename from new name
  const newFilename = newName.toLowerCase().replace(/\s+/g, '-') + '.json';

  // Check if destination already exists
  if (fs.existsSync(path.join(PROFILES_DIR, newFilename))) {
    const shouldOverwrite = await confirm(`Profile "${newName}" already exists. Overwrite?`);
    if (!shouldOverwrite) {
      console.log('\x1b[33mCancelled\x1b[0m');
      process.exit(0);
    }
  }

  // Save the new profile
  fs.writeFileSync(path.join(PROFILES_DIR, newFilename), JSON.stringify(profile, null, 2));
  console.log(`\x1b[32m✓\x1b[0m Copied "${match.label}" to "${newName}"`);
  process.exit(0);
}

// MCP server search and add
const MCP_PAGE_SIZE = 50;
const searchMcpServers = async (query, offset = 0) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    // Fetch more servers to support pagination
    const res = await fetch(`${MCP_REGISTRY_URL}?limit=200`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const seen = new Set();
    const filtered = data.servers.filter(s => {
      if (seen.has(s.server.name)) return false;
      seen.add(s.server.name);
      const isLatest = s._meta?.['io.modelcontextprotocol.registry/official']?.isLatest !== false;
      const matchesQuery = !query ||
        s.server.name.toLowerCase().includes(query.toLowerCase()) ||
        s.server.description?.toLowerCase().includes(query.toLowerCase());
      return isLatest && matchesQuery;
    });

    // Return paginated results with total count
    return {
      servers: filtered.slice(offset, offset + MCP_PAGE_SIZE),
      total: filtered.length,
      hasMore: offset + MCP_PAGE_SIZE < filtered.length,
      offset
    };
  } catch (error) {
    logError('searchMcpServers', error);
    return { servers: [], total: 0, hasMore: false, offset: 0 };
  } finally {
    clearTimeout(timeout);
  }
};

const addMcpToProfile = (server, profileFile) => {
  const profilePath = path.join(PROFILES_DIR, profileFile);
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

const McpSearch = () => {
  const { exit } = useApp();
  const [step, setStep] = useState(args[1] ? 'loading' : 'search');
  const [query, setQuery] = useState(args[1] || '');
  const [searchResults, setSearchResults] = useState({ servers: [], total: 0, hasMore: false, offset: 0 });
  const [selectedServer, setSelectedServer] = useState(null);
  const profiles = loadProfiles();

  useEffect(() => {
    const loadInitialResults = async () => {
      if (args[1] && step === 'loading') {
        const results = await searchMcpServers(args[1]);
        setSearchResults(results);
        setStep('results');
      }
    };
    loadInitialResults();
  }, []);

  const doSearch = async () => {
    setStep('loading');
    const results = await searchMcpServers(query, 0);
    setSearchResults(results);
    setStep('results');
  };

  const nextPage = async () => {
    const results = await searchMcpServers(query, searchResults.offset + MCP_PAGE_SIZE);
    setSearchResults(results);
  };

  const prevPage = async () => {
    const results = await searchMcpServers(query, Math.max(0, searchResults.offset - MCP_PAGE_SIZE));
    setSearchResults(results);
  };

  const serverItems = searchResults.servers.map(s => ({
    label: `${s.server.name} - ${s.server.description?.slice(0, 50) || ''}`,
    value: s,
    key: s.server.name + s.server.version,
  }));

  const profileItems = profiles.map(p => ({ label: p.label, value: p.value, key: p.key }));

  useInput((input, key) => {
    if (step === 'results') {
      if (key.return && !selectedServer) return;
      // Next page with 'n' or right arrow
      if ((input === 'n' || key.rightArrow) && searchResults.hasMore) {
        nextPage();
      }
      // Previous page with 'p' or left arrow
      if ((input === 'p' || key.leftArrow) && searchResults.offset > 0) {
        prevPage();
      }
    }
  });

  if (step === 'search') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">MCP Server Search</Text>
        <Text dimColor>─────────────────────────</Text>
        <Box marginTop={1}>
          <Text>Search: </Text>
          <TextInput value={query} onChange={setQuery} onSubmit={doSearch} />
        </Box>
      </Box>
    );
  }

  if (step === 'loading') {
    return <Box padding={1}><Text>Searching MCP registry...</Text></Box>;
  }

  if (step === 'results') {
    if (searchResults.servers.length === 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="yellow">No servers found for "{query}"</Text>
        </Box>
      );
    }
    const start = searchResults.offset + 1;
    const end = Math.min(searchResults.offset + MCP_PAGE_SIZE, searchResults.total);
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">MCP Servers</Text>
        <Text dimColor>─────────────────────────</Text>
        <Text dimColor>Showing {start}-{end} of {searchResults.total} results</Text>
        <Text dimColor color="gray">Navigation: n/→ next page, p/← prev page</Text>
        <Box flexDirection="column" marginTop={1}>
          <SelectInput
            items={serverItems}
            onSelect={(item) => { setSelectedServer(item.value); setStep('profile'); }}
            limit={10}
          />
        </Box>
      </Box>
    );
  }

  if (step === 'profile') {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">Add to Profile</Text>
        <Text dimColor>─────────────────────────</Text>
        <Text>Server: {selectedServer.server.name}</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>Select profile:</Text>
          <SelectInput 
            items={profileItems} 
            onSelect={(item) => {
              const name = addMcpToProfile(selectedServer, item.value);
              console.log(`\n\x1b[32m✓\x1b[0m Added ${name} to ${item.label}`);
              exit();
            }}
          />
        </Box>
      </Box>
    );
  }

  return null;
};

// Skills browser
const SKILL_SOURCES = [
  { url: 'https://api.github.com/repos/anthropics/skills/contents/skills', base: 'https://github.com/anthropics/skills/tree/main/skills' },
  { url: 'https://api.github.com/repos/Prat011/awesome-llm-skills/contents/skills', base: 'https://github.com/Prat011/awesome-llm-skills/tree/main/skills' },
  { url: 'https://api.github.com/repos/skillcreatorai/Ai-Agent-Skills/contents/skills', base: 'https://github.com/skillcreatorai/Ai-Agent-Skills/tree/main/skills' },
];

const fetchSkills = async () => {
  const seen = new Set();
  const skills = [];

  // Fetch from all sources in parallel
  const promises = SKILL_SOURCES.map(async (source) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch(source.url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/vnd.github.v3+json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (Array.isArray(data)) {
        for (const s of data.filter(s => s.type === 'dir')) {
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
  });

  await Promise.all(promises);
  return skills.sort((a, b) => a.label.localeCompare(b.label));
};

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

const addSkillToClaudeJson = (skillName, skillUrl) => {
  try {
    // Ensure skills directory exists
    if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
    
    const skillPath = path.join(SKILLS_DIR, skillName);
    if (fs.existsSync(skillPath)) {
      return { success: false, message: 'Skill already installed' };
    }
    
    // Convert GitHub URL to clone-friendly format
    // https://github.com/anthropics/skills/tree/main/skills/frontend-design
    // -> git clone with sparse checkout
    const match = skillUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/);
    if (!match) return { success: false, message: 'Invalid skill URL' };
    
    const [, owner, repo, branch, skillSubPath] = match;
    const tempDir = `/tmp/skill-clone-${Date.now()}`;
    
    // Sparse clone just the skill folder
    execSync(`git clone --depth 1 --filter=blob:none --sparse "https://github.com/${owner}/${repo}.git" "${tempDir}" 2>/dev/null`, { timeout: 30000 });
    execSync(`cd "${tempDir}" && git sparse-checkout set "${skillSubPath}" 2>/dev/null`, { timeout: 10000 });
    
    // Move skill to destination
    execSync(`mv "${tempDir}/${skillSubPath}" "${skillPath}"`, { timeout: 5000 });
    execSync(`rm -rf "${tempDir}"`, { timeout: 5000 });
    
    return { success: true };
  } catch (e) {
    return { success: false, message: 'Failed to download skill' };
  }
};

const SkillsBrowser = () => {
  const { exit } = useApp();
  const [allSkills, setAllSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const SKILLS_PAGE_SIZE = 50;

  useEffect(() => {
    const loadSkills = async () => {
      const s = await fetchSkills();
      setAllSkills(s);
      setLoading(false);
    };
    loadSkills();
  }, []);

  const paginatedSkills = allSkills.slice(offset, offset + SKILLS_PAGE_SIZE);
  const hasMore = offset + SKILLS_PAGE_SIZE < allSkills.length;

  useInput((input, key) => {
    if (!loading) {
      // Next page with 'n' or right arrow
      if ((input === 'n' || key.rightArrow) && hasMore) {
        setOffset(offset + SKILLS_PAGE_SIZE);
      }
      // Previous page with 'p' or left arrow
      if ((input === 'p' || key.leftArrow) && offset > 0) {
        setOffset(Math.max(0, offset - SKILLS_PAGE_SIZE));
      }
    }
  });

  if (loading) {
    return <Box padding={1}><Text>Loading skills...</Text></Box>;
  }

  if (allSkills.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Could not fetch skills</Text>
      </Box>
    );
  }

  const start = offset + 1;
  const end = Math.min(offset + SKILLS_PAGE_SIZE, allSkills.length);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">Anthropic Skills</Text>
      <Text dimColor>─────────────────────────</Text>
      <Text dimColor>Showing {start}-{end} of {allSkills.length} skills</Text>
      <Text dimColor color="gray">Navigation: n/→ next page, p/← prev page</Text>
      <Box flexDirection="column" marginTop={1}>
        <SelectInput
          items={paginatedSkills}
          onSelect={(item) => {
            const result = addSkillToClaudeJson(item.label, item.value);
            if (result.success) {
              console.log(`\n\x1b[32m✓\x1b[0m Installed skill: ${item.label}`);
              console.log(`\x1b[36mLocation: ~/.claude/skills/${item.label}/\x1b[0m`);
            } else {
              console.log(`\n\x1b[31m✗\x1b[0m ${result.message || 'Failed to install skill'}`);
            }
            exit();
          }}
        />
      </Box>
    </Box>
  );
};

if (cmd === 'skills') {
  const subCommand = args[1];

  // Handle skills subcommands
  if (subCommand === 'list') {
    const installed = getInstalledSkills();
    console.log(`\x1b[1m\x1b[36mInstalled Skills\x1b[0m (${installed.length})`);
    console.log('─────────────────────────');
    if (installed.length === 0) {
      console.log('No skills installed');
    } else {
      installed.forEach((s, i) => console.log(`${i + 1}. ${s}`));
    }
    process.exit(0);
  }

  if (subCommand === 'remove') {
    const target = args[2];
    if (!target) {
      console.log('\x1b[31mUsage: cm skills remove <skill-name>\x1b[0m');
      process.exit(1);
    }

    const installed = getInstalledSkills();
    const idx = parseInt(target) - 1;
    const match = installed[idx] || installed.find(s => s.toLowerCase() === target?.toLowerCase());

    if (!match) {
      console.log(`\x1b[31mSkill not found: ${target}\x1b[0m`);
      console.log('Run "cm skills list" to see installed skills');
      process.exit(1);
    }

    const shouldRemove = await confirm(`Remove skill "${match}"?`);
    if (shouldRemove) {
      const result = removeSkill(match);
      if (result.success) {
        console.log(`\x1b[32m✓\x1b[0m Removed skill: ${match}`);
      } else {
        console.log(`\x1b[31m✗\x1b[0m ${result.message}`);
      }
    } else {
      console.log('\x1b[33mCancelled\x1b[0m');
    }
    process.exit(0);
  }

  // Default: browse and add skills
  render(<SkillsBrowser />);
} else if (cmd === 'mcp') {
  const subCommand = args[1];

  // Handle mcp remove subcommand
  if (subCommand === 'remove') {
    const profiles = loadProfiles();
    if (profiles.length === 0) {
      console.log('\x1b[31mNo profiles found\x1b[0m');
      process.exit(1);
    }

    const serverName = args[2];
    const targetProfile = args[3];

    if (!targetProfile) {
      console.log('\x1b[31mUsage: cm mcp remove <server-name> <profile>\x1b[0m');
      console.log('  server-name: MCP server name to remove');
      console.log('  profile: Profile name or number');
      process.exit(1);
    }

    const idx = parseInt(targetProfile) - 1;
    const profileMatch = profiles[idx] || profiles.find(p => p.label.toLowerCase() === targetProfile?.toLowerCase());

    if (!profileMatch) {
      console.log(`\x1b[31mProfile not found: ${targetProfile}\x1b[0m`);
      process.exit(1);
    }

    // Load profile and show MCP servers
    const profilePath = path.join(PROFILES_DIR, profileMatch.value);
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const mcpServers = profile.mcpServers || {};

    if (Object.keys(mcpServers).length === 0) {
      console.log(`\x1b[33mNo MCP servers configured in "${profileMatch.label}"\x1b[0m`);
      process.exit(0);
    }

    if (!mcpServers[serverName]) {
      console.log(`\x1b[31mMCP server not found: ${serverName}\x1b[0m`);
      console.log(`Available servers: ${Object.keys(mcpServers).join(', ')}`);
      process.exit(1);
    }

    const shouldRemove = await confirm(`Remove "${serverName}" from "${profileMatch.label}"?`);
    if (shouldRemove) {
      delete mcpServers[serverName];
      profile.mcpServers = mcpServers;
      fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2));
      console.log(`\x1b[32m✓\x1b[0m Removed "${serverName}" from "${profileMatch.label}"`);
    } else {
      console.log('\x1b[33mCancelled\x1b[0m');
    }
    process.exit(0);
  }

  // Default: MCP server search and add
  render(<McpSearch />);
} else if (cmd === 'new') {
  // New profile wizard
  const NewProfileWizard = () => {
    const { exit } = useApp();
    const [step, setStep] = useState('name');
    const [name, setName] = useState('');
    const [provider, setProvider] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('');
    const [group, setGroup] = useState('');
    const [validationErrors, setValidationErrors] = useState([]);

    const providers = [
      { label: 'Anthropic (Direct)', value: 'anthropic', url: '', needsKey: true },
      { label: 'Amazon Bedrock', value: 'bedrock', url: '', needsKey: false },
      { label: 'Z.AI', value: 'zai', url: 'https://api.z.ai/api/anthropic', needsKey: true },
      { label: 'MiniMax', value: 'minimax', url: 'https://api.minimax.io/anthropic', needsKey: true },
      { label: 'Custom', value: 'custom', url: '', needsKey: true },
    ];

    const handleSave = () => {
      const prov = providers.find(p => p.value === provider);
      const profile = {
        name,
        group: group || undefined,
        env: {
          ...(apiKey && { ANTHROPIC_AUTH_TOKEN: apiKey }),
          ...(model && { ANTHROPIC_MODEL: model }),
          ...(prov?.url && { ANTHROPIC_BASE_URL: prov.url }),
          API_TIMEOUT_MS: '3000000',
        },
        model: 'opus',
        alwaysThinkingEnabled: true,
        defaultMode: 'bypassPermissions',
      };

      // Validate profile before saving
      const validation = validateProfile(profile);
      if (!validation.valid) {
        setStep('error');
        setValidationErrors(validation.errors);
        return;
      }

      const filename = name.toLowerCase().replace(/\s+/g, '-') + '.json';
      fs.writeFileSync(path.join(PROFILES_DIR, filename), JSON.stringify(profile, null, 2));
      console.log(`\n\x1b[32m✓\x1b[0m Created: ${name}`);
      exit();
    };

    const handleProviderSelect = (item) => {
      setProvider(item.value);
      const prov = providers.find(p => p.value === item.value);
      setStep(prov.needsKey ? 'apikey' : 'model');
    };

    useInput((input, key) => {
      if (step === 'error') {
        setStep('group');
        setValidationErrors([]);
      }
    });

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">New Profile</Text>
        <Text dimColor>─────────────────────────</Text>
        
        {step === 'name' && (
          <Box marginTop={1}>
            <Text>Name: </Text>
            <TextInput value={name} onChange={setName} onSubmit={() => setStep('provider')} />
          </Box>
        )}
        
        {step === 'provider' && (
          <Box flexDirection="column" marginTop={1}>
            <Text>Provider:</Text>
            <SelectInput items={providers} onSelect={handleProviderSelect} />
          </Box>
        )}
        
        {step === 'apikey' && (
          <Box marginTop={1}>
            <Text>API Key: </Text>
            <TextInput value={apiKey} onChange={setApiKey} onSubmit={() => setStep('model')} mask="*" />
          </Box>
        )}
        
        {step === 'model' && (
          <Box marginTop={1}>
            <Text>Model ID (optional): </Text>
            <TextInput value={model} onChange={setModel} onSubmit={() => setStep('group')} />
          </Box>
        )}
        
        {step === 'group' && (
          <Box marginTop={1}>
            <Text>Group (optional): </Text>
            <TextInput value={group} onChange={setGroup} onSubmit={handleSave} />
          </Box>
        )}

        {step === 'error' && (
          <Box marginTop={1} flexDirection="column">
            <Text color="red">Validation errors:</Text>
            {validationErrors.map((err, i) => (
              <Text key={i} color="yellow">  • {err}</Text>
            ))}
            <Text marginTop={1}>Press any key to go back and fix...</Text>
          </Box>
        )}
      </Box>
    );
  };
  render(<NewProfileWizard />);
} else {
  // Loading animation component
  const LoadingScreen = ({ message = 'Loading...' }) => {
    const [dots, setDots] = useState('');
    const [colorIdx, setColorIdx] = useState(0);
    const colors = ['cyan', 'blue', 'magenta', 'red', 'yellow', 'green'];

    useEffect(() => {
      const dotsInterval = setInterval(() => {
        setDots(d => d.length >= 3 ? '' : d + '.');
      }, 500);
      const colorInterval = setInterval(() => {
        setColorIdx(i => (i + 1) % colors.length);
      }, 200);
      return () => { clearInterval(dotsInterval); clearInterval(colorInterval); };
    }, []);

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors[colorIdx]}>{LOGO}</Text>
        <Text bold color={colors[(colorIdx + 3) % colors.length]}>MANAGER v{VERSION}</Text>
        <Text color="yellow" marginTop={1}>{message}{dots}</Text>
      </Box>
    );
  };

  // Main app
  const App = () => {
    const [step, setStep] = useState('loading');
    const [updateInfo, setUpdateInfo] = useState(null);
    const [filter, setFilter] = useState('');
    const [showHelp, setShowHelp] = useState(false);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [commandInput, setCommandInput] = useState('');
    const profiles = loadProfiles();

    // Available commands for palette
    const commands = [
      { label: '/skills', description: 'Browse and install skills', action: () => render(<SkillsBrowser />) },
      { label: '/mcp', description: 'Search and add MCP servers', action: () => render(<McpSearch />) },
      { label: '/new', description: 'Create new profile', action: () => setStep('newProfile') },
      { label: '/list', description: 'List all profiles', action: () => execSync('cm list', { stdio: 'inherit' }) },
      { label: '/status', description: 'Show current settings', action: () => execSync('cm status', { stdio: 'inherit' }) },
      { label: '/config', description: 'Edit Claude settings', action: () => execSync('cm config', { stdio: 'inherit' }) },
      { label: '/help', description: 'Show keyboard shortcuts', action: () => setShowHelp(true) },
      { label: '/quit', description: 'Exit cm', action: () => process.exit(0) },
    ];

    // Fuzzy search with Fuse.js
    const filteredProfiles = useMemo(() => {
      if (!filter) return profiles;

      const fuse = new Fuse(profiles, {
        keys: ['label', 'group'],
        threshold: 0.3, // Lower = more strict matching
        ignoreLocation: true,
        includeScore: true,
      });

      return fuse.search(filter).map(r => r.item);
    }, [profiles, filter]);

    // Filter commands for palette
    const filteredCommands = useMemo(() => {
      if (!commandInput) return commands;

      const search = commandInput.toLowerCase().replace(/^\//, '');
      const fuse = new Fuse(commands, {
        keys: ['label', 'description'],
        threshold: 0.3,
        ignoreLocation: true,
      });

      return fuse.search(search).map(r => r.item);
    }, [commands, commandInput]);

    useEffect(() => {
      // Show loading screen briefly, then go to select
      setTimeout(() => setStep('select'), 1500);

      // Check for updates in parallel (non-blocking)
      if (!skipUpdate) {
        checkForUpdate().then(setUpdateInfo);
      }
    }, []);

    useInput((input, key) => {
      // Command palette is open - handle input there
      if (showCommandPalette) {
        if (key.escape) {
          setShowCommandPalette(false);
          setCommandInput('');
          return;
        }
        if (key.return) {
          // Execute command
          const matchedCommand = commandInput.startsWith('/')
            ? commands.find(c => c.label === commandInput)
            : filteredCommands[0];

          if (matchedCommand) {
            setShowCommandPalette(false);
            setCommandInput('');
            matchedCommand.action();
          }
          return;
        }
        if (key.backspace || key.delete) {
          setCommandInput(c => c.slice(0, -1));
          if (commandInput.length <= 1) {
            setShowCommandPalette(false);
          }
          return;
        }
        // Type into command palette
        if (input && !key.ctrl && !key.meta) {
          setCommandInput(c => c + input);
        }
        return;
      }

      if (step === 'select') {
        // Number shortcuts
        const num = parseInt(input);
        if (num >= 1 && num <= 9 && num <= filteredProfiles.length) {
          const profile = filteredProfiles[num - 1];
          applyProfile(profile.value);
          console.log(`\n\x1b[32m✓\x1b[0m Applied: ${profile.label}\n`);
          launchClaude();
        }
        // Update shortcut
        if (input === 'u' && updateInfo?.needsUpdate) {
          console.log('\n\x1b[33mUpdating Claude...\x1b[0m\n');
          try {
            // Detect installation method and update accordingly
            if (process.platform === 'darwin') {
              execSync('brew upgrade claude-code', { stdio: 'inherit' });
            } else {
              execSync('npm update -g @anthropic-ai/claude-code', { stdio: 'inherit' });
            }
            console.log('\n\x1b[32m✓ Updated!\x1b[0m\n');
            setUpdateInfo({ ...updateInfo, needsUpdate: false });
          } catch (error) {
            console.log('\x1b[31m✗ Update failed\x1b[0m\n');
            logError('update', error);
          }
        }
        // Command palette activation
        if (input === '/' && !showHelp) {
          setShowCommandPalette(true);
          setCommandInput('/');
          return;
        }
        // Fuzzy filter (exclude special shortcuts)
        if (input.match(/^[a-zA-Z]$/) && input !== 'u' && input !== 'c' && input !== '?' && input !== '/') {
          setFilter(f => f + input);
        }
        if (key.backspace || key.delete) {
          setFilter(f => f.slice(0, -1));
        }
        if (key.escape) {
          setFilter('');
        }
        // Help shortcut
        if (input === '?') {
          setShowHelp(true);
        }
        // Config shortcut
        if (input === 'c') {
          const editor = process.env.EDITOR || 'nano';
          const configPath = SETTINGS_PATH;

          // Ensure settings file exists
          if (!fs.existsSync(configPath)) {
            fs.writeFileSync(configPath, JSON.stringify({
              env: {},
              model: 'opus',
              alwaysThinkingEnabled: true,
              defaultMode: 'bypassPermissions',
            }, null, 2));
          }

          // Clear screen and open editor
          console.clear();
          spawnSync(editor, [configPath], { stdio: 'inherit' });
          console.log('\n\x1b[36mConfig edited. Press Enter to continue...\x1b[0m');
        }
      }
      // Close help with q, ?, or escape
      if (showHelp && (input === 'q' || input === '?' || key.escape || key.return)) {
        setShowHelp(false);
      }
    });

    const groupedItems = [];
    const groups = [...new Set(filteredProfiles.map(p => p.group).filter(Boolean))];
    
    if (groups.length > 0) {
      groups.forEach(g => {
        groupedItems.push({ label: `── ${g} ──`, value: `group-${g}`, key: `group-${g}`, disabled: true });
        filteredProfiles.filter(p => p.group === g).forEach((p, i) => {
          groupedItems.push({ ...p, label: `${i + 1}. ${p.label}` });
        });
      });
      const ungrouped = filteredProfiles.filter(p => !p.group);
      if (ungrouped.length > 0) {
        groupedItems.push({ label: '── Other ──', value: 'group-other', key: 'group-other', disabled: true });
        ungrouped.forEach((p, i) => groupedItems.push({ ...p, label: `${i + 1}. ${p.label}` }));
      }
    } else {
      filteredProfiles.forEach((p, i) => groupedItems.push({ ...p, label: `${i + 1}. ${p.label}` }));
    }

    if (step === 'loading') {
      return <LoadingScreen message="Initializing Claude Manager" />;
    }

    if (profiles.length === 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="cyan">CLAUDE MANAGER</Text>
          <Text dimColor>─────────────────────────</Text>
          <Text color="yellow" marginTop={1}>No profiles found!</Text>
          <Text>Run: cm new</Text>
        </Box>
      );
    }

    const handleSelect = (item) => {
      if (item.disabled) return;
      applyProfile(item.value);
      console.log(`\n\x1b[32m✓\x1b[0m Applied: ${item.label.replace(/^\d+\.\s*/, '')}\n`);
      launchClaude();
    };

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">{LOGO}</Text>
        <Text bold color="magenta">MANAGER v{VERSION}</Text>
        <Text dimColor>─────────────────────────</Text>
        {updateInfo?.current && <Text dimColor>Claude v{updateInfo.current}</Text>}
        {updateInfo?.needsUpdate && (
          <Text color="yellow">⚠ Update available! Press 'u' to upgrade</Text>
        )}
        {filter && <Text color="yellow">Filter: {filter}</Text>}
        <Box flexDirection="column" marginTop={1}>
          <Text>Select Profile: <Text dimColor>(1-9 select, / commands, ? help, c config{updateInfo?.needsUpdate ? ', u update' : ''})</Text></Text>
          <SelectInput
            items={groupedItems}
            onSelect={handleSelect}
            itemComponent={({ isSelected, label, disabled }) => (
              <Text color={disabled ? 'gray' : isSelected ? 'cyan' : 'white'} dimColor={disabled}>
                {disabled ? label : (isSelected ? '❯ ' : '  ') + label}
              </Text>
            )}
          />
        </Box>

        {showCommandPalette && (
          <Box flexDirection="column" padding={1} marginTop={1} borderStyle="double" borderColor="magenta">
            <Text bold color="magenta">Command Palette</Text>
            <Text dimColor>─────────────────────────</Text>
            <Box marginTop={1}>
              <Text color="cyan">{'>'}</Text>
              <Text color="white">{commandInput}</Text>
            </Box>
            <Text dimColor marginTop={1}>Available commands:</Text>
            {filteredCommands.map((cmd, i) => (
              <Text key={cmd.label}>
                <Text color="cyan">{cmd.label}</Text>
                <Text dimColor> - </Text>
                <Text color="gray">{cmd.description}</Text>
              </Text>
            ))}
            <Text dimColor marginTop={1}>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>
            <Text dimColor>Enter to execute • Esc to close</Text>
          </Box>
        )}

        {showHelp && (
          <Box flexDirection="column" padding={1} marginTop={1} borderStyle="single" borderColor="cyan">
            <Text bold color="cyan">Keyboard Shortcuts</Text>
            <Text dimColor>─────────────────────────</Text>
            <Text bold color="magenta">Navigation</Text>
            <Text>  <Text color="yellow">1-9</Text>     Quick select profile</Text>
            <Text>  <Text color="yellow">↑/↓</Text>     Navigate list</Text>
            <Text>  <Text color="yellow">Enter</Text>   Select profile</Text>
            <Text bold color="magenta" marginTop={1}>Search</Text>
            <Text>  <Text color="yellow">a-z</Text>     Fuzzy filter profiles</Text>
            <Text>  <Text color="yellow">Backspace</Text> Delete filter character</Text>
            <Text>  <Text color="yellow">Escape</Text>   Clear filter</Text>
            {updateInfo?.needsUpdate && <Text bold color="magenta" marginTop={1}><Text color="yellow">u</Text>       Update Claude</Text>}
            <Text bold color="magenta" marginTop={1}>Help</Text>
            <Text>  <Text color="yellow">?</Text>       Toggle this help</Text>
            <Text>  <Text color="yellow">q</Text>       Close help</Text>
            <Text bold color="magenta" marginTop={1}>CLI Commands</Text>
            <Text dimColor>  cm new       Create new profile</Text>
            <Text dimColor>  cm config    Edit Claude settings</Text>
            <Text dimColor>  cm status    Show current settings</Text>
            <Text dimColor>  cm --help    Show all commands</Text>
          </Box>
        )}
      </Box>
    );
  };

  render(<App />);
}
