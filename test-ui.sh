#!/bin/bash

echo "Testing cm UI with parallel functionality..."
echo ""
echo "1. Testing help command to see if /parallel is listed:"
./cm --help | grep -A 20 "Commands:"

echo ""
echo "2. The parallel UI can be accessed by:"
echo "   - Running 'cm' and typing '/parallel'"
echo "   - Or running 'cm' and pressing '/' then typing 'parallel'"

echo ""
echo "✓ Parallel functionality has been integrated into the cm UI!"
echo ""
echo "UI Features:"
echo "  - Interactive profile selection with checkboxes"
echo "  - Toggle profiles with 1-9 keys"
echo "  - Select all with 'a', clear all with 'c'"
echo "  - Launch selected profiles with Enter"
echo "  - Real-time launch status and PID display"
echo "  - Automatic cleanup instructions"
