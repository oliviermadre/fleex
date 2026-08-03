#!/usr/bin/env bash
#
# fleex interactive installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/oliviermadre/fleex/main/install.sh | bash
#   bash install.sh
#
# What it does:
#   1. Checks prerequisites (git, bun, tmux, claude, gh) — offers auto-install
#   2. Clones/updates the repo into ~/.fleex/repo
#   3. First-time setup wizard (display name, worktree path, storage driver)
#   4. Seeds default personas and board
#   5. Repository registration
#
set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────────
FLEEX_HOME="${FLEEX_HOME:-$HOME/.fleex}"
REPO_URL="git@github.com:oliviermadre/fleex.git"
REPO_DIR="$FLEEX_HOME/repo"
BIN_DIR="$FLEEX_HOME/bin"
CLI_NAME="fleex"
ENV_FILE="$REPO_DIR/.env"
WORKSPACES_FILE="$FLEEX_HOME/workspaces.json"
DB_FILE="$FLEEX_HOME/fleex.db"
MARKETPLACES_FILE="$FLEEX_HOME/marketplaces.json"
MARKETPLACE_URL="git@github.com:oliviermadre/fleex-marketplace.git"
MARKETPLACE_NAME="default"   # local name registered via `marketplace add --name`
MARKETPLACE_REGISTERED=false
IS_FRESH_INSTALL=false
SPINNER_PID=""

# ── Colors ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── OS Detection ───────────────────────────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
  Darwin) OS_TYPE="macos" ;;
  Linux)  OS_TYPE="linux" ;;
  *)      OS_TYPE="unknown" ;;
esac

# ── TTY Detection (for curl | bash) ───────────────────────────────────────────
CAN_PROMPT=false
if [ -e /dev/tty ]; then
  CAN_PROMPT=true
fi

# ── Basic Logging ──────────────────────────────────────────────────────────────
info()  { printf "${BLUE}[fleex]${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}  ✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}  ⚠${NC} %s\n" "$*"; }
err()   { printf "${RED}  ✗${NC} %s\n" "$*" >&2; }
die()   { err "$@"; exit 1; }

# ── UI Primitives ──────────────────────────────────────────────────────────────

ui_section() {
  local title="$1"
  echo ""
  printf "${BOLD}${CYAN}── %s ──────────────────────────────────────────────────${NC}\n" "$title"
  echo ""
}

ui_step() {
  local current="$1"
  local total="$2"
  local msg="$3"
  printf "${BOLD}${MAGENTA}[%d/%d]${NC} ${BOLD}%s${NC}\n" "$current" "$total" "$msg"
}

ui_spinner_start() {
  local msg="$1"
  local spin_chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  (
    i=0
    while true; do
      i=$(( (i + 1) % ${#spin_chars} ))
      # bash 3.x compatible substring
      local c
      c="$(printf '%s' "$spin_chars" | cut -c$((i+1))-$((i+1)))"
      printf "\r${CYAN}  %s${NC} %s" "$c" "$msg" >&2
      sleep 0.1
    done
  ) &
  SPINNER_PID=$!
}

ui_spinner_stop() {
  if [ -n "$SPINNER_PID" ] && kill -0 "$SPINNER_PID" 2>/dev/null; then
    kill "$SPINNER_PID" 2>/dev/null
    wait "$SPINNER_PID" 2>/dev/null || true
    SPINNER_PID=""
    printf "\r\033[K" >&2
  fi
}

ui_prompt_yn() {
  local question="$1"
  local default="${2:-y}"

  if [ "$CAN_PROMPT" = false ]; then
    echo "$default"
    return
  fi

  local hint
  if [ "$default" = "y" ]; then
    hint="Y/n"
  else
    hint="y/N"
  fi

  local answer
  printf "${BOLD}  ? ${NC}%s ${DIM}[%s]${NC} " "$question" "$hint" >&2
  read -r answer < /dev/tty || answer=""

  if [ -z "$answer" ]; then
    echo "$default"
    return
  fi

  # bash 3.x compatible lowercase
  answer="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
  case "$answer" in
    y|yes) echo "y" ;;
    n|no)  echo "n" ;;
    *)     echo "$default" ;;
  esac
}

ui_prompt_text() {
  local question="$1"
  local default="${2:-}"
  local hint="${3:-}"

  if [ "$CAN_PROMPT" = false ]; then
    echo "$default"
    return
  fi

  if [ -n "$default" ]; then
    if [ -n "$hint" ]; then
      printf "${BOLD}  ? ${NC}%s ${DIM}(%s) [%s]${NC} " "$question" "$hint" "$default" >&2
    else
      printf "${BOLD}  ? ${NC}%s ${DIM}[%s]${NC} " "$question" "$default" >&2
    fi
  else
    if [ -n "$hint" ]; then
      printf "${BOLD}  ? ${NC}%s ${DIM}(%s)${NC} " "$question" "$hint" >&2
    else
      printf "${BOLD}  ? ${NC}%s " "$question" >&2
    fi
  fi

  local answer
  read -r answer < /dev/tty || answer=""

  if [ -z "$answer" ]; then
    echo "$default"
  else
    echo "$answer"
  fi
}

