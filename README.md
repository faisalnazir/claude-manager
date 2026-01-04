# Claude Manager (cm) - Development Orchestrator

A powerful orchestration tool for Claude Code development. Manage profiles, automate workflows, track sessions, and accelerate your AI-powered development workflow.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## 🚀 Features

### Profile Management
- 🔄 **Profile Management** - Create, edit, and switch between multiple Claude configurations
- 🚀 **Quick Launch** - Select profile and launch Claude in one command
- 📁 **Per-Project Profiles** - Auto-select profiles based on project directory
- 🔢 **Quick Select** - Press 1-9 to instantly select profiles
- 🔍 **Fuzzy Search** - Type to filter profiles
- 📦 **Profile Groups** - Organize profiles by category

### MCP & Skills
- 🔌 **MCP Server Registry** - Search and add MCP servers from the official registry
- 🎯 **Skills Browser** - Browse and install skills from 3 repositories
- 🔄 **Auto-Update Check** - Get notified when Claude updates are available

### Orchestration (NEW!)
- 📊 **Session Management** - Track and manage active Claude sessions
- 🔄 **Workflow Engine** - Define and execute multi-step workflows
- 📋 **Task Queue** - Queue and orchestrate multiple tasks
- 🎨 **Project Templates** - Quick-start templates for different project types
- 🪝 **Hooks System** - Event-driven automation and custom scripts
- 📈 **Analytics** - Monitor usage, sessions, and workflows
- 🔁 **Batch Operations** - Run commands across all profiles

## Installation

### Option 1: Homebrew (macOS)

```bash
brew tap faisalnazir/claude-manager
brew install claude-manager
```

### Option 2: npm

```bash
npm install -g claude-manager
```

### Option 3: curl

```bash
curl -fsSL https://raw.githubusercontent.com/faisalnazir/claude-manager/main/install.sh | bash
```

