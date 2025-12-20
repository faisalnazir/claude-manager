import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawnSync } from 'child_process';

const VERSION = '1.4.0';
const PROFILES_DIR = path.join(os.homedir(), '.claude', 'profiles');
const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json');
const LAST_PROFILE_PATH = path.join(os.homedir(), '.claude', '.last-profile');
const MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0/servers';

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
  (none)      Select profile interactively
  new         Create a new profile
  edit <n>    Edit profile (by name or number)
  delete <n>  Delete profile (by name or number)
  status      Show current settings
  list        List all profiles
  mcp [query] Search and add MCP servers
  skills      Browse and add Anthropic skills

Options:
  --last, -l      Use last profile without menu
  --skip-update   Skip update check
  --yolo          Run claude with --dangerously-skip-permissions
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

const checkForUpdate = () => {
  if (skipUpdate) return { needsUpdate: false };
  try {
    const output = execSync('brew outdated claude-code 2>/dev/null', { encoding: 'utf8' }).trim();
    const current = execSync('claude --version 2>/dev/null', { encoding: 'utf8' }).match(/(\d+\.\d+\.\d+)/)?.[1];
    return { current, needsUpdate: output.includes('claude-code') };
  } catch {
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

if (cmd === 'delete') {
  const profiles = loadProfiles();
  const target = args[1];
  const idx = parseInt(target) - 1;
  const match = profiles[idx] || profiles.find(p => p.label.toLowerCase() === target?.toLowerCase());
  if (match) {
    fs.unlinkSync(path.join(PROFILES_DIR, match.value));
    console.log(`\x1b[32m✓\x1b[0m Deleted: ${match.label}`);
  } else {
    console.log(`\x1b[31mProfile not found: ${target}\x1b[0m`);
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

// MCP server search and add
const searchMcpServers = (query) => {
  try {
    const res = execSync(`curl -s "${MCP_REGISTRY_URL}?limit=100"`, { encoding: 'utf8', timeout: 10000 });
    const data = JSON.parse(res);
    const seen = new Set();
    return data.servers.filter(s => {
      if (seen.has(s.server.name)) return false;
      seen.add(s.server.name);
      const isLatest = s._meta?.['io.modelcontextprotocol.registry/official']?.isLatest !== false;
      const matchesQuery = !query || 
        s.server.name.toLowerCase().includes(query.toLowerCase()) ||
        s.server.description?.toLowerCase().includes(query.toLowerCase());
      return isLatest && matchesQuery;
    }).slice(0, 15);
  } catch {
    return [];
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
  const [servers, setServers] = useState([]);
  const [selectedServer, setSelectedServer] = useState(null);
  const profiles = loadProfiles();

  useEffect(() => {
    if (args[1] && step === 'loading') {
      const results = searchMcpServers(args[1]);
      setServers(results);
      setStep('results');
    }
  }, []);

  const doSearch = () => {
    const results = searchMcpServers(query);
    setServers(results);
    setStep('results');
  };

  const serverItems = servers.map(s => ({
    label: `${s.server.name} - ${s.server.description?.slice(0, 50) || ''}`,
    value: s,
    key: s.server.name + s.server.version,
  }));

  const profileItems = profiles.map(p => ({ label: p.label, value: p.value, key: p.key }));

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
    if (servers.length === 0) {
      return (
        <Box flexDirection="column" padding={1}>
          <Text color="yellow">No servers found for "{query}"</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">MCP Servers</Text>
        <Text dimColor>─────────────────────────</Text>
        <Text dimColor>Found {servers.length} servers</Text>
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

const fetchSkills = () => {
  const seen = new Set();
  const skills = [];
  for (const source of SKILL_SOURCES) {
    try {
      const res = execSync(`curl -s "${source.url}"`, { encoding: 'utf8', timeout: 10000 });
      const data = JSON.parse(res);
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
    } catch {}
  }
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
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = fetchSkills();
    setSkills(s);
    setLoading(false);
  }, []);

  if (loading) {
    return <Box padding={1}><Text>Loading skills...</Text></Box>;
  }

  if (skills.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Could not fetch skills</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">Anthropic Skills</Text>
      <Text dimColor>─────────────────────────</Text>
      <Text dimColor>Found {skills.length} skills</Text>
      <Box flexDirection="column" marginTop={1}>
        <SelectInput 
          items={skills} 
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
  render(<SkillsBrowser />);
} else if (cmd === 'mcp') {
  render(<McpSearch />);
} else if (cmd === 'new') {
  // New profile wizard
  const NewProfileWizard = () => {
    const { exit } = useApp();
    const [step, setStep] = useState('name');
    const [name, setName] = useState('');
    const [provider, setProvider] = useState('');
    const [model, setModel] = useState('');
    const [group, setGroup] = useState('');

    const providers = [
      { label: 'Anthropic (Direct)', value: 'anthropic', url: '' },
      { label: 'Amazon Bedrock', value: 'bedrock', url: '' },
      { label: 'Z.AI', value: 'zai', url: 'https://api.z.ai/api/anthropic' },
      { label: 'MiniMax', value: 'minimax', url: 'https://api.minimax.io/anthropic' },
      { label: 'Custom', value: 'custom', url: '' },
    ];

    const handleSave = () => {
      const prov = providers.find(p => p.value === provider);
      const profile = {
        name,
        group: group || undefined,
        env: {
          ANTHROPIC_MODEL: model,
          ...(prov?.url && { ANTHROPIC_BASE_URL: prov.url }),
          API_TIMEOUT_MS: '3000000',
        },
        model: 'opus',
        alwaysThinkingEnabled: true,
        defaultMode: 'bypassPermissions',
      };
      const filename = name.toLowerCase().replace(/\s+/g, '-') + '.json';
      fs.writeFileSync(path.join(PROFILES_DIR, filename), JSON.stringify(profile, null, 2));
      console.log(`\n\x1b[32m✓\x1b[0m Created: ${name}`);
      exit();
    };

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
            <SelectInput items={providers} onSelect={(item) => { setProvider(item.value); setStep('model'); }} />
          </Box>
        )}
        
        {step === 'model' && (
          <Box marginTop={1}>
            <Text>Model ID: </Text>
            <TextInput value={model} onChange={setModel} onSubmit={() => setStep('group')} />
          </Box>
        )}
        
        {step === 'group' && (
          <Box marginTop={1}>
            <Text>Group (optional): </Text>
            <TextInput value={group} onChange={setGroup} onSubmit={handleSave} />
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
        <Text bold color={colors[colorIdx]}>
{`██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗  
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝  
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝`}
        </Text>
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
    const profiles = loadProfiles();

    useEffect(() => {
      // Show loading screen briefly, then go to select
      setTimeout(() => setStep('select'), 800);
      
      // Check for updates in parallel (non-blocking)
      if (!skipUpdate) {
        Promise.resolve().then(() => {
          const info = checkForUpdate();
          setUpdateInfo(info);
        });
      }
    }, []);

    useInput((input, key) => {
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
            execSync('brew upgrade claude-code', { stdio: 'inherit' });
            console.log('\n\x1b[32m✓ Updated!\x1b[0m\n');
            setUpdateInfo({ ...updateInfo, needsUpdate: false });
          } catch {}
        }
        // Fuzzy filter
        if (input.match(/^[a-zA-Z]$/) && input !== 'u') {
          setFilter(f => f + input);
        }
        if (key.backspace || key.delete) {
          setFilter(f => f.slice(0, -1));
        }
        if (key.escape) {
          setFilter('');
        }
      }
    });

    // Group and filter profiles
    const filteredProfiles = profiles.filter(p => 
      !filter || p.label.toLowerCase().includes(filter.toLowerCase())
    );

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
        <Text bold color="cyan">CLAUDE MANAGER</Text>
        <Text dimColor>─────────────────────────</Text>
        {updateInfo?.current && <Text dimColor>Claude v{updateInfo.current}</Text>}
        {updateInfo?.needsUpdate && (
          <Text color="yellow">⚠ Update available! Press 'u' to upgrade</Text>
        )}
        {filter && <Text color="yellow">Filter: {filter}</Text>}
        <Box flexDirection="column" marginTop={1}>
          <Text>Select Profile: <Text dimColor>(1-9 quick select, type to filter{updateInfo?.needsUpdate ? ', u to update' : ''})</Text></Text>
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
      </Box>
    );
  };

  render(<App />);
}
