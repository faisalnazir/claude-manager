# Claude Manager (cm)

A powerful terminal app for managing Claude Code settings, profiles, MCP servers, and skills. Switch between different AI providers, models, and configurations with a single command.

![Version](https://img.shields.io/badge/version-1.4.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- 🔄 **Profile Management** - Create, edit, and switch between multiple Claude configurations
- 🚀 **Quick Launch** - Select profile and launch Claude in one command
- 🔌 **MCP Server Registry** - Search and add MCP servers from the official registry
- 🎯 **Skills Browser** - Browse and install skills from 3 repositories
- 📁 **Per-Project Profiles** - Auto-select profiles based on project directory
- 🔢 **Quick Select** - Press 1-9 to instantly select profiles
- 🔍 **Fuzzy Search** - Type to filter profiles
- 📦 **Profile Groups** - Organize profiles by category
- 🔄 **Auto-Update Check** - Get notified when Claude updates are available

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/faisalnazir/claude-manager/main/install.sh | bash
```

### Requirements
- [Bun](https://bun.sh) (auto-installed if missing)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## Quick Start

```bash
cm              # Select profile interactively and launch Claude
cm -l           # Use last profile instantly
cm --yolo       # Launch with --dangerously-skip-permissions
```

## Commands

### Profile Management

| Command | Description |
|---------|-------------|
| `cm` | Interactive profile selection (1-9 quick select, type to filter) |
| `cm list` | List all profiles |
| `cm new` | Create new profile wizard |
| `cm edit <name\|num>` | Edit profile in $EDITOR |
| `cm delete <name\|num>` | Delete profile |
| `cm status` | Show current settings, MCP servers, and skills |

### MCP Servers

```bash
cm mcp              # Search MCP registry interactively
cm mcp github       # Search for "github" servers
cm mcp web          # Search for "web" servers
```

Select a server → Choose profile → Server config added to profile.

### Skills

```bash
cm skills           # Browse and install skills
```

Skills are downloaded from 3 repositories:
- [anthropics/skills](https://github.com/anthropics/skills) (official)
- [Prat011/awesome-llm-skills](https://github.com/Prat011/awesome-llm-skills)
- [skillcreatorai/Ai-Agent-Skills](https://github.com/skillcreatorai/Ai-Agent-Skills)

### Options

| Flag | Description |
|------|-------------|
| `--last`, `-l` | Use last profile without menu |
| `--skip-update` | Skip Claude update check |
| `--yolo` | Run Claude with `--dangerously-skip-permissions` |
| `-v`, `--version` | Show version |
| `-h`, `--help` | Show help |

## Profiles

Profiles are stored in `~/.claude/profiles/*.json`

### Example Profile

```json
{
  "name": "Z.AI (GLM)",
  "group": "providers",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-api-key",
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "API_TIMEOUT_MS": "3000000"
  },
  "model": "opus",
  "enabledPlugins": {
    "glm-plan-usage@zai-coding-plugins": true
  },
  "alwaysThinkingEnabled": true,
  "defaultMode": "bypassPermissions",
  "mcpServers": {
    "web-search": {
      "type": "http",
      "url": "https://api.z.ai/api/mcp/web_search_prime/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

### Profile Fields

| Field | Description |
|-------|-------------|
| `name` | Display name |
| `group` | Optional grouping (e.g., "providers", "work") |
| `env` | Environment variables for Claude |
| `model` | Model tier: "opus", "sonnet", "haiku" |
| `enabledPlugins` | Plugins to enable |
| `alwaysThinkingEnabled` | Enable extended thinking |
| `defaultMode` | Permission mode |
| `mcpServers` | MCP server configurations (per-profile) |

## Supported Providers

Pre-configured in `cm new`:

| Provider | Base URL |
|----------|----------|
| Anthropic (Direct) | Default |
| Amazon Bedrock | Default |
| Z.AI | `https://api.z.ai/api/anthropic` |
| MiniMax | `https://api.minimax.io/anthropic` |
| Custom | Your URL |

## Per-Project Profiles

Create `.claude-profile` in any directory with a profile name:

```bash
echo "Z.AI (GLM)" > /path/to/project/.claude-profile
```

When you run `cm` from that directory, it auto-selects that profile.

## File Locations

| File | Purpose |
|------|---------|
| `~/.claude/profiles/*.json` | Profile configurations |
| `~/.claude/settings.json` | Active Claude settings |
| `~/.claude/skills/` | Installed skills |
| `~/.claude.json` | Global MCP servers |
| `~/.claude/.last-profile` | Last used profile |
| `.claude-profile` | Per-project profile selector |

## Tips

```bash
# Quick launch aliases
alias c="cm --skip-update"
alias cy="cm --skip-update --yolo"
alias cl="cm -l --skip-update"

# Edit profile by number
cm edit 1

# Check what's installed
cm status
```

## How It Works

1. **Profile Selection**: Choose a profile from the interactive menu
2. **Settings Applied**: Profile config is written to `~/.claude/settings.json`
3. **MCP Servers**: Profile's MCP servers are written to `~/.claude.json`
4. **Claude Launched**: Claude Code starts with your selected configuration

## Contributing

Pull requests welcome! Please ensure no API keys or sensitive data in commits.

## License

MIT
