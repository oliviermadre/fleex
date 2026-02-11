# Agent Session Manager — Gaming UI Prompt for Nano Banana Pro

## Product-to-RTS Feature Mapping

Before the prompt itself, this document maps every Agent Session Manager (ASM) feature
to a real-time strategy game UI element, drawing from StarCraft: Brood War, StarCraft II,
and Warcraft III interface conventions.

| ASM Feature | RTS UI Element | Rationale |
|---|---|---|
| **Terminal split-pane view** (1×2, 2×2) | **Main battlefield viewport** (center 70% of screen) | The primary workspace where all action happens, just like the game map |
| **Session list grouped by repo/branch** | **Control group bar** (Ctrl+1–9 unit groups) | Quick-switch between clusters of related units/sessions |
| **Session activity indicators** (idle/working/executing/awaiting) | **Unit portrait + status frame** (bottom-center) | Animated portrait showing selected unit state and health |
| **Claude activity dots** (green/amber/red) | **Unit health bars** with color coding | At-a-glance status: green = ready, amber = busy, red = needs attention |
| **Repository dashboard** (PRs, issues, diff stats) | **Score/intel panel** (top-right strategic overlay) | Intelligence readout showing force composition and battlefield stats |
| **Minimap-style session overview** | **Minimap** (bottom-left corner) | Thumbnail of all sessions across all repos, click to jump |
| **Create Session / Create Worktree buttons** | **Command card / ability panel** (bottom-right grid) | 4×3 grid of action buttons with hotkey labels |
| **Pinned shell actions & worktree actions** | **Building production queue** | Queued/favorited commands ready for rapid execution |
| **Command Palette (Cmd+K)** | **Chat/console command line** | Text input for issuing direct commands to any unit/system |
| **Keyboard shortcuts (Alt+1–4)** | **Tab group hotkeys** | Panel switching mirrors RTS control group selection |
| **GitHub PR / Issues tables** | **Tech tree / upgrade panel** | Hierarchical view of in-progress and completed upgrades (PRs) |
| **Diff stats badges (+/−)** | **Damage/armor stat numbers** | Compact numeric readout on unit cards |
| **Worktree list with branch names** | **Base buildings / production facilities** | Each worktree is a "barracks" producing sessions |
| **Claude Config Editor (Monaco)** | **Options/settings screen overlay** | Full-screen overlay accessible from a gear icon |
| **Scratchpad / Notes** | **Allied chat window** | Persistent text area for coordination notes |
| **Server health / API rate limits** | **Resource bar** (minerals, gas, supply) | Top-of-screen resource counters |
| **Repository refresh scheduler** | **Auto-scout / patrol waypoints** | Periodic automated intelligence gathering |
| **Favicon activity indicator** | **Taskbar flash / alert ping** | Out-of-focus notification that action is needed |
| **Theme system (Ember, Material Dark, custom)** | **Race/faction skin selection** | Visual identity choice before entering the game |
| **WebSocket real-time updates** | **Fog of war reveal** | Information streams in live as territory is explored |
| **Session kill / terminate** | **Unit self-destruct / sacrifice** | Deliberate removal from the battlefield |
| **Discovered existing sessions** | **Revealed neutral units on map** | Pre-existing tmux sessions found and imported |

---

## Nano Banana Pro — Image Generation Prompt

