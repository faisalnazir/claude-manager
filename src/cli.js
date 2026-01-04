import React, { useState, useEffect, useMemo } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { spawnSync, execSync } from 'child_process';
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
  sanitizeFilePath,
  safeParseInt,
  logError,
} from './utils.js';

import {
  sessionManager,
  workflowEngine,
  templateManager,
  taskQueue,
  hooksManager,
  analytics,
} from './orchestrator.js';

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
  console.log(`cm v${VERSION} - Claude Development Orchestrator

Usage: cm [command] [options]

Profile Management:
  (none)          Select profile interactively
  new             Create a new profile
  edit <n>        Edit profile (by name or number)
  copy <n> <new>  Copy/duplicate a profile
  delete <n>      Delete profile (by name or number)
  list            List all profiles
  status          Show current settings
  config          Open Claude settings.json in editor

MCP & Skills:
  mcp [query]     Search and add MCP servers
  mcp remove      Remove MCP server from profile
  skills          Browse and add Anthropic skills
  skills list     List installed skills
  skills remove   Remove an installed skill

Orchestration:
  session list    List all sessions
  session end <id>    End a session
  session kill <id>   Kill a session
  session clean   Clean old sessions

  workflow list   List all workflows
  workflow create Create a new workflow
  workflow run <id>   Execute a workflow
  workflow delete <id> Delete a workflow

  template list   List project templates
  template create <name> <dir>  Create project from template

  task list       List all tasks
  task add <cmd>  Add task to queue
  task run <id>   Run a task
  task queue      Process task queue

  hook list       List all hooks
  hook add <event> <script>  Add a hook
  hook remove <event>        Remove a hook

  stats           Show orchestration statistics
  batch <cmd>     Run command across all profiles

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

// ============= ORCHESTRATION COMMANDS =============

// Session management
if (cmd === 'session') {
  const subCmd = args[1];

  if (subCmd === 'list') {
    const sessions = sessionManager.listSessions();
    console.log(`\x1b[1m\x1b[36mSessions\x1b[0m (${sessions.length})`);
    console.log(`─────────────────────────`);
    if (sessions.length === 0) {
      console.log('No sessions found');
    } else {
      sessions.forEach(s => {
        const status = s.status === 'active' ? '\x1b[32mactive\x1b[0m' :
                      s.status === 'completed' ? '\x1b[33mcompleted\x1b[0m' : '\x1b[31mkilled\x1b[0m';
        console.log(`${s.id.slice(-8)} | ${s.profile} | ${status} | ${s.startTime}`);
      });
    }
    process.exit(0);
  }

  if (subCmd === 'end') {
    const sessionId = args[2];
    if (!sessionId) {
      console.log('\x1b[31mUsage: cm session end <session-id>\x1b[0m');
      process.exit(1);
    }
    const result = sessionManager.endSession(sessionId);
    if (result) {
      console.log(`\x1b[32m✓\x1b[0m Session ended: ${sessionId}`);
    } else {
      console.log(`\x1b[31m✗\x1b[0m Session not found: ${sessionId}`);
    }
    process.exit(0);
  }

  if (subCmd === 'kill') {
    const sessionId = args[2];
    if (!sessionId) {
      console.log('\x1b[31mUsage: cm session kill <session-id>\x1b[0m');
      process.exit(1);
    }
    const result = sessionManager.killSession(sessionId);
    if (result) {
      console.log(`\x1b[32m✓\x1b[0m Session killed: ${sessionId}`);
    } else {
      console.log(`\x1b[31m✗\x1b[0m Session not found: ${sessionId}`);
    }
    process.exit(0);
  }

  if (subCmd === 'clean') {
    const days = safeParseInt(args[2], 7);
    const cleaned = sessionManager.cleanSessions(days);
    console.log(`\x1b[32m✓\x1b[0m Cleaned ${cleaned} old sessions`);
    process.exit(0);
  }

  console.log('\x1b[31mUsage: cm session <list|end|kill|clean>\x1b[0m');
  process.exit(1);
}

// Workflow management
if (cmd === 'workflow') {
  const subCmd = args[1];

  if (subCmd === 'list') {
    const workflows = workflowEngine.listWorkflows();
    console.log(`\x1b[1m\x1b[36mWorkflows\x1b[0m (${workflows.length})`);
    console.log(`─────────────────────────`);
    if (workflows.length === 0) {
      console.log('No workflows found');
    } else {
      workflows.forEach(w => {
        console.log(`${w.id.slice(-8)} | ${w.name} | ${w.steps.length} steps`);
      });
    }
    process.exit(0);
  }

  if (subCmd === 'create') {
    console.log('\x1b[33mInteractive workflow creator coming soon!\x1b[0m');
    console.log('For now, create workflows manually in ~/.claude/orchestrator/workflows/');
    process.exit(0);
  }

  if (subCmd === 'run') {
    const workflowId = args[2];
    if (!workflowId) {
      console.log('\x1b[31mUsage: cm workflow run <workflow-id>\x1b[0m');
      process.exit(1);
    }
    console.log(`\x1b[36mExecuting workflow: ${workflowId}\x1b[0m`);
    workflowEngine.executeWorkflow(workflowId).then(result => {
      console.log(`\x1b[32m✓\x1b[0m Workflow ${result.status}`);
      console.log(`Steps completed: ${result.steps.filter(s => s.success).length}/${result.steps.length}`);
      process.exit(0);
    }).catch(error => {
      console.log(`\x1b[31m✗\x1b[0m ${error.message}`);
      process.exit(1);
    });
  }

  if (subCmd === 'delete') {
    const workflowId = args[2];
    if (!workflowId) {
      console.log('\x1b[31mUsage: cm workflow delete <workflow-id>\x1b[0m');
      process.exit(1);
    }
    const result = workflowEngine.deleteWorkflow(workflowId);
    if (result) {
      console.log(`\x1b[32m✓\x1b[0m Workflow deleted: ${workflowId}`);
    } else {
      console.log(`\x1b[31m✗\x1b[0m Workflow not found: ${workflowId}`);
    }
    process.exit(0);
  }

  console.log('\x1b[31mUsage: cm workflow <list|create|run|delete>\x1b[0m');
  process.exit(1);
}

// Template management
if (cmd === 'template') {
  const subCmd = args[1];

  if (subCmd === 'list' || !subCmd) {
    const templates = templateManager.listTemplates();
    console.log(`\x1b[1m\x1b[36mProject Templates\x1b[0m (${templates.length})`);
    console.log(`─────────────────────────`);
    templates.forEach(t => {
      console.log(`\x1b[33m${t.name}\x1b[0m`);
      console.log(`  ${t.description}`);
      console.log();
    });
    process.exit(0);
  }

  if (subCmd === 'create') {
    const templateName = args[2];
    const projectName = args[3];
    const targetDir = args[4] || process.cwd();

    if (!templateName || !projectName) {
      console.log('\x1b[31mUsage: cm template create <template-name> <project-name> [target-dir]\x1b[0m');
      process.exit(1);
    }

    try {
      const result = templateManager.createProject(templateName, projectName, targetDir);
      console.log(`\x1b[32m✓\x1b[0m Project created: ${result.projectPath}`);
      console.log(`Template: ${result.template}`);
    } catch (error) {
      console.log(`\x1b[31m✗\x1b[0m ${error.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  console.log('\x1b[31mUsage: cm template <list|create>\x1b[0m');
  process.exit(1);
}

// Task management
if (cmd === 'task') {
  const subCmd = args[1];

  if (subCmd === 'list') {
    const tasks = taskQueue.listTasks();
    console.log(`\x1b[1m\x1b[36mTasks\x1b[0m (${tasks.length})`);
    console.log(`─────────────────────────`);
    if (tasks.length === 0) {
      console.log('No tasks found');
    } else {
      tasks.forEach(t => {
        const status = t.status === 'queued' ? '\x1b[33mqueued\x1b[0m' :
                      t.status === 'running' ? '\x1b[36mrunning\x1b[0m' :
                      t.status === 'completed' ? '\x1b[32mcompleted\x1b[0m' : '\x1b[31mfailed\x1b[0m';
        console.log(`${t.id.slice(-8)} | ${t.command.slice(0, 40)} | ${status}`);
      });
    }
    process.exit(0);
  }

  if (subCmd === 'add') {
    const command = args.slice(2).join(' ');
    if (!command) {
      console.log('\x1b[31mUsage: cm task add <command>\x1b[0m');
      process.exit(1);
    }
    const task = taskQueue.addTask({ command });
    console.log(`\x1b[32m✓\x1b[0m Task added: ${task.id}`);
    process.exit(0);
  }

  if (subCmd === 'run') {
    const taskId = args[2];
    if (!taskId) {
      console.log('\x1b[31mUsage: cm task run <task-id>\x1b[0m');
      process.exit(1);
    }
    console.log(`\x1b[36mRunning task: ${taskId}\x1b[0m`);
    taskQueue.executeTask(taskId).then(result => {
      console.log(`\x1b[32m✓\x1b[0m Task completed`);
      if (result.output) console.log(result.output);
      process.exit(0);
    }).catch(error => {
      console.log(`\x1b[31m✗\x1b[0m ${error.message}`);
      process.exit(1);
    });
  }

  if (subCmd === 'queue') {
    const concurrency = safeParseInt(args[2], 1);
    console.log(`\x1b[36mProcessing task queue (concurrency: ${concurrency})\x1b[0m`);
    taskQueue.processQueue(concurrency).then(results => {
      const successful = results.filter(r => r.status === 'fulfilled').length;
      console.log(`\x1b[32m✓\x1b[0m Processed ${results.length} tasks (${successful} successful)`);
      process.exit(0);
    }).catch(error => {
      console.log(`\x1b[31m✗\x1b[0m ${error.message}`);
      process.exit(1);
    });
  }

  console.log('\x1b[31mUsage: cm task <list|add|run|queue>\x1b[0m');
  process.exit(1);
}

// Hook management
if (cmd === 'hook') {
  const subCmd = args[1];

  if (subCmd === 'list' || !subCmd) {
    const hooks = hooksManager.listHooks();
    console.log(`\x1b[1m\x1b[36mHooks\x1b[0m (${hooks.length})`);
    console.log(`─────────────────────────`);
    if (hooks.length === 0) {
      console.log('No hooks found');
    } else {
      hooks.forEach(h => console.log(`  - ${h}`));
    }
    process.exit(0);
  }

  if (subCmd === 'add') {
    const event = args[2];
    const scriptPath = args[3];
    if (!event || !scriptPath) {
      console.log('\x1b[31mUsage: cm hook add <event> <script-path>\x1b[0m');
      process.exit(1);
    }
    if (!fs.existsSync(scriptPath)) {
      console.log(`\x1b[31m✗\x1b[0m Script not found: ${scriptPath}`);
      process.exit(1);
    }
    const script = fs.readFileSync(scriptPath, 'utf8');
    hooksManager.registerHook(event, script);
    console.log(`\x1b[32m✓\x1b[0m Hook added: ${event}`);
    process.exit(0);
  }

  if (subCmd === 'remove') {
    const event = args[2];
    if (!event) {
      console.log('\x1b[31mUsage: cm hook remove <event>\x1b[0m');
      process.exit(1);
    }
    const result = hooksManager.deleteHook(event);
    if (result) {
      console.log(`\x1b[32m✓\x1b[0m Hook removed: ${event}`);
    } else {
      console.log(`\x1b[31m✗\x1b[0m Hook not found: ${event}`);
    }
    process.exit(0);
  }

  console.log('\x1b[31mUsage: cm hook <list|add|remove>\x1b[0m');
  process.exit(1);
}

// Statistics
if (cmd === 'stats') {
  const stats = analytics.getStats();
  console.log(`\x1b[1m\x1b[36mOrchestration Statistics\x1b[0m`);
  console.log(`─────────────────────────`);
  console.log(`\n\x1b[33mSessions:\x1b[0m`);
  console.log(`  Total: ${stats.sessions.total}`);
  console.log(`  Active: ${stats.sessions.active}`);
  console.log(`  Completed: ${stats.sessions.completed}`);
  console.log(`\n\x1b[33mWorkflows:\x1b[0m`);
  console.log(`  Total: ${stats.workflows.total}`);
  console.log(`  Executed: ${stats.workflows.executed}`);
  console.log(`\n\x1b[33mTasks:\x1b[0m`);
  console.log(`  Total: ${stats.tasks.total}`);
  console.log(`  Queued: ${stats.tasks.queued}`);
  console.log(`  Running: ${stats.tasks.running}`);
  console.log(`  Completed: ${stats.tasks.completed}`);
  console.log(`  Failed: ${stats.tasks.failed}`);
  process.exit(0);
}

// Batch operations
if (cmd === 'batch') {
  const command = args.slice(1).join(' ');
  if (!command) {
    console.log('\x1b[31mUsage: cm batch <command>\x1b[0m');
    console.log('Example: cm batch "claude --version"');
    process.exit(1);
  }

  const profiles = loadProfiles();
  console.log(`\x1b[36mRunning command across ${profiles.length} profiles:\x1b[0m ${command}\n`);

  let successful = 0;
  let failed = 0;

  profiles.forEach(profile => {
    console.log(`\x1b[33m[${profile.label}]\x1b[0m`);
    try {
      applyProfile(profile.value);
      const result = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
      console.log(result);
      successful++;
    } catch (error) {
      console.log(`\x1b[31m✗ Error: ${error.message}\x1b[0m`);
      failed++;
    }
    console.log();
  });

  console.log(`\x1b[32m✓\x1b[0m Batch complete: ${successful} successful, ${failed} failed`);
  process.exit(0);
}

// ============= END ORCHESTRATION COMMANDS =============

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

  const App = () => {
    const [step, setStep] = useState('loading');
    const [updateInfo, setUpdateInfo] = useState(null);
    const [filter, setFilter] = useState('');
    const [showHelp, setShowHelp] = useState(false);
    const [showCommandPalette, setShowCommandPalette] = useState(false);
    const [commandInput, setCommandInput] = useState('');
    const profiles = loadProfiles();

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
        if (input === '/' && !showHelp) {
          setShowCommandPalette(true);
          setCommandInput('/');
          return;
        }
        if (input.match(/^[a-zA-Z]$/) && input !== 'u' && input !== 'c' && input !== '?' && input !== '/') {
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
      launchClaude(dangerMode);
    };

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">{LOGO}</Text>
        <Text bold color="magenta">MANAGER v{VERSION}</Text>
        <Text dimColor>─────────────────────────</Text>
        {updateInfo?.current && <Text dimColor>Claude v{updateInfo.current}</Text>}
        {updateInfo?.needsUpdate && (
          <Text color="yellow">Update available! Press 'u' to upgrade</Text>
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