ui_prompt_choice() {
  local question="$1"
  local options="$2"   # pipe-separated: "option1|option2|option3"
  local default="$3"   # 1-based index

  if [ "$CAN_PROMPT" = false ]; then
    echo "$default"
    return
  fi

  printf "${BOLD}  ? ${NC}%s\n" "$question" >&2

  local i=1
  local IFS_OLD="$IFS"
  IFS='|'
  for opt in $options; do
    if [ "$i" -eq "$default" ]; then
      printf "    ${CYAN}${BOLD}%d)${NC} %s ${DIM}(default)${NC}\n" "$i" "$opt" >&2
    else
      printf "    ${DIM}%d)${NC} %s\n" "$i" "$opt" >&2
    fi
    i=$((i + 1))
  done
  IFS="$IFS_OLD"

  printf "  ${DIM}Enter choice:${NC} " >&2
  local answer
  read -r answer < /dev/tty || answer=""

  if [ -z "$answer" ]; then
    echo "$default"
  elif echo "$answer" | grep -qE '^[0-9]+$'; then
    local max=$((i - 1))
    if [ "$answer" -ge 1 ] && [ "$answer" -le "$max" ]; then
      echo "$answer"
    else
      echo "$default"
    fi
  else
    echo "$default"
  fi
}

generate_uuid() {
  # UUID v4 via /dev/urandom — portable across macOS and Linux
  local hex
  hex="$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
  printf '%s-%s-4%s-%s-%s\n' \
    "${hex:0:8}" "${hex:8:4}" "${hex:13:3}" "${hex:16:4}" "${hex:20:12}"
}

# ── Cleanup ────────────────────────────────────────────────────────────────────
cleanup() {
  ui_spinner_stop
}
trap cleanup EXIT

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
  printf "  ${DIM}Interactive installer${NC}\n"
  echo ""
}

# ── Phase 1: Prerequisites Check ──────────────────────────────────────────────

check_tool() {
  local tool="$1"
  local required="$2"
  local purpose="$3"
  local install_hint="$4"

  if command -v "$tool" >/dev/null 2>&1; then
    local version=""
    case "$tool" in
      git)     version="$(git --version 2>/dev/null | awk '{print $3}')" ;;
      bun)     version="$(bun --version 2>/dev/null)" ;;
      tmux)    version="$(tmux -V 2>/dev/null | awk '{print $2}')" ;;
      claude)  version="installed" ;;
      gh)      version="$(gh --version 2>/dev/null | head -1 | awk '{print $3}')" ;;
      python3) version="$(python3 --version 2>/dev/null | awk '{print $2}')" ;;
    esac
    ok "$tool $version — $purpose"
    return 0
  fi

  if [ "$required" = "required" ]; then
    warn "$tool is not installed — $purpose"
  else
    printf "${DIM}  ○${NC} %s not found (optional) — %s\n" "$tool" "$purpose"
  fi
  return 1
}

# Verify that gh is authenticated. Warning-only, never blocks.
check_gh_auth() {
  if gh auth status >/dev/null 2>&1; then
    return 0
  fi
  warn "gh is installed but not authenticated"
  warn "Run: gh auth login"
  return 1
}

# Verify that claude is authenticated. Warning-only, never blocks.
# `claude auth status` defaults to JSON output with a `loggedIn` field.
check_claude_auth() {
  if claude auth status 2>/dev/null | grep -q '"loggedIn"[[:space:]]*:[[:space:]]*true'; then
    return 0
  fi
  warn "claude is installed but not authenticated"
  warn "Run: claude auth login"
  return 1
}