```
SCENE: A high-fidelity UI mockup of a developer command center application called "Agent Session Manager" redesigned as a real-time strategy game interface in the visual style of StarCraft II crossed with Warcraft III: Reforged. Dark sci-fi aesthetic with brushed gunmetal frames, glowing cyan and amber accent lines, and subtle holographic overlays. 16:9 widescreen, 1920×1080 resolution.

LAYOUT — TOP RESOURCE BAR (full width, 40px tall):
A horizontal bar spanning the entire top edge, styled like the StarCraft II resource panel. From left to right:
- A glowing blue crystal icon labeled "Sessions: 12 / 24" (active/max sessions like supply count)
- A green vespene gas icon labeled "Repos: 5 tracked" (tracked repositories)
- An amber clock icon labeled "API: 4,842 / 5,000" (GitHub API rate limit like a mana bar, partially depleted)
- A red pulsing heart icon labeled "Server: Healthy — uptime 4h 32m"
- Far right: a gear icon for Settings and a palette icon for Theme Selector
All text in a clean monospace font (Fira Code style) with a slight glow effect.

LAYOUT — MAIN VIEWPORT (center, 65% of screen width, 75% height):
The dominant area shows TWO terminal panes side by side (the 1×2 split layout), styled as embedded holographic displays within a brushed-metal cockpit frame.

Left pane — labeled "claude ◆ feature-auth" in a top tab bar styled like a unit nameplate:
- Shows a live terminal with colored ANSI output, Claude AI generating code
- A thin animated progress bar at the top of the pane glows amber, indicating "Working..."
- The pane border pulses with a soft amber glow (active/working state)

Right pane — labeled "shell ◆ main" in the same tab style:
- Shows a bash terminal with git log output and test results
- The pane border is a calm cyan (idle state)
- A green dot in the tab indicates this session is idle/ready

Between the panes, a thin draggable divider with a subtle grip texture.
Below each pane: a slim status bar showing "~/projects/my-app • main • anthropic/my-app" with branch and repo info, styled like a unit stat footer.

LAYOUT — MINIMAP PANEL (bottom-left corner, 220×180px):
A minimap styled exactly like the StarCraft/Warcraft minimap — a dark recessed panel with a beveled stone/metal frame. Inside:
- A grid of small colored dots representing all active sessions across all repositories
- Dots are color-coded: green (idle shell), amber (working Claude), red (awaiting approval), gray (dead)
- Dots are spatially clustered by repository — each repo cluster is a labeled "region" on the minimap
- A white rectangle outline shows which sessions are currently visible in the main viewport
- Tiny text labels: "anthropic/claude (3)", "acme/frontend (2)", "acme/api (4)"
- The currently selected session cluster glows brighter

LAYOUT — UNIT PORTRAIT & INFO PANEL (bottom-center, 400×180px):
Styled like the StarCraft II unit info panel with a dark recessed frame:
- Left side: A large circular "portrait" frame containing an animated icon:
  - For Claude sessions: a stylized AI brain icon with pulsing neural network lines
  - For Shell sessions: a terminal ">" cursor icon
  - The portrait background color reflects status (green/amber/red)
- Center: Selected session details in a stat block layout:
  - Name: "claude ◆ feature-auth" (large, bold)
  - Type: "Claude AI Session" with a small robot icon
  - Status: "WORKING" in amber with an animated ellipsis
  - Repository: "anthropic/my-app"
  - Branch: "feature/user-auth"
  - Created: "2h 14m ago"
  - Prompt: "Implement OAuth2 login flow..." (truncated)
- Right side: A vertical stack of action buttons styled like ability icons:
  - Kill Session (skull icon, red tint)
  - Split View (two-pane icon)
  - Copy Output (clipboard icon)
  - Open Repo Dashboard (chart icon)
  Each button has a hotkey letter in the corner (K, S, C, D)

LAYOUT — COMMAND CARD (bottom-right, 280×180px):
A 3×4 grid of square action buttons styled exactly like the StarCraft II command card, with beveled metallic frames and icon art:
Row 1: [New Shell Session ⌨] [New Claude Session 🤖] [Create Worktree 🌳] [Fetch Branches ↓]
Row 2: [Kill Selected ☠] [Split Pane ◫] [Open Dashboard 📊] [Refresh Repos 🔄]
Row 3: [Command Palette ⌘K] [Scratchpad 📝] [Claude Config ⚙] [Toggle Sidebar ◧]
Each button has:
- A hand-painted icon in the Warcraft III ability art style (painterly, slightly fantastical)
- A single-letter hotkey badge in the top-right corner
- A tooltip-ready hover state (show one button with a tooltip expanded as an example)
- Disabled/grayed state for context-inappropriate actions
The "New Claude Session" button has a golden border indicating it is the primary/recommended action.

LAYOUT — LEFT SIDEBAR (far left, 240px wide, full height):
A dark sidebar panel styled like an RTS tech tree or building panel, with collapsible sections:

Section 1 — "SESSIONS" (with a count badge "12"):
- Grouped by repository, each group is a collapsible node styled like a tech tree branch
- "anthropic/my-app" group (expanded):
  - "main" sub-group:
    - shell ◆ main [green dot] [idle]
  - "feature/user-auth" sub-group:
    - claude ◆ feature-auth [amber dot] [working] ← currently selected, highlighted
    - shell ◆ feature-auth [green dot] [idle]
- "acme/frontend" group (collapsed, shows "3 sessions")
- "acme/api" group (collapsed, shows "4 sessions")
Each session item has: activity dot, type icon (terminal/brain), name, and a subtle health bar

Section 2 — "REPOSITORIES" (with count badge "5"):
- Listed by org, each with PR/issue count badges
- "anthropic" org:
  - my-app [3 PRs] [2 issues]
  - claude [1 PR] [5 issues]
- Each repo item shows a tiny spark-line of recent activity

Section 3 — "PINNED ACTIONS" (quick-access bar):
- Small icon buttons in a horizontal row: Deploy, Test, Lint, Open PR
- Styled like the Warcraft III item slots (small square with icon)

Section 4 — "INTEL" (collapsed):
- Claude Config browser
- Scratchpad access

LAYOUT — STRATEGIC OVERLAY (top-right, semi-transparent, 350×200px):
A floating panel styled like an RTS intelligence/score screen, semi-transparent with a dark tint:
- Title: "REPOSITORY INTEL — anthropic/my-app"
- Row: "Open PRs: 3" with small green arrows
- Row: "My PRs: 1" with a star icon
- Row: "Assigned: 2" with a target icon
- Row: "Issues: 5 (2 mine)" with exclamation marks
- Row: "Recently Merged: 4 (7 days)" with checkmarks
- A mini bar chart showing commits ahead/behind per worktree
- Diff stats: "+1,247 / −389 lines" in green/red text
- Last refreshed: "32s ago" with a circular auto-refresh indicator spinning

COLOR PALETTE:
- Background: #0a0e17 (deep space navy)
- Panel frames: #1a2332 with #2a3a52 beveled edges
- Primary accent: #00d4ff (cyan, for idle/ready states)
- Secondary accent: #ffaa00 (amber, for working/active states)
- Alert accent: #ff4444 (red, for attention-needed states)
- Success: #44ff88 (green, for completed/healthy)
- Text primary: #e0e8f0 (light gray-blue)
- Text secondary: #6888a8 (muted blue-gray)
- Selected highlight: #1a3a5a with cyan border glow

TYPOGRAPHY:
- UI labels: JetBrains Mono or Fira Code, 11–13px
- Section headers: Bold, slightly larger, ALL CAPS with letter-spacing
- Terminal text: Standard monospace, 12px
- Resource numbers: Tabular figures, medium weight

VISUAL EFFECTS:
- Subtle scanline overlay on terminal panes (very faint, 5% opacity)
- Soft glow/bloom on active status indicators
- Panel borders have a 1px inner highlight and 1px outer shadow for depth
- The minimap has a very subtle radar-sweep animation
- Active session portrait has a looping idle animation (gentle pulse)
- Amber "working" borders have a slow breathing animation
- Hover states show a brief flash highlight (like selecting a unit)

MOOD & ATMOSPHERE:
- Military command center meets developer IDE
- The feeling of commanding an army of AI agents and shell processes
- Clean, information-dense, zero wasted space
- Every pixel serves a strategic purpose
- Professional but with a sense of power and control
- Dark theme optimized for long coding sessions (low eye strain)
- The interface should feel like sitting in a starship bridge, commanding a fleet of developer agents
```

