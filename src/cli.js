import React, { useState, useEffect, useMemo } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { spawnSync, execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import Fuse from 'fuse.js';

import {
  VERSION,
  LOGO,
  PROFILES_DIR,
  SETTINGS_PATH,
  CLAUDE_JSON_PATH,
  PROVIDERS,
  MCP_PAGE_SIZE,
  SKILLS_PAGE_SIZE,
  FUSE_THRESHOLD,
} from './constants.js';

import {
  ensureProfilesDir,
  loadProfiles,
  applyProfile,
  getLastProfile,
  checkProjectProfile,
  confirm,
  validateProfile,
  getInstalledSkills,
  removeSkill,
  checkForUpdate,
  launchClaude,
  searchMcpServers,
  addMcpToProfile,
  fetchSkills,
  addSkillToClaudeJson,
  createDefaultSettings,
  buildProfileData,
  sanitizeProfileName,
  safeParseInt,
  logError,
} from './utils.js';
// Ensure profiles directory exists
ensureProfilesDir();

const args = process.argv.slice(2);
const cmd = args[0];

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
  parallel <profiles...>  Launch multiple Claude instances with different profiles
  parallel list   Show available profiles for parallel launch
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
  -h, --help      Show help

Examples:
  cm parallel "Z.AI (GLM)" "Anthropic Direct"     Launch 2 instances
  cm parallel 1 2 3                              Launch first 3 profiles
  cm parallel list                               Show available profiles`);
  process.exit(0);
}

const skipUpdate = args.includes('--skip-update');
const useLast = args.includes('--last') || args.includes('-l');
const dangerMode = args.includes('--dangerously-skip-permissions') || args.includes('--yolo');

// Handle --last flag
if (useLast) {
  const last = getLastProfile();
  const lastPath = last ? path.join(PROFILES_DIR, last) : null;
  if (last && lastPath && fs.existsSync(lastPath)) {
    const name = applyProfile(last);
    console.log(`\x1b[32m✓\x1b[0m Applied: ${name}\n`);
    launchClaude(dangerMode);
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
    launchClaude(dangerMode);
  }
}

// Handle commands
if (cmd === 'parallel') {
  const profiles = loadProfiles();
  
  if (args[1] === 'list') {
    console.log(`\x1b[1m\x1b[36mAvailable Profiles for Parallel Launch\x1b[0m`);
    console.log(`─────────────────────────────────────────`);
    profiles.forEach((p, i) => {
      const group = p.group ? `\x1b[33m[${p.group}]\x1b[0m ` : '';
      console.log(`${i + 1}. ${group}${p.label}`);
    });
    console.log(`\nUsage: cm parallel <profile1> [profile2] [profile3]`);
    console.log(`Example: cm parallel "Z.AI (GLM)" "Anthropic Direct" "MiniMax"`);
    process.exit(0);
  }

  const targetProfiles = args.slice(1);
  
  if (targetProfiles.length === 0) {
    console.log('\x1b[31mUsage: cm parallel <profile1> [profile2] [profile3]\x1b[0m');
    console.log('Use "cm parallel list" to see available profiles');
    process.exit(1);
  }

  console.log(`\x1b[1m\x1b[36mLaunching ${targetProfiles.length} Claude instances in parallel...\x1b[0m`);
  console.log(`─────────────────────────────────────────────────────────────`);

  const launched = [];

  for (let i = 0; i < targetProfiles.length; i++) {
    const target = targetProfiles[i];
    
    // Find profile by name or number
    const idx = safeParseInt(target, -1);
    const match = idx > 0 && idx <= profiles.length
      ? profiles[idx - 1]
      : profiles.find(p => p.label.toLowerCase() === target?.toLowerCase());

    if (!match) {
      console.log(`\x1b[31m✗ Profile not found: ${target}\x1b[0m`);
      continue;
    }

    // Create temporary settings file for this instance
    const tempSettingsPath = path.join(process.env.HOME, `.claude-parallel-${i}.json`);
    const profilePath = path.join(PROFILES_DIR, match.value);
    
    try {
      const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      fs.writeFileSync(tempSettingsPath, JSON.stringify(profileData, null, 2));
      
      console.log(`\x1b[32m✓\x1b[0m Setting up: ${match.label}`);
      
      // Launch Claude with the temporary settings file
      const claudeArgs = ['--settings', tempSettingsPath];
      if (dangerMode) {
        claudeArgs.push('--dangerously-skip-permissions');
      }
      
      const child = spawn('claude', claudeArgs, {
        detached: true,
        stdio: 'ignore'
      });
      
      child.unref(); // Allow parent to exit
      
      launched.push({
        profile: match.label,
        settingsFile: tempSettingsPath,
        pid: child.pid
      });
      
      // Brief delay between launches
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.log(`\x1b[31m✗ Failed to launch ${match.label}: ${error.message}\x1b[0m`);
    }
  }

  if (launched.length > 0) {
    console.log(`\n\x1b[32m✓ Successfully launched ${launched.length} Claude instances!\x1b[0m`);
    console.log(`\nRunning instances:`);
    launched.forEach((instance, i) => {
      console.log(`  ${i + 1}. ${instance.profile} (PID: ${instance.pid})`);
    });
    
    console.log(`\nSettings files created:`);
    launched.forEach((instance, i) => {
      console.log(`  ~/.claude-parallel-${i}.json`);
    });
    
    console.log(`\n\x1b[33mTo clean up settings files later:\x1b[0m`);
    console.log(`  rm ~/.claude-parallel-*.json`);
  } else {
    console.log(`\x1b[31mNo instances were launched successfully\x1b[0m`);
  }
  
  process.exit(0);
}

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

  // Show installed skills
  const installedSkills = getInstalledSkills();
  if (installedSkills.length > 0) {
    console.log(`\nInstalled Skills (${installedSkills.length}):`);
    installedSkills.forEach(s => console.log(`  - ${s}`));
  }

  // Show global MCP servers
  try {
    const claudeJson = JSON.parse(fs.readFileSync(CLAUDE_JSON_PATH, 'utf8'));
    const globalMcp = claudeJson.mcpServers || {};
    if (Object.keys(globalMcp).length > 0) {
      console.log(`\nGlobal MCP Servers (${Object.keys(globalMcp).length}):`);
      Object.keys(globalMcp).forEach(s => console.log(`  - ${s}`));
    }
  } catch (error) {
    logError('status-mcp', error);
  }

  try {
    const ver = execSync('claude --version 2>/dev/null', { encoding: 'utf8' }).trim();
    console.log(`\nClaude: ${ver}`);
  } catch (error) {
    logError('status-version', error);
  }
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
  createDefaultSettings();
  console.log(`Opening ${SETTINGS_PATH} in ${editor}...`);
  spawnSync(editor, [SETTINGS_PATH], { stdio: 'inherit' });
  process.exit(0);
}

if (cmd === 'delete') {
  const forceDelete = args.includes('--force') || args.includes('-f');
  const profiles = loadProfiles();
  const target = args[1];

  if (!target) {
    console.log('\x1b[31mUsage: cm delete <profile>\x1b[0m');
    console.log('  profile: Profile name or number');
    process.exit(1);
  }

  const idx = safeParseInt(target, -1);
  const match = idx > 0 && idx <= profiles.length
    ? profiles[idx - 1]
    : profiles.find(p => p.label.toLowerCase() === target?.toLowerCase());

  if (!match) {
    console.log(`\x1b[31mProfile not found: ${target}\x1b[0m`);
    process.exit(1);
  }

  const shouldDelete = forceDelete || await confirm(`Delete profile "${match.label}"?`);
  if (shouldDelete) {
    const filePath = path.join(PROFILES_DIR, match.value);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`\x1b[32m✓\x1b[0m Deleted: ${match.label}`);
    } else {
      console.log(`\x1b[31mProfile file not found: ${match.value}\x1b[0m`);
    }
  } else {
    console.log('\x1b[33mCancelled\x1b[0m');
  }
  process.exit(0);
}

if (cmd === 'edit') {
  const profiles = loadProfiles();
  const target = args[1];

  if (!target) {
    console.log('\x1b[31mUsage: cm edit <profile>\x1b[0m');
    console.log('  profile: Profile name or number');
    process.exit(1);
  }

  const idx = safeParseInt(target, -1);
  const match = idx > 0 && idx <= profiles.length
    ? profiles[idx - 1]
    : profiles.find(p => p.label.toLowerCase() === target?.toLowerCase());

  if (match) {
    const editor = process.env.EDITOR || 'nano';
    const filePath = path.join(PROFILES_DIR, match.value);
    if (fs.existsSync(filePath)) {
      spawnSync(editor, [filePath], { stdio: 'inherit' });
    } else {
      console.log(`\x1b[31mProfile file not found: ${match.value}\x1b[0m`);
    }
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

  const idx = safeParseInt(target, -1);
  const match = idx > 0 && idx <= profiles.length
    ? profiles[idx - 1]
    : profiles.find(p => p.label.toLowerCase() === target?.toLowerCase());

  if (!match) {
    console.log(`\x1b[31mProfile not found: ${target}\x1b[0m`);
    process.exit(1);
  }

  // Load and modify the profile
  const sourcePath = path.join(PROFILES_DIR, match.value);
  const profile = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  profile.name = newName;

  // Generate filename from new name
  const newFilename = sanitizeProfileName(newName) + '.json';

  // Check if destination already exists
  const destPath = path.join(PROFILES_DIR, newFilename);
  if (fs.existsSync(destPath)) {
    const shouldOverwrite = await confirm(`Profile "${newName}" already exists. Overwrite?`);
    if (!shouldOverwrite) {
      console.log('\x1b[33mCancelled\x1b[0m');
      process.exit(0);
    }
  }

  // Save the new profile
  fs.writeFileSync(destPath, JSON.stringify(profile, null, 2));
  console.log(`\x1b[32m✓\x1b[0m Copied "${match.label}" to "${newName}"`);
  process.exit(0);
}

// MCP server search and add
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
      if ((input === 'n' || key.rightArrow) && searchResults.hasMore) {
        nextPage();
      }
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
              try {
                const name = addMcpToProfile(selectedServer, item.value);
                console.log(`\n\x1b[32m✓\x1b[0m Added ${name} to ${item.label}`);
              } catch (error) {
                console.log(`\n\x1b[31m✗\x1b[0m ${error.message}`);
              }
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
const SkillsBrowser = () => {
  const { exit } = useApp();
  const [allSkills, setAllSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

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
      if ((input === 'n' || key.rightArrow) && hasMore) {
        setOffset(offset + SKILLS_PAGE_SIZE);
      }
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

const NewProfileWizard = () => {
  const { exit } = useApp();
  const [step, setStep] = useState('name');
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [group, setGroup] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);

  const handleSave = () => {
    const profile = buildProfileData(name, provider, apiKey, model, group, PROVIDERS);

    const validation = validateProfile(profile);
    if (!validation.valid) {
      setStep('error');
      setValidationErrors(validation.errors);
      return;
    }

    const filename = sanitizeProfileName(name) + '.json';
    fs.writeFileSync(path.join(PROFILES_DIR, filename), JSON.stringify(profile, null, 2));
    console.log(`\n\x1b[32m✓\x1b[0m Created: ${name}`);
    exit();
  };

  const handleProviderSelect = (item) => {
    setProvider(item.value);
    const prov = PROVIDERS.find(p => p.value === item.value);
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
          <SelectInput items={PROVIDERS} onSelect={handleProviderSelect} />
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

if (cmd === 'skills') {
  const subCommand = args[1];

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
    const idx = safeParseInt(target, -1);
    const match = idx > 0 && idx <= installed.length
      ? installed[idx - 1]
      : installed.find(s => s.toLowerCase() === target?.toLowerCase());

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

  render(<SkillsBrowser />);
} else if (cmd === 'mcp') {
  const subCommand = args[1];

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

    const idx = safeParseInt(targetProfile, -1);
    const profileMatch = idx > 0 && idx <= profiles.length
      ? profiles[idx - 1]
      : profiles.find(p => p.label.toLowerCase() === targetProfile?.toLowerCase());

    if (!profileMatch) {
      console.log(`\x1b[31mProfile not found: ${targetProfile}\x1b[0m`);
      process.exit(1);
    }

    const profilePath = path.join(PROFILES_DIR, profileMatch.value);
    if (!fs.existsSync(profilePath)) {
      console.log(`\x1b[31mProfile file not found: ${profileMatch.value}\x1b[0m`);
      process.exit(1);
    }

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

  render(<McpSearch />);
} else if (cmd === 'new') {
  render(<NewProfileWizard />);
} else {
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

  const ParallelSelector = ({ profiles, dangerMode }) => {
    const { exit } = useApp();
    const [selectedProfiles, setSelectedProfiles] = useState(new Set());
    const [step, setStep] = useState('select');

    useInput((input, key) => {
      if (step === 'select') {
        const num = safeParseInt(input, -1);
        if (num >= 1 && num <= 9 && num <= profiles.length) {
          const profile = profiles[num - 1];
          const newSelected = new Set(selectedProfiles);
          if (newSelected.has(profile.value)) {
            newSelected.delete(profile.value);
          } else {
            newSelected.add(profile.value);
          }
          setSelectedProfiles(newSelected);
        }
        if (key.return && selectedProfiles.size > 0) {
          setStep('launching');
          launchParallelInstances();
        }
        if (key.escape) {
          exit();
        }
        if (input === 'a') {
          // Select all
          setSelectedProfiles(new Set(profiles.map(p => p.value)));
        }
        if (input === 'c') {
          // Clear all
          setSelectedProfiles(new Set());
        }
      }
    });

    const launchParallelInstances = async () => {
      const selectedProfilesList = profiles.filter(p => selectedProfiles.has(p.value));
      console.log(`\n\x1b[1m\x1b[36mLaunching ${selectedProfilesList.length} Claude instances in parallel...\x1b[0m`);
      console.log(`─────────────────────────────────────────────────────────────`);

      const launched = [];

      for (let i = 0; i < selectedProfilesList.length; i++) {
        const profile = selectedProfilesList[i];
        const tempSettingsPath = path.join(process.env.HOME, `.claude-parallel-${i}.json`);
        const profilePath = path.join(PROFILES_DIR, profile.value);
        
        try {
          const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
          fs.writeFileSync(tempSettingsPath, JSON.stringify(profileData, null, 2));
          
          console.log(`\x1b[32m✓\x1b[0m Setting up: ${profile.label}`);
          
          const claudeArgs = ['--settings', tempSettingsPath];
          if (dangerMode) {
            claudeArgs.push('--dangerously-skip-permissions');
          }
          
          const child = spawn('claude', claudeArgs, {
            detached: true,
            stdio: 'ignore'
          });
          
          child.unref();
          
          launched.push({
            profile: profile.label,
            settingsFile: tempSettingsPath,
            pid: child.pid
          });
          
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.log(`\x1b[31m✗ Failed to launch ${profile.label}: ${error.message}\x1b[0m`);
        }
      }

      if (launched.length > 0) {
        console.log(`\n\x1b[32m✓ Successfully launched ${launched.length} Claude instances!\x1b[0m`);
        console.log(`\nRunning instances:`);
        launched.forEach((instance, i) => {
          console.log(`  ${i + 1}. ${instance.profile} (PID: ${instance.pid})`);
        });
        
        console.log(`\n\x1b[33mTo clean up settings files later:\x1b[0m`);
        console.log(`  rm ~/.claude-parallel-*.json`);
      } else {
        console.log(`\x1b[31mNo instances were launched successfully\x1b[0m`);
      }
      
      exit();
    };

    if (step === 'launching') {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="cyan">PARALLEL LAUNCHER</Text>
          <Text dimColor>─────────────────────────</Text>
          <Text color="yellow" marginTop={1}>Launching Claude instances...</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">PARALLEL LAUNCHER</Text>
        <Text dimColor>─────────────────────────</Text>
        <Text color="yellow" marginTop={1}>Select profiles to launch in parallel:</Text>
        
        <Box flexDirection="column" marginTop={1}>
          {profiles.map((profile, i) => {
            const isSelected = selectedProfiles.has(profile.value);
            const group = profile.group ? `[${profile.group}] ` : '';
            return (
              <Text key={profile.value}>
                <Text color={isSelected ? "green" : "gray"}>
                  {isSelected ? "✓" : " "} {i + 1}. {group}{profile.label}
                </Text>
              </Text>
            );
          })}
        </Box>

        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="gray">
          <Text bold color="magenta">Controls:</Text>
          <Text><Text color="yellow">1-9</Text>     Toggle profile selection</Text>
          <Text><Text color="yellow">a</Text>       Select all profiles</Text>
          <Text><Text color="yellow">c</Text>       Clear all selections</Text>
          <Text><Text color="yellow">Enter</Text>   Launch selected profiles ({selectedProfiles.size})</Text>
          <Text><Text color="yellow">Esc</Text>     Back to main menu</Text>
        </Box>
      </Box>
    );
  };

  // Profile Action Selector (edit, copy, delete, yolo)
  const ProfileActionSelector = ({ profiles, action }) => {
    const { exit } = useApp();
    const [copyName, setCopyName] = useState('');
    const [showCopyInput, setShowCopyInput] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState(null);

    const titles = {
      edit: 'EDIT PROFILE',
      copy: 'COPY PROFILE', 
      delete: 'DELETE PROFILE',
      yolo: 'YOLO LAUNCH'
    };

    const colors = {
      edit: 'cyan',
      copy: 'green',
      delete: 'red',
      yolo: 'yellow'
    };

    useInput((input, key) => {
      if (showCopyInput) {
        if (key.return && copyName.trim()) {
          execSync(`cm copy "${selectedProfile.label}" "${copyName}"`, { stdio: 'inherit' });
          exit();
        }
        if (key.escape) {
          setShowCopyInput(false);
          setCopyName('');
        }
        return;
      }

      const num = safeParseInt(input, -1);
      if (num >= 1 && num <= profiles.length) {
        const profile = profiles[num - 1];
        if (action === 'edit') {
          const editor = process.env.EDITOR || 'nano';
          const filePath = path.join(PROFILES_DIR, profile.value);
          console.clear();
          spawnSync(editor, [filePath], { stdio: 'inherit' });
          exit();
        } else if (action === 'copy') {
          setSelectedProfile(profile);
          setShowCopyInput(true);
        } else if (action === 'delete') {
          execSync(`cm delete "${profile.label}" --force`, { stdio: 'inherit' });
          exit();
        } else if (action === 'yolo') {
          applyProfile(profile.value);
          console.log(`\n\x1b[32m✓\x1b[0m Applied: ${profile.label}\n`);
          launchClaude(true);
        }
      }
      if (key.escape) exit();
    });

    if (showCopyInput) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="green">COPY PROFILE</Text>
          <Text dimColor>─────────────────────────</Text>
          <Text marginTop={1}>Copying: <Text color="cyan">{selectedProfile?.label}</Text></Text>
          <Box marginTop={1}>
            <Text>New name: </Text>
            <TextInput value={copyName} onChange={setCopyName} />
          </Box>
          <Text dimColor marginTop={1}>Enter to confirm • Esc to cancel</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={colors[action]}>{titles[action]}</Text>
        <Text dimColor>─────────────────────────</Text>
        <Text color="yellow" marginTop={1}>Select a profile:</Text>
        <Box flexDirection="column" marginTop={1}>
          {profiles.map((p, i) => (
            <Text key={p.value}>
              <Text color="gray">{i + 1}. </Text>
              <Text>{p.group ? `[${p.group}] ` : ''}{p.label}</Text>
            </Text>
          ))}
        </Box>
        <Text dimColor marginTop={1}>Press 1-{profiles.length} to select • Esc to cancel</Text>
      </Box>
    );
  };

  // MCP Remove Selector
  const McpRemoveSelector = ({ profiles }) => {
    const { exit } = useApp();
    const [step, setStep] = useState('profile');
    const [selectedProfile, setSelectedProfile] = useState(null);
    const [mcpServers, setMcpServers] = useState([]);

    useInput((input, key) => {
      const num = safeParseInt(input, -1);
      
      if (step === 'profile') {
        if (num >= 1 && num <= profiles.length) {
          const profile = profiles[num - 1];
          setSelectedProfile(profile);
          const servers = Object.keys(profile.data.mcpServers || {});
          if (servers.length === 0) {
            console.log('\n\x1b[33mNo MCP servers in this profile\x1b[0m');
            exit();
          }
          setMcpServers(servers);
          setStep('server');
        }
      } else if (step === 'server') {
        if (num >= 1 && num <= mcpServers.length) {
          const serverName = mcpServers[num - 1];
          const profilePath = path.join(PROFILES_DIR, selectedProfile.value);
          const profileData = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
          delete profileData.mcpServers[serverName];
          fs.writeFileSync(profilePath, JSON.stringify(profileData, null, 2));
          console.log(`\n\x1b[32m✓\x1b[0m Removed MCP server: ${serverName}`);
          exit();
        }
      }
      if (key.escape) exit();
    });

    if (step === 'server') {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="red">REMOVE MCP SERVER</Text>
          <Text dimColor>─────────────────────────</Text>
          <Text marginTop={1}>Profile: <Text color="cyan">{selectedProfile?.label}</Text></Text>
          <Text color="yellow" marginTop={1}>Select server to remove:</Text>
          <Box flexDirection="column" marginTop={1}>
            {mcpServers.map((s, i) => (
              <Text key={s}><Text color="gray">{i + 1}. </Text><Text>{s}</Text></Text>
            ))}
          </Box>
          <Text dimColor marginTop={1}>Press 1-{mcpServers.length} to remove • Esc to cancel</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="red">REMOVE MCP SERVER</Text>
        <Text dimColor>─────────────────────────</Text>
        <Text color="yellow" marginTop={1}>Select profile:</Text>
        <Box flexDirection="column" marginTop={1}>
          {profiles.map((p, i) => {
            const count = Object.keys(p.data.mcpServers || {}).length;
            return (
              <Text key={p.value}>
                <Text color="gray">{i + 1}. </Text>
                <Text>{p.label} </Text>
                <Text dimColor>({count} servers)</Text>
              </Text>
            );
          })}
        </Box>
        <Text dimColor marginTop={1}>Press 1-{profiles.length} to select • Esc to cancel</Text>
      </Box>
    );
  };

  // Skills Remove Selector
  const SkillsRemoveSelector = () => {
    const { exit } = useApp();
    const skills = getInstalledSkills();

    useInput((input, key) => {
      const num = safeParseInt(input, -1);
      if (num >= 1 && num <= skills.length) {
        const skill = skills[num - 1];
        removeSkill(skill);
        console.log(`\n\x1b[32m✓\x1b[0m Removed skill: ${skill}`);
        exit();
      }
      if (key.escape) exit();
    });

    if (skills.length === 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="red">REMOVE SKILL</Text>
          <Text dimColor>─────────────────────────</Text>
          <Text color="yellow" marginTop={1}>No skills installed</Text>
          <Text dimColor marginTop={1}>Press Esc to go back</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="red">REMOVE SKILL</Text>
        <Text dimColor>─────────────────────────</Text>
        <Text color="yellow" marginTop={1}>Select skill to remove:</Text>
        <Box flexDirection="column" marginTop={1}>
          {skills.map((s, i) => (
            <Text key={s}><Text color="gray">{i + 1}. </Text><Text>{s}</Text></Text>
          ))}
        </Box>
        <Text dimColor marginTop={1}>Press 1-{skills.length} to remove • Esc to cancel</Text>
      </Box>
    );
  };

  const App = () => {
    const [step, setStep] = useState('loading');
    const [updateInfo, setUpdateInfo] = useState(null);
    const [filter, setFilter] = useState('');
    const [showHelp, setShowHelp] = useState(false);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [commandInput, setCommandInput] = useState('');
    const profiles = loadProfiles();

    const commands = [
      // Profile Management
      { label: '/new', description: 'Create new profile', icon: '➕', category: 'Profiles', action: () => render(<NewProfileWizard />) },
      { label: '/edit', description: 'Edit a profile', icon: '✏️', category: 'Profiles', action: () => setStep('edit') },
      { label: '/copy', description: 'Duplicate a profile', icon: '📋', category: 'Profiles', action: () => setStep('copy') },
      { label: '/delete', description: 'Delete a profile', icon: '🗑️', category: 'Profiles', action: () => setStep('delete') },
      { label: '/list', description: 'List all profiles', icon: '📄', category: 'Profiles', action: () => { execSync('cm list', { stdio: 'inherit' }); process.exit(0); } },
      
      // Launch Options
      { label: '/parallel', description: 'Launch multiple profiles in parallel', icon: '🚀', category: 'Launch', action: () => setStep('parallel') },
      { label: '/yolo', description: 'Launch with --dangerously-skip-permissions', icon: '⚡', category: 'Launch', action: () => setStep('yolo') },
      
      // Extensions
      { label: '/mcp', description: 'Search and add MCP servers', icon: '🔌', category: 'Extensions', action: () => render(<McpSearch />) },
      { label: '/mcp-remove', description: 'Remove MCP server from profile', icon: '🔌', category: 'Extensions', action: () => setStep('mcp-remove') },
      { label: '/skills', description: 'Browse and install skills', icon: '🎯', category: 'Extensions', action: () => render(<SkillsBrowser />) },
      { label: '/skills-remove', description: 'Remove an installed skill', icon: '🎯', category: 'Extensions', action: () => setStep('skills-remove') },
      
      // Settings & Info
      { label: '/status', description: 'Show current settings & info', icon: '📊', category: 'Info', action: () => { execSync('cm status', { stdio: 'inherit' }); process.exit(0); } },
      { label: '/config', description: 'Edit Claude settings.json', icon: '⚙️', category: 'Info', action: () => { execSync('cm config', { stdio: 'inherit' }); process.exit(0); } },
      { label: '/help', description: 'Show keyboard shortcuts', icon: '❓', category: 'Info', action: () => setShowHelp(true) },
      { label: '/quit', description: 'Exit cm', icon: '🚪', category: 'Info', action: () => process.exit(0) },
    ];

    const filteredProfiles = useMemo(() => {
      if (!filter) return profiles;

      const fuse = new Fuse(profiles, {
        keys: ['label', 'group'],
        threshold: FUSE_THRESHOLD,
        ignoreLocation: true,
        includeScore: true,
      });

      return fuse.search(filter).map(r => r.item);
    }, [profiles, filter]);

    const filteredCommands = useMemo(() => {
      if (!commandInput) return commands;

      const search = commandInput.toLowerCase().replace(/^\//, '');
      const fuse = new Fuse(commands, {
        keys: ['label', 'description'],
        threshold: FUSE_THRESHOLD,
        ignoreLocation: true,
      });

      return fuse.search(search).map(r => r.item);
    }, [commands, commandInput]);

    useEffect(() => {
      setTimeout(() => setStep('select'), 1500);

      if (!skipUpdate) {
        checkForUpdate(skipUpdate).then(setUpdateInfo);
      }
    }, []);

    useInput((input, key) => {
      if (showCommandPalette) {
        if (key.escape) {
          setShowCommandPalette(false);
          setCommandInput('');
          return;
        }
        if (key.return) {
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
        if (input && !key.ctrl && !key.meta) {
          setCommandInput(c => c + input);
        }
        return;
      }

      if (step === 'select') {
        const num = safeParseInt(input, -1);
        if (num >= 1 && num <= 9 && num <= filteredProfiles.length) {
          const profile = filteredProfiles[num - 1];
          applyProfile(profile.value);
          console.log(`\n\x1b[32m✓\x1b[0m Applied: ${profile.label}\n`);
          launchClaude(dangerMode);
        }
        if (input === 'u' && updateInfo?.needsUpdate) {
          console.log('\n\x1b[33mUpdating Claude...\x1b[0m\n');
          try {
            if (process.platform === 'darwin') {
              execSync('brew upgrade claude-code', { stdio: 'inherit' });
            } else {
              execSync('npm update -g @anthropic-ai/claude-code', { stdio: 'inherit' });
            }
            console.log('\x1b[32m✓ Updated!\x1b[0m\n');
            setUpdateInfo({ ...updateInfo, needsUpdate: false });
          } catch (error) {
            console.log('\x1b[31m✗ Update failed\x1b[0m\n');
            logError('update', error);
          }
        }
        // Quick action shortcuts
        if (input === 'n') {
          render(<NewProfileWizard />);
          return;
        }
        if (input === 'e') {
          setStep('edit');
          return;
        }
        if (input === 'p') {
          setStep('parallel');
          return;
        }
        if (input === 'y') {
          setStep('yolo');
          return;
        }
        if (input === 'm') {
          render(<McpSearch />);
          return;
        }
        if (input === 's') {
          render(<SkillsBrowser />);
          return;
        }
        if (input === 'i') {
          execSync('cm status', { stdio: 'inherit' });
          process.exit(0);
        }
        if (input === 'q') {
          process.exit(0);
        }
        if (input === '/' && !showHelp) {
          setShowCommandPalette(true);
          setCommandInput('/');
          return;
        }
        if (input.match(/^[a-zA-Z]$/) && !['u', 'c', '?', '/', 'n', 'e', 'p', 'y', 'm', 's', 'i', 'q'].includes(input)) {
          setFilter(f => f + input);
        }
        if (key.backspace || key.delete) {
          setFilter(f => f.slice(0, -1));
        }
        if (key.escape) {
          setFilter('');
        }
        if (input === '?') {
          setShowHelp(true);
        }
        if (input === 'c') {
          const editor = process.env.EDITOR || 'nano';
          createDefaultSettings();
          console.clear();
          spawnSync(editor, [SETTINGS_PATH], { stdio: 'inherit' });
          console.log('\n\x1b[36mConfig edited. Press Enter to continue...\x1b[0m');
        }
      }
      if (showHelp && (input === 'q' || input === '?' || key.escape || key.return)) {
        setShowHelp(false);
      }
    });

    if (step === 'loading') {
      return <LoadingScreen message="Initializing Claude Manager" />;
    }


    if (step === 'parallel') {
      return <ParallelSelector profiles={profiles} dangerMode={dangerMode} />;
    }

    if (step === 'edit') {
      return <ProfileActionSelector profiles={profiles} action="edit" />;
    }

    if (step === 'copy') {
      return <ProfileActionSelector profiles={profiles} action="copy" />;
    }

    if (step === 'delete') {
      return <ProfileActionSelector profiles={profiles} action="delete" />;
    }

    if (step === 'yolo') {
      return <ProfileActionSelector profiles={profiles} action="yolo" />;
    }

    if (step === 'mcp-remove') {
      return <McpRemoveSelector profiles={profiles} />;
    }

    if (step === 'skills-remove') {
      return <SkillsRemoveSelector />;
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

    // Get current profile info
    const lastProfile = getLastProfile();
    const currentProfile = profiles.find(p => p.value === lastProfile);
    const installedSkills = getInstalledSkills();
    
    // Count MCP servers across all profiles
    const totalMcpServers = profiles.reduce((acc, p) => acc + Object.keys(p.data.mcpServers || {}).length, 0);

    return (
      <Box flexDirection="column" padding={1}>
        {/* Header */}
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="column">
            <Text bold color="cyan">{LOGO}</Text>
            <Text bold color="magenta">MANAGER v{VERSION}</Text>
          </Box>
          <Box flexDirection="column" alignItems="flex-end">
            {updateInfo?.current && <Text dimColor>Claude v{updateInfo.current}</Text>}
            {updateInfo?.needsUpdate && (
              <Text color="yellow">⬆ Update available (u)</Text>
            )}
          </Box>
        </Box>
        
        <Text dimColor>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>

        {/* Main Content - Two Column Layout */}
        <Box flexDirection="row" marginTop={1}>
          
          {/* Left Column - Profiles */}
          <Box flexDirection="column" width="50%">
            <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
              <Text bold color="cyan">📋 PROFILES ({profiles.length})</Text>
              {filter && <Text color="yellow">🔍 Filter: {filter}</Text>}
              <Box flexDirection="column" marginTop={1}>
                {filteredProfiles.slice(0, 7).map((p, i) => {
                  const isCurrent = p.value === lastProfile;
                  return (
                    <Text key={p.value}>
                      <Text color="yellow">{i + 1}</Text>
                      <Text color={isCurrent ? "green" : "white"}>{isCurrent ? " ● " : "   "}</Text>
                      <Text color={isCurrent ? "green" : "white"}>{p.label}</Text>
                      {p.group && <Text dimColor> [{p.group}]</Text>}
                    </Text>
                  );
                })}
                {filteredProfiles.length > 7 && (
                  <Text dimColor>  +{filteredProfiles.length - 7} more...</Text>
                )}
              </Box>
            </Box>

            {/* Current Profile Status */}
            {currentProfile && (
              <Box borderStyle="round" borderColor="green" flexDirection="column" paddingX={1} marginTop={1}>
                <Text bold color="green">✓ ACTIVE PROFILE</Text>
                <Text><Text color="cyan">{currentProfile.label}</Text></Text>
                <Text dimColor>Model: {currentProfile.data.model || 'default'}</Text>
                {Object.keys(currentProfile.data.mcpServers || {}).length > 0 && (
                  <Text dimColor>MCP: {Object.keys(currentProfile.data.mcpServers).join(', ')}</Text>
                )}
              </Box>
            )}
          </Box>

          {/* Right Column - Features */}
          <Box flexDirection="column" width="50%" marginLeft={1}>
            
            {/* Quick Actions */}
            <Box borderStyle="round" borderColor="magenta" flexDirection="column" paddingX={1}>
              <Text bold color="magenta">⚡ QUICK ACTIONS</Text>
              <Box flexDirection="column" marginTop={1}>
                <Text><Text color="yellow">n</Text> <Text color="cyan">New Profile</Text></Text>
                <Text><Text color="yellow">e</Text> <Text color="cyan">Edit Profile</Text></Text>
                <Text><Text color="yellow">p</Text> <Text color="cyan">Parallel Launch</Text> <Text dimColor>🚀</Text></Text>
                <Text><Text color="yellow">y</Text> <Text color="cyan">YOLO Mode</Text> <Text dimColor>⚡</Text></Text>
              </Box>
            </Box>

            {/* Extensions */}
            <Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1} marginTop={1}>
              <Text bold color="yellow">🔌 EXTENSIONS</Text>
              <Box flexDirection="column" marginTop={1}>
                <Text><Text color="yellow">m</Text> <Text color="cyan">MCP Servers</Text> <Text dimColor>({totalMcpServers} installed)</Text></Text>
                <Text><Text color="yellow">s</Text> <Text color="cyan">Skills</Text> <Text dimColor>({installedSkills.length} installed)</Text></Text>
              </Box>
            </Box>

            {/* Info */}
            <Box borderStyle="round" borderColor="gray" flexDirection="column" paddingX={1} marginTop={1}>
              <Text bold color="gray">📊 INFO</Text>
              <Box flexDirection="column" marginTop={1}>
                <Text><Text color="yellow">i</Text> <Text dimColor>Status</Text></Text>
                <Text><Text color="yellow">c</Text> <Text dimColor>Config</Text></Text>
                <Text><Text color="yellow">?</Text> <Text dimColor>Help</Text></Text>
              </Box>
            </Box>
          </Box>
        </Box>

        <Text dimColor marginTop={1}>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>
        
        {/* Footer - Keyboard hints */}
        <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
          <Text dimColor>
            <Text color="yellow">1-9</Text> select • 
            <Text color="yellow">↑↓</Text> navigate • 
            <Text color="yellow">Enter</Text> launch • 
            <Text color="yellow">a-z</Text> filter • 
            <Text color="yellow">/</Text> commands
          </Text>
          <Text dimColor>
            <Text color="yellow">q</Text> quit
          </Text>
        </Box>

        {/* Command Palette Overlay */}
        {showCommandPalette && (
          <Box flexDirection="column" padding={1} marginTop={1} borderStyle="double" borderColor="magenta">
            <Text bold color="magenta">Command Palette</Text>
            <Text dimColor>─────────────────────────────────────────</Text>
            <Box marginTop={1}>
              <Text color="cyan">{'>'}</Text>
              <Text color="white">{commandInput}</Text>
            </Box>
            {(() => {
              const categories = [...new Set(filteredCommands.map(c => c.category))];
              return categories.map(cat => (
                <Box key={cat} flexDirection="column" marginTop={1}>
                  <Text bold color="yellow">{cat}</Text>
                  {filteredCommands.filter(c => c.category === cat).map(cmd => (
                    <Text key={cmd.label}>
                      <Text>{cmd.icon || '•'} </Text>
                      <Text color="cyan">{cmd.label}</Text>
                      <Text dimColor> - </Text>
                      <Text color="gray">{cmd.description}</Text>
                    </Text>
                  ))}
                </Box>
              ));
            })()}
            <Text dimColor marginTop={1}>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>
            <Text dimColor>Enter to execute • Esc to close • Type to filter</Text>
          </Box>
        )}

        {showHelp && (
          <Box flexDirection="column" padding={1} marginTop={1} borderStyle="single" borderColor="cyan">
            <Text bold color="cyan">Keyboard Shortcuts</Text>
            <Text dimColor>─────────────────────────</Text>
            <Box flexDirection="row">
              <Box flexDirection="column" width="50%">
                <Text bold color="magenta">Navigation</Text>
                <Text>  <Text color="yellow">1-9</Text>     Quick select profile</Text>
                <Text>  <Text color="yellow">↑/↓</Text>     Navigate list</Text>
                <Text>  <Text color="yellow">Enter</Text>   Select & launch</Text>
                <Text bold color="magenta" marginTop={1}>Search</Text>
                <Text>  <Text color="yellow">a-z</Text>     Fuzzy filter</Text>
                <Text>  <Text color="yellow">Esc</Text>     Clear filter</Text>
              </Box>
              <Box flexDirection="column" width="50%">
                <Text bold color="magenta">Actions</Text>
                <Text>  <Text color="yellow">n</Text>       New profile</Text>
                <Text>  <Text color="yellow">e</Text>       Edit profile</Text>
                <Text>  <Text color="yellow">p</Text>       Parallel launch</Text>
                <Text>  <Text color="yellow">y</Text>       YOLO mode</Text>
                <Text>  <Text color="yellow">m</Text>       MCP servers</Text>
                <Text>  <Text color="yellow">s</Text>       Skills</Text>
              </Box>
            </Box>
            <Text dimColor marginTop={1}>Press ? or Esc to close</Text>
          </Box>
        )}
      </Box>
    );
  };

  render(<App />);
}
