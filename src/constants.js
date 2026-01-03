import os from 'os';
import path from 'path';

// Version
export const VERSION = "1.5.5";

// ASCII Logo
export const LOGO = `██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝`;

// Paths
export const PROFILES_DIR = path.join(os.homedir(), '.claude', 'profiles');
export const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
export const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json');
export const LAST_PROFILE_PATH = path.join(os.homedir(), '.claude', '.last-profile');
export const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

// External URLs
export const MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0/servers';

// GitHub skill sources
export const SKILL_SOURCES = [
  { url: 'https://api.github.com/repos/anthropics/skills/contents/skills', base: 'https://github.com/anthropics/skills/tree/main/skills' },
  { url: 'https://api.github.com/repos/Prat011/awesome-llm-skills/contents/skills', base: 'https://github.com/Prat011/awesome-llm-skills/tree/main/skills' },
  { url: 'https://api.github.com/repos/skillcreatorai/Ai-Agent-Skills/contents/skills', base: 'https://github.com/skillcreatorai/Ai-Agent-Skills/tree/main/skills' },
];

// Provider configurations
export const PROVIDERS = [
  { label: 'Anthropic (Direct)', value: 'anthropic', url: '', needsKey: true },
  { label: 'Amazon Bedrock', value: 'bedrock', url: '', needsKey: false },
  { label: 'Z.AI', value: 'zai', url: 'https://api.z.ai/api/anthropic', needsKey: true },
  { label: 'MiniMax', value: 'minimax', url: 'https://api.minimax.io/anthropic', needsKey: true },
  { label: 'Custom', value: 'custom', url: '', needsKey: true },
];

// Timeouts (in milliseconds)
export const FETCH_TIMEOUT = 10000;
export const NPM_OUTDATED_TIMEOUT = 5000;
export const GIT_CLONE_TIMEOUT = 30000;
export const GIT_SPARSE_TIMEOUT = 10000;
export const GIT_MOVE_TIMEOUT = 5000;
export const GIT_CLEANUP_TIMEOUT = 5000;

// Pagination
export const MCP_PAGE_SIZE = 50;
export const MCP_FETCH_LIMIT = 200;
export const SKILLS_PAGE_SIZE = 50;

// Default settings
export const DEFAULT_SETTINGS = {
  env: {},
  model: 'opus',
  alwaysThinkingEnabled: true,
  defaultMode: 'bypassPermissions',
};

// API timeout for Claude requests
export const API_TIMEOUT_MS = '3000000';

// Fuzzy search threshold
export const FUSE_THRESHOLD = 0.3;