# Bash 3.x-compatible semver comparison: returns 0 if $1 >= $2
version_gte() {
  local IFS=.
  local i a=($1) b=($2)
  for ((i=0; i<${#b[@]}; i++)); do
    local va="${a[i]:-0}" vb="${b[i]:-0}"
    if (( va > vb )); then return 0; fi
    if (( va < vb )); then return 1; fi
  done
  return 0
}

MIN_BUN_VERSION="1.3.5"

install_bun() {
  info "Installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  if ! command -v bun >/dev/null 2>&1; then
    die "Failed to install bun. Please install manually: https://bun.sh"
  fi
  ok "bun $(bun --version) installed"
}

upgrade_bun() {
  info "Upgrading bun..."
  bun upgrade
  if ! command -v bun >/dev/null 2>&1; then
    die "Failed to upgrade bun. Please upgrade manually: bun upgrade"
  fi
  ok "bun upgraded to $(bun --version)"
}

install_tmux() {
  case "$OS_TYPE" in
    macos)
      if command -v brew >/dev/null 2>&1; then
        info "Installing tmux via Homebrew..."
        brew install tmux
      else
        die "tmux requires Homebrew on macOS. Install Homebrew first: https://brew.sh"
      fi
      ;;
    linux)
      if command -v apt-get >/dev/null 2>&1; then
        info "Installing tmux via apt..."
        sudo apt-get update -qq && sudo apt-get install -y tmux
      elif command -v dnf >/dev/null 2>&1; then
        info "Installing tmux via dnf..."
        sudo dnf install -y tmux
      else
        die "Cannot auto-install tmux. Please install it manually."
      fi
      ;;
    *)
      die "Cannot auto-install tmux on this OS. Please install it manually."
      ;;
  esac
  ok "tmux $(tmux -V 2>/dev/null | awk '{print $2}') installed"
}

install_claude() {
  if command -v bun >/dev/null 2>&1; then
    info "Installing claude via bun..."
    bun install -g @anthropic-ai/claude-code
  elif command -v npm >/dev/null 2>&1; then
    info "Installing claude via npm..."
    npm install -g @anthropic-ai/claude-code
  else
    die "Cannot install claude: neither bun nor npm found."
  fi
  if ! command -v claude >/dev/null 2>&1; then
    die "Failed to install claude CLI. Please install manually: npm install -g @anthropic-ai/claude-code"
  fi
  ok "claude CLI installed"
}

install_gh() {
  case "$OS_TYPE" in
    macos)
      if command -v brew >/dev/null 2>&1; then
        info "Installing gh via Homebrew..."
        brew install gh
      else
        die "gh requires Homebrew on macOS. Install Homebrew first: https://brew.sh"
      fi
      ;;
    linux)
      if command -v apt-get >/dev/null 2>&1; then
        info "Installing gh via apt..."
        (type -p wget >/dev/null || (sudo apt update && sudo apt-get install wget -y)) \
          && sudo mkdir -p -m 755 /etc/apt/keyrings \
          && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
          && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
          && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
          && sudo apt update \
          && sudo apt install gh -y
      elif command -v dnf >/dev/null 2>&1; then
        info "Installing gh via dnf..."
        sudo dnf install -y gh
      else
        die "Cannot auto-install gh. Please install manually: https://github.com/cli/cli#installation"
      fi
      ;;
    *)
      die "Cannot auto-install gh on this OS. Please install manually: https://github.com/cli/cli#installation"
      ;;
  esac
  ok "gh $(gh --version 2>/dev/null | head -1 | awk '{print $3}') installed"
}

install_python3() {
  case "$OS_TYPE" in
    macos)
      if command -v brew >/dev/null 2>&1; then
        info "Installing python3 via Homebrew..."
        brew install python3
      else
        die "python3 requires Homebrew on macOS. Install Homebrew first: https://brew.sh"
      fi
      ;;
    linux)
      if command -v apt-get >/dev/null 2>&1; then
        info "Installing python3 via apt..."
        sudo apt-get update -qq && sudo apt-get install -y python3
      elif command -v dnf >/dev/null 2>&1; then
        info "Installing python3 via dnf..."
        sudo dnf install -y python3
      else
        die "Cannot auto-install python3. Please install it manually."
      fi
      ;;
    *)
      die "Cannot auto-install python3 on this OS."
      ;;
  esac
  ok "python3 $(python3 --version 2>/dev/null | awk '{print $2}') installed"
}

