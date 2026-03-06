#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "[LyserisAI] Starting frontend build..."

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed or not in PATH" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or not in PATH" >&2
  exit 1
fi

echo "[LyserisAI] Node: $(node -v)"
echo "[LyserisAI] NPM:  $(npm -v)"

# Install dependencies reproducibly when lockfile exists.
if [[ -f package-lock.json ]]; then
  echo "[LyserisAI] Installing dependencies with npm ci..."
  npm ci
else
  echo "[LyserisAI] package-lock.json not found, using npm install..."
  npm install
fi

# Clean previous build output for a fresh artifact.
if [[ -d dist ]]; then
  echo "[LyserisAI] Cleaning old dist/..."
  rm -rf dist
fi

# Prefer production build script if available.
if npm run | grep -q "build:prod"; then
  echo "[LyserisAI] Running npm run build:prod"
  npm run build:prod
else
  echo "[LyserisAI] build:prod not found, running npm run build"
  npm run build
fi

if [[ -d dist ]]; then
  echo "[LyserisAI] Build completed successfully. Output: $ROOT_DIR/dist"
else
  echo "[LyserisAI] Build command finished, but dist/ was not created." >&2
  exit 1
fi
