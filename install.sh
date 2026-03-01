#!/usr/bin/env bash
#
# fleex installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/oliviermadre/agent-session-manager/main/install.sh | bash
#
# What it does:
#   1. Checks prerequisites (git, bun)
#   2. Clones the repo into ~/.fleex/repo
#   3. Installs dependencies (bun install)
#   4. Copies the fleex CLI to ~/.fleex/bin/
#   5. Adds ~/.fleex/bin to PATH (if needed)
#
set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────────
FLEEX_HOME="${FLEEX_HOME:-$HOME/.fleex}"
REPO_URL="git@github.com:oliviermadre/agent-session-manager.git"
REPO_DIR="$FLEEX_HOME/repo"
BIN_DIR="$FLEEX_HOME/bin"
CLI_NAME="fleex"

# ── Colors ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { printf "${BLUE}[installer]${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}[installer]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[installer]${NC} %s\n" "$*"; }
err()   { printf "${RED}[installer]${NC} %s\n" "$*" >&2; }
die()   { err "$@"; exit 1; }

# ── Banner ─────────────────────────────────────────────────────────────────────
banner() {
  echo ""
  printf "${BOLD}${CYAN}"
  cat <<'BANNER'
    __ _
   / _| | ___  _____  __
  | |_| |/ _ \/ _ \ \/ /
  |  _| |  __/  __/>  <
  |_| |_|\___|\___/_/\_\

BANNER
  printf "${NC}"
  printf "  ${DIM}Local dev-stack manager${NC}\n"
  echo ""
}

# ── Prerequisite checks ───────────────────────────────────────────────────────
check_prerequisites() {
  info "Checking prerequisites..."

  # git
  if ! command -v git >/dev/null 2>&1; then
    die "git is required but not installed. Please install git first."
  fi
  ok "git $(git --version | awk '{print $3}')"

  # bun
  if ! command -v bun >/dev/null 2>&1; then
    warn "bun is not installed."
    info "Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    # Source the bun env for this session
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    if ! command -v bun >/dev/null 2>&1; then
      die "Failed to install bun. Please install it manually: https://bun.sh"
    fi
    ok "bun installed: $(bun --version)"
  else
    ok "bun $(bun --version)"
  fi

  # Node.js (optional — server runs on bun, but useful for other tooling)
  if command -v node >/dev/null 2>&1; then
    ok "node $(node --version) (optional)"
  fi
}

# ── Clone or update ───────────────────────────────────────────────────────────
clone_or_update() {
  if [[ -e "$REPO_DIR/.git" ]]; then
    info "Repo already exists, pulling latest changes..."
    (cd "$REPO_DIR" && git pull --rebase origin main 2>/dev/null || git pull origin main)
    ok "Repo updated."
  else
    info "Cloning repository into $REPO_DIR..."
    mkdir -p "$FLEEX_HOME"
    git clone "$REPO_URL" "$REPO_DIR"
    ok "Repository cloned."
  fi
}

# ── Install dependencies ──────────────────────────────────────────────────────
install_deps() {
  info "Installing dependencies..."
  (cd "$REPO_DIR" && bun install)
  ok "Dependencies installed."
}

# ── Install CLI ───────────────────────────────────────────────────────────────
install_cli() {
  info "Installing fleex CLI..."

  mkdir -p "$BIN_DIR"
  chmod +x "$REPO_DIR/cli/$CLI_NAME"
  ln -sf "$REPO_DIR/cli/$CLI_NAME" "$BIN_DIR/$CLI_NAME"

  ok "CLI symlinked to $BIN_DIR/$CLI_NAME → $REPO_DIR/cli/$CLI_NAME"
}

# ── PATH setup ────────────────────────────────────────────────────────────────
setup_path() {
  # Check if already in PATH
  if echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
    return
  fi

  local shell_name
  shell_name="$(basename "${SHELL:-/bin/bash}")"

  local rc_file
  case "$shell_name" in
    zsh)  rc_file="$HOME/.zshrc" ;;
    bash)
      if [[ -f "$HOME/.bash_profile" ]]; then
        rc_file="$HOME/.bash_profile"
      else
        rc_file="$HOME/.bashrc"
      fi
      ;;
    fish) rc_file="$HOME/.config/fish/config.fish" ;;
    *)    rc_file="$HOME/.profile" ;;
  esac

  local path_line
  if [[ "$shell_name" == "fish" ]]; then
    path_line="set -gx PATH \$HOME/.fleex/bin \$PATH"
  else
    path_line='export PATH="$HOME/.fleex/bin:$PATH"'
  fi

  # Only add if not already present
  if [[ -f "$rc_file" ]] && grep -qF '.fleex/bin' "$rc_file" 2>/dev/null; then
    return
  fi

  echo "" >> "$rc_file"
  echo "# fleex CLI" >> "$rc_file"
  echo "$path_line" >> "$rc_file"

  info "Added $BIN_DIR to PATH in $rc_file"
}

# ── Create .env template ──────────────────────────────────────────────────────
create_env_template() {
  local env_file="$REPO_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    cat > "$env_file" <<'ENV'
# fleex — local environment configuration
# Uncomment and set values as needed.

# Storage driver: json (default), sqlite, pgsql, supabase
# ASM_STORAGE_DRIVER=json

# PostgreSQL (if using pgsql driver)
# ASM_PGSQL_URL=postgresql://user:pass@localhost:5432/asm

# Supabase (if using supabase driver)
# ASM_SUPABASE_URL=https://xxx.supabase.co
# ASM_SUPABASE_KEY=your-anon-key

# OAuth (optional — app works without auth in local mode)
# GITHUB_CLIENT_ID=
# GITHUB_CLIENT_SECRET=
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=

# Gateway
# GATEWAY_PORT=3001
# GATEWAY_NAME=my-machine
ENV
    info "Created .env template at $env_file"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  banner
  check_prerequisites
  echo ""
  clone_or_update
  echo ""
  install_deps
  echo ""
  install_cli
  setup_path
  echo ""
  create_env_template
  echo ""

  printf "${GREEN}${BOLD}"
  cat <<'DONE'
  ╔══════════════════════════════════════════╗
  ║         fleex installed!                 ║
  ╚══════════════════════════════════════════╝
DONE
  printf "${NC}"
  echo ""
  info "Reload your shell or run:"
  printf "  ${BOLD}source ~/.zshrc${NC}  ${DIM}(or ~/.bashrc)${NC}\n"
  echo ""
  info "Then start the stack:"
  printf "  ${BOLD}fleex start${NC}\n"
  echo ""
  info "Other commands:"
  printf "  ${DIM}fleex status       ${NC}Check running services\n"
  printf "  ${DIM}fleex stop         ${NC}Stop the stack\n"
  printf "  ${DIM}fleex restart      ${NC}Restart everything\n"
  printf "  ${DIM}fleex self-update  ${NC}Update to latest version\n"
  printf "  ${DIM}fleex help         ${NC}Show all commands\n"
  echo ""
}

main "$@"