phase_prerequisites() {
  ui_section "Prerequisites"

  local all_ok=true

  # git — manual install only
  if ! check_tool "git" "required" "VCS operations" ""; then
    all_ok=false
    case "$OS_TYPE" in
      macos) err "Please install Xcode Command Line Tools: xcode-select --install" ;;
      linux) err "Please install git: sudo apt install git (or your package manager)" ;;
      *)     err "Please install git manually." ;;
    esac
    die "git is required to continue."
  fi

  # bun
  if ! check_tool "bun" "required" "JS runtime & package manager" ""; then
    local answer
    answer="$(ui_prompt_yn "Install bun automatically?" "y")"
    if [ "$answer" = "y" ]; then
      install_bun
    else
      die "bun is required to continue. Install: https://bun.sh"
    fi
  fi

  # bun version check (>= 1.3.5 required for Bun.spawn terminal support)
  local bun_ver
  bun_ver="$(bun --version 2>/dev/null)"
  if ! version_gte "$bun_ver" "$MIN_BUN_VERSION"; then
    warn "bun $bun_ver is too old — fleex requires bun >= $MIN_BUN_VERSION"
    local answer
    answer="$(ui_prompt_yn "Upgrade bun automatically?" "y")"
    if [ "$answer" = "y" ]; then
      upgrade_bun
    else
      die "bun >= $MIN_BUN_VERSION is required (for Bun.spawn terminal support). Upgrade: bun upgrade"
    fi
  fi

  # tmux
  if ! check_tool "tmux" "required" "Terminal multiplexer for agent sessions" ""; then
    local answer
    answer="$(ui_prompt_yn "Install tmux automatically?" "y")"
    if [ "$answer" = "y" ]; then
      install_tmux
    else
      die "tmux is required to continue."
    fi
  fi

  # claude
  if ! check_tool "claude" "required" "Anthropic CLI for AI agents" ""; then
    local answer
    answer="$(ui_prompt_yn "Install claude CLI automatically?" "y")"
    if [ "$answer" = "y" ]; then
      install_claude
    else
      die "claude CLI is required to continue. Install: npm install -g @anthropic-ai/claude-code"
    fi
  fi
  # Auth check — warning only, never blocks install
  check_claude_auth || true

  # gh
  if ! check_tool "gh" "required" "GitHub CLI for repository operations" ""; then
    local answer
    answer="$(ui_prompt_yn "Install gh CLI automatically?" "y")"
    if [ "$answer" = "y" ]; then
      install_gh
    else
      die "gh CLI is required to continue. Install: https://github.com/cli/cli#installation"
    fi
  fi
  # Auth check — warning only, never blocks install
  check_gh_auth || true

  # python3 (optional)
  if ! check_tool "python3" "optional" "Dynamic port allocation (has fallback)" ""; then
    local answer
    answer="$(ui_prompt_yn "Install python3? (optional, has fallback)" "n")"
    if [ "$answer" = "y" ]; then
      install_python3
    fi
  fi

  echo ""
  ok "All required dependencies satisfied"
}

# ── Phase 2: Install / Update ─────────────────────────────────────────────────

phase_install() {
  ui_section "Installation"

  if git -C "$REPO_DIR" rev-parse --git-dir &>/dev/null 2>&1; then
    # Update mode
    IS_FRESH_INSTALL=false
    ui_step 1 4 "Pulling latest changes..."
    (cd "$REPO_DIR" && git pull --rebase origin main 2>/dev/null || git pull origin main)
    ok "Repository updated"

    ui_step 2 4 "Installing dependencies..."
    ui_spinner_start "Running bun install..."
    (cd "$REPO_DIR" && bun install --silent 2>/dev/null || bun install) >/dev/null 2>&1
    ui_spinner_stop
    ok "Dependencies installed"

    ui_step 3 4 "Building packages..."
    ui_spinner_start "Building @fleex/shared..."
    (cd "$REPO_DIR/packages/shared" && bun run build) >/dev/null 2>&1
    ui_spinner_stop
    ok "Packages built"

    ui_step 4 4 "Updating CLI symlink..."
    mkdir -p "$BIN_DIR"
    chmod +x "$REPO_DIR/cli/$CLI_NAME"
    ln -sf "$REPO_DIR/cli/$CLI_NAME" "$BIN_DIR/$CLI_NAME"
    ok "CLI updated"

    setup_path
  else
    # Fresh install
    IS_FRESH_INSTALL=true

    ui_step 1 4 "Cloning repository..."
    mkdir -p "$FLEEX_HOME"
    git clone "$REPO_URL" "$REPO_DIR"
    ok "Repository cloned to $REPO_DIR"

    ui_step 2 4 "Installing dependencies..."
    ui_spinner_start "Running bun install..."
    (cd "$REPO_DIR" && bun install --silent 2>/dev/null || bun install) >/dev/null 2>&1
    ui_spinner_stop
    ok "Dependencies installed"

    ui_step 3 4 "Building packages..."
    ui_spinner_start "Building @fleex/shared..."
    (cd "$REPO_DIR/packages/shared" && bun run build) >/dev/null 2>&1
    ui_spinner_stop
    ok "Packages built"

    ui_step 4 4 "Setting up CLI..."
    mkdir -p "$BIN_DIR"
    chmod +x "$REPO_DIR/cli/$CLI_NAME"
    ln -sf "$REPO_DIR/cli/$CLI_NAME" "$BIN_DIR/$CLI_NAME"
    ok "CLI symlinked to $BIN_DIR/$CLI_NAME"

    setup_path
  fi
}

