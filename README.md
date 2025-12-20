# Claude Manager (cm) v1.4.0

A terminal app for managing Claude Code settings, profiles, MCP servers, and skills.

## Installation

```bash
# Already installed at /usr/local/bin/cm
cm -v
```

## Quick Start

```bash
cm              # Select profile and launch Claude
cm --last       # Use last profile instantly
cm --skip-update # Skip update check
```

## Commands

### Profile Management

```bash
cm                  # Interactive profile selection (1-9 quick select, type to filter)
cm list             # List all profiles
cm new              # Create new profile wizard
cm edit <name|num>  # Edit profile in $EDITOR
cm delete <name|num># Delete profile
cm status           # Show current settings
```

### MCP Servers

```bash
cm mcp              # Search MCP registry interactively
cm mcp github       # Search for "github" servers
cm mcp web          # Search for "web" servers
```

Select a server → Choose profile → Server added to profile's `mcpServers`.

### Skills

```bash
cm skills           # Browse skills from 3 repositories
```

Skills are added to `~/.claude.json` globally.

## Profiles

Profiles are stored in `~/.claude/profiles/*.json`

### Example Profile

```json
{
  "name": "Z.AI (GLM)",
  "group": "providers",
  "env": {
    "ANTHROPIC_MODEL": "Z.ai/GLM 4.6v",
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
| `mcpServers` | MCP server configurations |

## Per-Project Profiles

Create `.claude-profile` in any directory with a profile name:

```bash
echo "Z.AI (GLM)" > /path/to/project/.claude-profile
```

When you run `cm` from that directory, it auto-selects that profile.

## Features

- **Auto-update check**: Prompts when Claude update available via Homebrew
- **Number shortcuts**: Press 1-9 to quick-select profiles
- **Fuzzy search**: Type to filter profiles
- **Profile groups**: Organize profiles with `"group": "name"`
- **MCP management**: Per-profile MCP server configs
- **Skills**: Add skills from multiple repositories

## File Locations

| File | Purpose |
|------|---------|
| `~/.claude/profiles/*.json` | Profile configurations |
| `~/.claude/settings.json` | Active Claude settings |
| `~/.claude.json` | MCP servers & skills |
| `~/.claude/.last-profile` | Last used profile |
| `.claude-profile` | Per-project profile |

## Providers

Pre-configured providers in `cm new`:

- Anthropic (Direct)
- Amazon Bedrock  
- Z.AI
- MiniMax
- Custom

## Tips

```bash
# Quick launch with last profile
cm -l

# Skip update check for faster startup
cm --skip-update

# Edit profile by number
cm edit 1

# Add alias to shell
alias c="cm --skip-update"
```
