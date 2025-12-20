#!/bin/bash
set -e

echo "Installing Claude Manager (cm)..."

# Check for bun
if ! command -v bun &> /dev/null; then
  echo "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
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
sudo tee /usr/local/bin/cm > /dev/null << 'EOF'
#!/bin/bash
bun ~/.cm/cli.js "$@"
EOF
sudo chmod +x /usr/local/bin/cm

# Create profiles directory
mkdir -p ~/.claude/profiles

echo ""
echo "✓ cm installed successfully!"
echo ""
echo "Usage:"
echo "  cm              # Select profile and launch Claude"
echo "  cm --help       # Show all commands"
echo "  cm new          # Create a new profile"
echo ""