# ── PATH setup ─────────────────────────────────────────────────────────────────
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
      if [ -f "$HOME/.bash_profile" ]; then
        rc_file="$HOME/.bash_profile"
      else
        rc_file="$HOME/.bashrc"
      fi
      ;;
    fish) rc_file="$HOME/.config/fish/config.fish" ;;
    *)    rc_file="$HOME/.profile" ;;
  esac

  local path_line
  if [ "$shell_name" = "fish" ]; then
    path_line="set -gx PATH \$HOME/.fleex/bin \$PATH"
  else
    path_line='export PATH="$HOME/.fleex/bin:$PATH"'
  fi

  # Only add if not already present
  if [ -f "$rc_file" ] && grep -qF '.fleex/bin' "$rc_file" 2>/dev/null; then
    return
  fi

  echo "" >> "$rc_file"
  echo "# fleex CLI" >> "$rc_file"
  echo "$path_line" >> "$rc_file"

  info "Added $BIN_DIR to PATH in $rc_file"
}

# ── Phase 3: First-time Setup Wizard ──────────────────────────────────────────

phase_wizard() {
  ui_section "Setup Wizard"
  info "Let's configure fleex for your environment."
  echo ""

  # 1. Display name
  local git_name=""
  git_name="$(git config --global user.name 2>/dev/null || true)"
  local default_name="${git_name:-$(whoami)}"
  local display_name
  display_name="$(ui_prompt_text "How should I call you?" "$default_name")"

  # 2. Mention name (lowercase first word)
  local default_mention
  default_mention="$(printf '%s' "$display_name" | awk '{print $1}' | tr '[:upper:]' '[:lower:]')"
  local mention_name
  mention_name="$(ui_prompt_text "How should agents mention you?" "$default_mention" "used in @mentions")"

  # 3. Worktree base dir
  local base_path
  base_path="$(ui_prompt_text "Where should repositories and worktrees be stored?" "$HOME/projects" "{basePath}/{org}/{repo}.{worktree}")"

  # 4. Storage driver — sqlite, no choice. (pgsql/supabase stay available via
  # manual configuration but are not offered at install time.)
  local storage_driver="sqlite"

  # 4b. SQLite database file path.
  local sqlite_path
  sqlite_path="$(ui_prompt_text "Where should the SQLite database file be stored?" "$DB_FILE" "one file per workspace; must be unique across workspaces")"

  echo ""
  ok "Configuration:"
  printf "    Display name:   ${BOLD}%s${NC}\n" "$display_name"
  printf "    Mention name:   ${BOLD}@%s${NC}\n" "$mention_name"
  printf "    Base path:      ${BOLD}%s${NC}\n" "$base_path"
  printf "    Storage driver: ${BOLD}%s${NC}\n" "$storage_driver"
  printf "    SQLite path:    ${BOLD}%s${NC}\n" "$sqlite_path"
  echo ""

  # Detect shell
  local default_shell
  default_shell="${SHELL:-/bin/zsh}"

  # Write config to the SQLite DB (app_config table).
  mkdir -p "$FLEEX_HOME"

  # Run migrations to create all tables before writing config
  info "Running database migrations..."
  FLEEX_STORAGE_DRIVER="sqlite" \
  FLEEX_SQLITE_PATH="$DB_FILE" \
  bun --conditions development "$REPO_DIR/packages/server/src/infrastructure/migrations/cli-migrate.ts"
  ok "Migrations applied."

  FLEEX_CFG_BASE_PATH="$base_path" \
  FLEEX_CFG_SHELL="$default_shell" \
  FLEEX_CFG_DISPLAY="$display_name" \
  FLEEX_CFG_MENTION="$mention_name" \
  FLEEX_CFG_DB="$DB_FILE" \
  bun -e '
import { Database } from "bun:sqlite";
const db = new Database(process.env.FLEEX_CFG_DB, { create: true });
db.exec("PRAGMA journal_mode = WAL");
const config = {
  basePath: process.env.FLEEX_CFG_BASE_PATH,
  defaultShell: process.env.FLEEX_CFG_SHELL,
  repositoryRefreshIntervalMs: 0,
  humanDisplayName: process.env.FLEEX_CFG_DISPLAY,
  humanMentionName: process.env.FLEEX_CFG_MENTION,
  repositories: [],
  resolvedRepositories: []
};
const now = new Date().toISOString();
db.prepare("INSERT OR REPLACE INTO app_config (id, data, updated_at) VALUES (?, ?, ?)").run("singleton", JSON.stringify(config), now);
db.close();
  '
  ok "Config written to $DB_FILE (app_config table)"

  # Write workspaces.json — the global config that replaces the per-repo .env.
  # Each workspace owns its own env block (driver, DB, hub, API keys); this is
  # where secrets live, so the file is created with 0600 permissions.
  mkdir -p "$(dirname "$WORKSPACES_FILE")"
  FLEEX_WS_DRIVER="$storage_driver" \
  FLEEX_WS_BASE_PATH="$base_path" \
  FLEEX_WS_SQLITE_PATH="$sqlite_path" \
  FLEEX_WS_OUT="$WORKSPACES_FILE" \
  bun -e '
    const env = { FLEEX_STORAGE_DRIVER: process.env.FLEEX_WS_DRIVER };
    if (process.env.FLEEX_WS_DRIVER === "sqlite" && process.env.FLEEX_WS_SQLITE_PATH) {
      env.FLEEX_SQLITE_PATH = process.env.FLEEX_WS_SQLITE_PATH;
    }
    const workspaces = {
      workspaces: [
        {
          name: "default",
          is_default: true,
          basePath: process.env.FLEEX_WS_BASE_PATH,
          env,
        },
      ],
    };
    await Bun.write(process.env.FLEEX_WS_OUT, JSON.stringify(workspaces, null, 2) + "\n");
  '
  chmod 600 "$WORKSPACES_FILE"
  ok "Workspaces written to $WORKSPACES_FILE (workspace 'default')"

  # Export for later phases
  WIZARD_DISPLAY_NAME="$display_name"
  WIZARD_MENTION_NAME="$mention_name"
  WIZARD_BASE_PATH="$base_path"
  WIZARD_STORAGE_DRIVER="$storage_driver"
}