### Requirements
- [Node.js 18+](https://nodejs.org) (for npm install)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## Quick Start

```bash
cm              # Select profile interactively and launch Claude
cm -l           # Use last profile instantly
cm --yolo       # Launch with --dangerously-skip-permissions
cm stats        # View orchestration statistics
```

## Commands

### Profile Management

| Command | Description |
|---------|-------------|
| `cm` | Interactive profile selection (1-9 quick select, type to filter) |
| `cm list` | List all profiles |
| `cm new` | Create new profile wizard |
| `cm edit <name\|num>` | Edit profile in $EDITOR |
| `cm copy <source> <new>` | Copy/duplicate a profile |
| `cm delete <name\|num>` | Delete profile |
| `cm status` | Show current settings, MCP servers, and skills |
| `cm config` | Open Claude settings.json in $EDITOR |

### MCP Servers

```bash
cm mcp              # Search MCP registry interactively
cm mcp github       # Search for "github" servers
cm mcp web          # Search for "web" servers
cm mcp remove <server> <profile>  # Remove MCP server from profile
```

### Skills

```bash
cm skills           # Browse and install skills
cm skills list      # List installed skills
cm skills remove <skill>  # Remove an installed skill
```

### Session Management

Track and manage your Claude sessions:

```bash
cm session list     # List all sessions
cm session end <id> # End a session
cm session kill <id> # Kill a running session
cm session clean [days]  # Clean sessions older than N days (default: 7)
```

Sessions are automatically tracked when you launch Claude through cm, recording:
- Session ID and profile used
- Start/end timestamps
- Project path
- Status (active, completed, killed)

### Workflow Automation

Create and execute multi-step workflows:

```bash
cm workflow list    # List all workflows
cm workflow create  # Create a new workflow (interactive)
cm workflow run <id> # Execute a workflow
cm workflow delete <id> # Delete a workflow
```

**Example Workflow** (create in `~/.claude/orchestrator/workflows/`):

```json
{
  "name": "test-and-deploy",
  "steps": [
    {
      "command": "npm test",
      "continueOnError": false
    },
    {
      "command": "npm run build",
      "continueOnError": false
    },
    {
      "command": "git push",
      "condition": "{{step0_result.exitCode}} === 0"
    }
  ]
}
```

### Project Templates

Quick-start projects from templates:

```bash
cm template list    # List available templates
cm template create <template-name> <project-name> [target-dir]
```

**Built-in Templates:**
- `web-app` - Full-stack web application with React
- `python-api` - Python API with FastAPI
- `data-analysis` - Data analysis project with Jupyter

**Example:**
```bash
cm template create web-app my-new-app ~/projects
```

### Task Queue

Queue and manage development tasks:

```bash
cm task list        # List all tasks
cm task add <command>  # Add task to queue
cm task run <id>    # Run a specific task
cm task queue [concurrency]  # Process queue (default concurrency: 1)
```

**Example:**
```bash
cm task add "npm test"
cm task add "npm run lint"
cm task add "npm run build"
cm task queue 2     # Run 2 tasks concurrently
```

### Hooks System

Add custom automation hooks:

```bash
cm hook list        # List all hooks
cm hook add <event> <script-path>  # Add a hook
cm hook remove <event>  # Remove a hook
```

**Available Events:**
- `pre-session` - Before starting a session
- `post-session` - After ending a session
- `pre-workflow` - Before executing a workflow
- `post-workflow` - After workflow completion
- Custom events as needed

**Example Hook** (`pre-session.sh`):
```bash
#!/bin/bash
echo "Starting Claude session with profile: $PROFILE"
git fetch origin
```

### Analytics & Statistics

Monitor your Claude development:

```bash
cm stats            # Show orchestration statistics
```

Displays:
- Total/active/completed sessions
- Workflow execution count
- Task queue statistics (queued, running, completed, failed)

### Batch Operations

Run commands across all profiles:

```bash
cm batch <command>  # Execute command for each profile
```

**Example:**
```bash
cm batch "claude --version"  # Check Claude version for all profiles
cm batch "echo 'Testing profile'"  # Test all profiles
```

### Options

| Flag | Description |
|------|-------------|
| `--last`, `-l` | Use last profile without menu |
| `--skip-update` | Skip Claude update check |
| `--yolo` | Run Claude with `--dangerously-skip-permissions` |
| `--force`, `-f` | Skip confirmation prompts |
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
| Google Vertex AI | Default |
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
| `~/.claude/orchestrator/` | Orchestration data |
| `~/.claude/orchestrator/sessions/` | Session tracking |
| `~/.claude/orchestrator/workflows/` | Workflow definitions |
| `~/.claude/orchestrator/templates/` | Project templates |
| `~/.claude/orchestrator/tasks/` | Task queue |
| `~/.claude/orchestrator/hooks/` | Hook scripts |
| `.claude-profile` | Per-project profile selector |

## Orchestration Architecture

```
cm (Claude Manager)
├── Profile Management
│   ├── Create/Edit/Delete profiles
│   ├── Quick switching
│   └── Per-project profiles
│
├── Session Management
│   ├── Track active sessions
│   ├── Session history
│   └── Session cleanup
│
├── Workflow Engine
│   ├── Multi-step workflows
│   ├── Conditional execution
│   └── Error handling
│
├── Task Queue
│   ├── Task scheduling
│   ├── Concurrent execution
│   └── Task status tracking
│
├── Templates
│   ├── Project scaffolding
│   ├── Built-in templates
│   └── Custom templates
│
├── Hooks System
│   ├── Event triggers
│   ├── Custom scripts
│   └── Automation
│
├── Analytics
│   ├── Usage statistics
│   ├── Performance metrics
│   └── Session tracking
│
└── Batch Operations
    ├── Cross-profile commands
    └── Bulk operations
```

## Use Cases

### 1. Multi-Environment Development

```bash
# Development profile
cm  # Select "Development"
# ... work on features ...

# Testing profile with different MCP servers
cm  # Select "Testing"
# ... run tests ...

# Production profile
cm  # Select "Production"
# ... deploy ...
```

### 2. Team Collaboration

```bash
# Share profile configurations
cp ~/.claude/profiles/team-standard.json team-repo/
# Team members import
cp team-repo/team-standard.json ~/.claude/profiles/
```

### 3. Automated Workflows

```bash
# Create workflow for CI/CD
cm workflow create

# Execute before deployment
cm workflow run deploy-workflow
```

### 4. Project Templates

```bash
# Start new projects quickly
cm template create web-app my-saas-app
cd my-saas-app
cm  # Auto-selects project profile
```

### 5. Task Automation

```bash
# Queue multiple tasks
cm task add "npm run lint"
cm task add "npm test"
cm task add "npm run build"
cm task add "git push"

# Process queue
cm task queue 2  # Run 2 at a time
```

## Tips & Tricks

```bash
# Quick launch aliases
alias c="cm --skip-update"
alias cy="cm --skip-update --yolo"
alias cl="cm -l --skip-update"

# Edit profile by number
cm edit 1

# Check what's installed
cm status

# View orchestration stats
cm stats

# Clean old sessions weekly
cm session clean 7

# Batch test all profiles
cm batch "echo 'Profile ready'"

# Update cm via npm
npm update -g claude-manager
```

## Advanced Features

### Creating Custom Templates

Create a template in `~/.claude/orchestrator/templates/my-template.json`:

```json
{
  "name": "my-template",
  "description": "My custom project template",
  "files": {
    ".claude-profile": "default",
    "README.md": "# {{projectName}}\n\nMy awesome project",
    "package.json": "{\"name\": \"{{projectName}}\", \"version\": \"1.0.0\"}"
  },
  "profile": "default",
  "mcpServers": ["github", "web-search"],
  "skills": ["code-review"]
}
```

### Creating Custom Workflows

Create a workflow in `~/.claude/orchestrator/workflows/my-workflow.json`:

```json
{
  "name": "my-workflow",
  "steps": [
    {
      "command": "git pull",
      "continueOnError": false
    },
    {
      "command": "npm install",
      "continueOnError": false
    },
    {
      "command": "npm test",
      "continueOnError": false,
      "timeout": 300000
    },
    {
      "command": "npm run build",
      "condition": "{{step2_result.exitCode}} === 0"
    }
  ],
  "metadata": {
    "description": "Pull, install, test, and build",
    "author": "me"
  }
}
```

### Using Hooks

Create a pre-session hook:

```bash
#!/bin/bash
# ~/.claude/orchestrator/hooks/pre-session.sh

# Check git status
if [ -d .git ]; then
  echo "📊 Git status:"
  git status -s
fi

# Check for updates
if [ -f package.json ]; then
  echo "📦 Checking for npm updates..."
  npm outdated
fi

# Set environment
export PROJECT_NAME=$(basename "$PWD")
echo "🚀 Starting Claude for: $PROJECT_NAME"
```

Register the hook:
```bash
cm hook add pre-session ~/.claude/orchestrator/hooks/pre-session.sh
```

## Troubleshooting

### Debug Mode

Enable debug logging:
```bash
export CM_DEBUG=1
cm
```

### Reset Configuration

```bash
# Backup first
cp -r ~/.claude ~/.claude.backup

# Remove and recreate
rm -rf ~/.claude
cm new  # Recreate profiles
```

### Common Issues

**Issue**: "No profiles found"
- **Solution**: Run `cm new` to create your first profile

**Issue**: Sessions not tracking
- **Solution**: Ensure you launch Claude through `cm`, not directly

**Issue**: Workflows failing
- **Solution**: Check workflow syntax and command paths

## How It Works

1. **Profile Selection**: Choose a profile from the interactive menu
2. **Settings Applied**: Profile config is written to `~/.claude/settings.json`
3. **MCP Servers**: Profile's MCP servers are written to `~/.claude.json`
4. **Session Tracking**: Session metadata is recorded
5. **Hooks Executed**: Pre-session hooks run if configured
6. **Claude Launched**: Claude Code starts with your selected configuration
7. **Post-Session**: Session completed, analytics updated

## Contributing

Pull requests welcome! Please ensure:
- No API keys or sensitive data in commits
- Tests pass for new features
- Documentation is updated

## Roadmap

- [ ] Interactive workflow builder UI
- [ ] Cloud profile sync
- [ ] Team collaboration features
- [ ] Cost tracking per session
- [ ] Integration with CI/CD pipelines
- [ ] Plugin marketplace
- [ ] Web dashboard
- [ ] Remote session management

## License

MIT

## Support

- **Issues**: https://github.com/faisalnazir/claude-manager/issues
- **Discussions**: https://github.com/faisalnazir/claude-manager/discussions
- **Docs**: https://github.com/faisalnazir/claude-manager#readme

---

Built with ❤️ for the Claude developer community
