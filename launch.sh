#!/bin/bash
# Claude launcher with settings selection

cd "$(dirname "$0")"

# Run the settings selector and capture output
OUTPUT=$(bun src/cli.js 2>&1)
MODEL=$(echo "$OUTPUT" | grep "ANTHROPIC_MODEL=" | sed 's/.*ANTHROPIC_MODEL=//' | sed 's/ .*//')

if [ -n "$MODEL" ]; then
  echo "Launching claude with model: $MODEL"
  ANTHROPIC_MODEL="$MODEL" claude "$@"
fi