# ── Phase 4: Seed Default Data ─────────────────────────────────────────────────

phase_seed() {
  ui_section "Default Data"
  info "Creating default personas and board..."
  echo ""

  local now
  now="$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')"

  local id_jarvis id_catalyst id_builder id_board
  id_jarvis="$(generate_uuid)"
  id_catalyst="$(generate_uuid)"
  id_builder="$(generate_uuid)"
  id_board="$(generate_uuid)"

  seed_sqlite "$now" "$id_jarvis" "$id_catalyst" "$id_builder" "$id_board"

  echo ""
  ok "Created personas:"
  printf "    ${CYAN}Jarvis${NC}        — Personal AI assistant\n"
  printf "    ${CYAN}The Catalyst${NC}  — Project manager agent\n"
  printf "    ${CYAN}The Builder${NC}   — Software developer agent\n"
  echo ""
  ok "Created board:"
  printf "    🏠 ${CYAN}Personal${NC}\n"
}

seed_sqlite() {
  local now="$1"
  local id_jarvis="$2"
  local id_catalyst="$3"
  local id_builder="$4"
  local id_board="$5"

  # Use bun:sqlite to create DB and seed data — all values via env vars
  # Tables are already created by the migration runner (called in phase_wizard).
  # Here we only seed data.
  SEED_DB="$DB_FILE" \
  SEED_MENTION="$WIZARD_MENTION_NAME" \
  SEED_NOW="$now" \
  SEED_ID1="$id_jarvis" \
  SEED_ID2="$id_catalyst" \
  SEED_ID3="$id_builder" \
  SEED_ID4="$id_board" \
  bun -e '
import { Database } from "bun:sqlite";

const db = new Database(process.env.SEED_DB, { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

const m = process.env.SEED_MENTION;
const now = process.env.SEED_NOW;

const insertPersona = db.prepare(
  "INSERT OR IGNORE INTO agent_personas (id, name, display_name, model, soul_md, identity_md, memory_md, human_mention_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
);

insertPersona.run(process.env.SEED_ID1, "jarvis", "Jarvis", "claude-sonnet-4-20250514",
  "You are Jarvis, a personal AI assistant. You are helpful, efficient, and proactive.",
  "", "", m, now, now);

insertPersona.run(process.env.SEED_ID2, "the-catalyst", "The Catalyst", "claude-sonnet-4-20250514",
  "You are The Catalyst, a project manager agent. You break down complex projects into actionable tasks, track progress, and keep teams aligned.",
  "", "", m, now, now);

insertPersona.run(process.env.SEED_ID3, "the-builder", "The Builder", "claude-sonnet-4-20250514",
  "You are The Builder, a software developer agent. You write clean, tested, production-quality code. You follow best practices and focus on maintainability.",
  "", "", m, now, now);

const insertBoard = db.prepare(
  "INSERT OR IGNORE INTO boards (id, name, emoji, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
);
insertBoard.run(process.env.SEED_ID4, "Personal", "🏠", now, now);

db.close();
'
  ok "SQLite database seeded at $DB_FILE"
}

# ── Phase 5: Repository Registration ──────────────────────────────────────────

phase_repositories() {
  ui_section "Repository Registration"

  info "Registering oliviermadre/fleex so you can contribute!"
  local repos="oliviermadre/fleex"

  echo ""
  local answer
  answer="$(ui_prompt_yn "Would you like to register your own repositories?" "y")"

  if [ "$answer" = "y" ]; then
    echo ""
    printf "  ${DIM}Enter org/repo (e.g. myorg/myrepo) or org/* for all repos.${NC}\n"
    printf "  ${DIM}Press Enter with empty input when done.${NC}\n"
    echo ""

    while true; do
      local repo
      repo="$(ui_prompt_text "Repository:" "" "org/repo or org/*")"
      if [ -z "$repo" ]; then
        break
      fi
      repos="$repos|$repo"
      ok "Added $repo"
    done
  fi

  echo ""

  # Build repositories array and merge into config
  FLEEX_CFG_DB="$DB_FILE" \
  FLEEX_REPOS="$repos" \
  bun -e '
import { Database } from "bun:sqlite";
const db = new Database(process.env.FLEEX_CFG_DB);
const row = db.prepare("SELECT data FROM app_config WHERE id = ?").get("singleton");
const config = row ? JSON.parse(row.data) : {};
const repoList = process.env.FLEEX_REPOS.split("|").filter(Boolean);
config.repositories = repoList;
config.resolvedRepositories = [];
const now = new Date().toISOString();
db.prepare("INSERT OR REPLACE INTO app_config (id, data, updated_at) VALUES (?, ?, ?)").run("singleton", JSON.stringify(config), now);
db.close();
  '
  ok "Repositories registered in config"

  # Show what was registered
  local IFS_OLD="$IFS"
  IFS='|'
  for r in $repos; do
    printf "    ${CYAN}%s${NC}\n" "$r"
  done
  IFS="$IFS_OLD"
}

# ── Phase 5b: Default Marketplace ─────────────────────────────────────────────

phase_marketplace() {
  ui_section "Marketplace"
  info "Registering the default fleex marketplace…"
  echo ""

  # `marketplace add` is standalone (git clone + registry write, no server needed).
  # Guarded so a missing/inaccessible repo never aborts the install (set -e safe).
  if "$BIN_DIR/$CLI_NAME" marketplace add "$MARKETPLACE_URL" --name "$MARKETPLACE_NAME" >/dev/null 2>&1; then
    MARKETPLACE_REGISTERED=true
    ok "Registered $MARKETPLACE_NAME"
    printf "    ${DIM}Import primitives with:${NC} ${BOLD}fleex import --marketplace %s${NC}\n" "$MARKETPLACE_NAME"
  else
    warn "Could not register the default marketplace automatically."
    warn "You can add it later once your shell is reloaded:"
    printf "    ${BOLD}fleex marketplace add %s --name %s${NC}\n" "$MARKETPLACE_URL" "$MARKETPLACE_NAME"
  fi
}

# ── Phase 6: Completion ───────────────────────────────────────────────────────

phase_complete_update() {
  # Run pending database migrations for existing installs. Prefer the global
  # workspaces.json (migrate the default workspace's DB); fall back to the
  # legacy per-repo .env for installs that predate workspaces.
  if [ -f "$WORKSPACES_FILE" ]; then
    info "Running database migrations (default workspace)..."
    FLEEX_WS_FILE="$WORKSPACES_FILE" \
    FLEEX_WS_DB="$DB_FILE" \
    FLEEX_WS_MIGRATE="$REPO_DIR/packages/server/src/infrastructure/migrations/cli-migrate.ts" \
    FLEEX_WS_REPO="$REPO_DIR" \
    bun -e '
      import { spawnSync } from "node:child_process";
      import fs from "node:fs";
      const raw = JSON.parse(fs.readFileSync(process.env.FLEEX_WS_FILE, "utf8"));
      const list = Array.isArray(raw.workspaces) ? raw.workspaces : [];
      const def = list.find((w) => w.is_default) ?? list[0];
      const env = { ...process.env, ...(def?.env ?? {}) };
      if (!env.FLEEX_SQLITE_PATH) env.FLEEX_SQLITE_PATH = process.env.FLEEX_WS_DB;
      const r = spawnSync("bun", ["--conditions", "development", process.env.FLEEX_WS_MIGRATE], { cwd: process.env.FLEEX_WS_REPO, stdio: "inherit", env });
      process.exit(r.status ?? 0);
    ' 2>&1 || true
    ok "Migrations checked."
  elif [ -f "$ENV_FILE" ]; then
    set -a
    . "$ENV_FILE"
    set +a
    info "Running database migrations..."
    FLEEX_SQLITE_PATH="$DB_FILE" \
    bun --conditions development "$REPO_DIR/packages/server/src/infrastructure/migrations/cli-migrate.ts" 2>&1 || true
    ok "Migrations checked."
  fi

  echo ""
  printf "${GREEN}${BOLD}"
  cat <<'DONE'
  ╔══════════════════════════════════════════════════╗
  ║           fleex updated successfully!            ║
  ╚══════════════════════════════════════════════════╝
DONE
  printf "${NC}"
  echo ""

  # Remind about the default marketplace if it isn't registered yet.
  if ! { [ -f "$MARKETPLACES_FILE" ] && grep -q "\"$MARKETPLACE_NAME\"" "$MARKETPLACES_FILE" 2>/dev/null; }; then
    info "Add the default marketplace:"
    printf "    ${BOLD}fleex marketplace add %s --name %s${NC}\n" "$MARKETPLACE_URL" "$MARKETPLACE_NAME"
    echo ""
  fi

  info "Start the stack:"
  printf "    ${BOLD}fleex start${NC}\n"
  echo ""
}

phase_complete_fresh() {
  echo ""
  printf "${GREEN}${BOLD}"
  cat <<'DONE'
  ╔══════════════════════════════════════════════════╗
  ║          fleex installed successfully!           ║
  ╚══════════════════════════════════════════════════╝
DONE
  printf "${NC}"
  echo ""

  # Summary table
  printf "  ${BOLD}Configuration summary:${NC}\n"
  echo ""
  printf "    Display name     ${BOLD}%s${NC}\n" "$WIZARD_DISPLAY_NAME"
  printf "    Mention name     ${BOLD}@%s${NC}\n" "$WIZARD_MENTION_NAME"
  printf "    Base path        ${BOLD}%s${NC}\n" "$WIZARD_BASE_PATH"
  printf "    Storage driver   ${BOLD}%s${NC}\n" "$WIZARD_STORAGE_DRIVER"
  printf "    Config           ${DIM}%s (app_config table)${NC}\n" "$DB_FILE"
  echo ""

  printf "  ${BOLD}Default personas:${NC}\n"
  printf "    ${CYAN}Jarvis${NC}         Personal AI assistant\n"
  printf "    ${CYAN}The Catalyst${NC}   Project manager agent\n"
  printf "    ${CYAN}The Builder${NC}    Software developer agent\n"
  echo ""

  printf "  ${BOLD}Marketplace:${NC}\n"
  if [ "$MARKETPLACE_REGISTERED" = true ]; then
    printf "    ${CYAN}%s${NC}  registered — ${DIM}fleex import --marketplace %s${NC}\n" "$MARKETPLACE_NAME" "$MARKETPLACE_NAME"
  else
    printf "    ${DIM}Add it with:${NC} ${BOLD}fleex marketplace add %s --name %s${NC}\n" "$MARKETPLACE_URL" "$MARKETPLACE_NAME"
  fi
  echo ""

  # Shell reload instructions
  local shell_name
  shell_name="$(basename "${SHELL:-/bin/bash}")"
  local rc_file
  case "$shell_name" in
    zsh)  rc_file="~/.zshrc" ;;
    bash) rc_file="~/.bashrc" ;;
    fish) rc_file="~/.config/fish/config.fish" ;;
    *)    rc_file="~/.profile" ;;
  esac

  printf "  ${YELLOW}Reload your shell to use fleex:${NC}\n"
  printf "    ${BOLD}source %s${NC}\n" "$rc_file"
  echo ""
  printf "  ${BOLD}Then start fleex:${NC}\n"
  printf "    ${BOLD}fleex start${NC}\n"
  echo ""
  printf "  ${DIM}Other commands:${NC}\n"
  printf "    fleex status       Check running services\n"
  printf "    fleex stop         Stop the stack\n"
  printf "    fleex restart      Restart everything\n"
  printf "    fleex self-update  Update to latest version\n"
  printf "    fleex help         Show all commands\n"
  echo ""
}

# ── Main ───────────────────────────────────────────────────────────────────────

main() {
  banner

  # Phase 1: Prerequisites
  phase_prerequisites

  # Phase 2: Install/Update
  phase_install

  if [ "$IS_FRESH_INSTALL" = true ]; then
    # Phase 3: Setup Wizard
    phase_wizard

    # Phase 4: Seed Data
    phase_seed

    # Phase 5: Repository Registration
    phase_repositories

    # Phase 5b: Default Marketplace
    phase_marketplace

    # Phase 6: Completion (fresh)
    phase_complete_fresh
  else
    # Phase 6: Completion (update)
    phase_complete_update
  fi
}

main "$@"