---

## Prompt Variant — Warcraft III Fantasy Style

```
SCENE: A UI mockup of "Agent Session Manager" reimagined as a high-fantasy Warcraft III-style interface. Ornate stone and wood panel frames with gold filigree trim. Parchment textures for information panels. Magical rune accents instead of tech glow lines. 16:9, 1920×1080.

MAIN VIEWPORT (center): Two terminal panes framed by carved stone archways. The left pane (Claude session) has a magical purple glow around its border with floating arcane particles — the AI is "casting a spell" (generating code). The right pane (Shell session) has a calm forest-green vine border — idle and at peace.

MINIMAP (bottom-left): A weathered parchment map showing "territories" (repositories) as illustrated regions — forests, mountains, villages. Session dots appear as faction banners planted on the map. Active Claude sessions are glowing purple towers. Idle shells are green campfires.

PORTRAIT PANEL (bottom-center): A painted character portrait in a gilt oval frame. The Claude session is depicted as a wizard with glowing eyes, holding a staff. Below the portrait: a golden nameplate "Archmage Claude — Weaving auth-flow spell...", health bar (session uptime), mana bar (API rate remaining), and status runes.

COMMAND CARD (bottom-right): A 3×4 grid of spell/ability icons on a leather-bound panel. Each icon is a hand-painted fantasy illustration: "Summon Shell" (portal icon), "Invoke Claude" (spellbook), "Forge Worktree" (anvil), "Banish Session" (skull with flames), "Scrying Pool" (crystal ball = dashboard), "Dispatch Raven" (refresh repos). Gold hotkey letters in each corner.

SIDEBAR (left): A wooden bookshelf panel. Sessions are listed as "tome spines" on shelves, grouped by "guild" (repository). Active sessions have a faint magical glow on their spine. The repository section shows castles with banner counts (PRs as flags, issues as wanted-posters). Pinned actions are potion bottles on a shelf.

RESOURCE BAR (top): A stone bar with: crystal ball "Sessions: 12/24", gold coins "Repos: 5", a magical hourglass "API: 4,842/5,000" (sand draining), and a beating heart gem "Server: Alive".

INTEL OVERLAY (top-right): A floating semi-transparent scroll showing repository intelligence: PR counts as "quests available", issues as "bounties posted", diff stats as "territory gained/lost", merge history as "victories this week".

COLOR PALETTE: Deep browns (#2a1a0a), rich purples (#6a2aaa), forest greens (#2a6a3a), gold (#d4aa44), parchment (#e8d4b0), blood red for alerts (#aa2222).

MOOD: A wizard's war room. Commanding magical agents across a realm of code. Equal parts Warcraft III interface and IDE. Every session is a hero unit. Every repository is a kingdom. The developer is the warchief.
```

---

## Usage Notes

- **Primary prompt** (first block): Use for a sci-fi / StarCraft II aesthetic — clean, modern, information-dense
- **Fantasy variant** (second block): Use for a Warcraft III aesthetic — ornate, painterly, thematic
- Both prompts are designed for 1920×1080 output and describe every panel with enough specificity for an image generator to produce a coherent, complete UI mockup
- Adjust resolution in the prompt if targeting different output sizes
- The feature mapping table above can be used to verify completeness — every ASM feature has a corresponding UI element in the prompts
