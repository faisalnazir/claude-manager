#!/bin/bash
set -e

echo "Installing Claude Manager (cm)..."
echo ""

# Check dependencies
check_dep() {
  if ! command -v "$1" &> /dev/null; then
    echo "❌ $1 is required but not installed."
    echo "   $2"
    exit 1
  fi
}

check_dep "curl" "Install with: brew install curl"
check_dep "git" "Install with: brew install git"

# Check for bun, install if missing
if ! command -v bun &> /dev/null; then
  echo "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# Check for claude
if ! command -v claude &> /dev/null; then
  echo "⚠️  Claude Code not found. Install with:"
  echo "   brew install claude-code"
  echo "   or: npm install -g @anthropic-ai/claude-code"
  echo ""
fi

# Install to ~/.cm
CM_DIR="$HOME/.cm"
rm -rf "$CM_DIR"
mkdir -p "$CM_DIR"

echo "Downloading cm..."
curl -fsSL https://raw.githubusercontent.com/faisalnazir/claude-manager/main/src/cli.js -o "$CM_DIR/cli.js"
curl -fsSL https://raw.githubusercontent.com/faisalnazir/claude-manager/main/src/config.js -o "$CM_DIR/config.js"
curl -fsSL https://raw.githubusercontent.com/faisalnazir/claude-manager/main/package.json -o "$CM_DIR/package.json"

echo "Installing dependencies..."
cd "$CM_DIR" && bun install --silent

# Create wrapper script
if [ -w /usr/local/bin ]; then
  cat > /usr/local/bin/cm << 'EOF'
#!/bin/bash
bun ~/.cm/cli.js "$@"
EOF
  chmod +x /usr/local/bin/cm
else
  sudo tee /usr/local/bin/cm > /dev/null << 'EOF'
#!/bin/bash
bun ~/.cm/cli.js "$@"
EOF
  sudo chmod +x /usr/local/bin/cm
fi

# Create profiles directory
mkdir -p ~/.claude/profiles

echo ""
echo "✅ cm installed successfully!"
echo ""
echo "Usage:"
echo "  cm              # Select profile and launch Claude"
echo "  cm new          # Create a new profile"
echo "  cm --help       # Show all commands"
echo ""
