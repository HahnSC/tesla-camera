#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

unset CARGO_TARGET_DIR
export PATH="/opt/homebrew/bin:/usr/local/bin:${HOME}/.cargo/bin:/opt/homebrew/opt/rustup/bin:${PATH}"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required"
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required"
  exit 1
fi

case "$(uname -m)" in
  arm64) SIDECAR="src-tauri/binaries/ffmpeg-aarch64-apple-darwin" ;;
  x86_64) SIDECAR="src-tauri/binaries/ffmpeg-x86_64-apple-darwin" ;;
  *) SIDECAR="" ;;
esac

if [[ -n "$SIDECAR" && ! -x "$SIDECAR" ]]; then
  mkdir -p src-tauri/binaries
  curl -L --fail --retry 3 -o src-tauri/binaries/ffmpeg.zip \
    https://github.com/Mario34/tesla-camera/releases/download/v1.0.0-pre/ffmpeg.zip
  unzip -o src-tauri/binaries/ffmpeg.zip -d src-tauri/binaries
  cp -f src-tauri/binaries/ffmpeg src-tauri/binaries/ffmpeg-aarch64-apple-darwin
  cp -f src-tauri/binaries/ffmpeg src-tauri/binaries/ffmpeg-x86_64-apple-darwin
  cp -f src-tauri/binaries/ffmpeg.exe src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe
  chmod +x src-tauri/binaries/ffmpeg src-tauri/binaries/ffmpeg-aarch64-apple-darwin src-tauri/binaries/ffmpeg-x86_64-apple-darwin
fi

pnpm install
pnpm app:build

APP="$ROOT/src-tauri/target/release/bundle/macos/TeslaCamera.app"
if [[ "$(uname)" != "Darwin" ]]; then
  echo "Build finished"
  exit 0
fi
if [[ ! -d "$APP" ]]; then
  echo "App not found: $APP"
  exit 1
fi
open "$APP"
