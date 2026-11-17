#!/bin/bash
# Started by Sud.bat through Git Bash: run the app from the project folder, whatever folder this is called from.
cd "$(dirname "$0")/.." || exit 1
exec bun run dev
