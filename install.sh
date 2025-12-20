#!/bin/bash
set -e

echo "Installing Claude Manager (cm)..."
echo ""

# Detect OS
OS="$(uname -s)"
case "$OS" in
  Linux*)  OS_TYPE="linux";;
  Darwin*) OS_TYPE="mac";;
  *)       echo "❌ Unsupported OS: $OS"; exit 1;;
esac

# Check dependencies
check_dep() {
  if ! command -v "$1" &> /dev/null; then
    echo "❌ $1 is required but not installed."
    if [ "$OS_TYPE" = "mac" ]; then
      echo "   Install with: brew install $1"
    else
      echo "   Install with: sudo apt install $1  (or your package manager)"
    fi
    exit 1
  fi
}

check_dep "curl"
check_dep "git"

# Check for bun, install if missing
if ! command -v bun &> /dev/null; then
  echo "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  # Source for current session
  if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc" 2>/dev/null || true
  fi
fi

# Verify bun is available
if ! command -v bun &> /dev/null; then
  export PATH="$HOME/.bun/bin:$PATH"
fi

# Check for claude
if ! command -v claude &> /dev/null; then
  echo "⚠️  Claude Code not found. Install with:"
  if [ "$OS_TYPE" = "mac" ]; then
    echo "   brew install claude-code"
  else
    echo "   npm install -g @anthropic-ai/claude-code"
  fi
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
BIN_DIR="/usr/local/bin"
if [ ! -d "$BIN_DIR" ]; then
  sudo mkdir -p "$BIN_DIR"
fi

if [ -w "$BIN_DIR" ]; then
  cat > "$BIN_DIR/cm" << 'EOF'
#!/bin/bash
export PATH="$HOME/.bun/bin:$PATH"
bun ~/.cm/cli.js "$@"
EOF
  chmod +x "$BIN_DIR/cm"
else
  sudo tee "$BIN_DIR/cm" > /dev/null << 'EOF'
#!/bin/bash
export PATH="$HOME/.bun/bin:$PATH"
bun ~/.cm/cli.js "$@"
EOF
  sudo chmod +x "$BIN_DIR/cm"
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
