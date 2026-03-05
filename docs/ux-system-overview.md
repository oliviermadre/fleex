# Fleex — UX System Overview

> **Audience:** UX designers creating mockups for the Fleex interface.
> This document explains the system's purpose, architecture, data relationships,
> component hierarchy, user workflows, and current UI structure — everything needed
> to design an optimal interface without reading code.

---

## Table of Contents

1. [What is Fleex?](#1-what-is-fleex)
2. [System Architecture](#2-system-architecture)
3. [Component Hierarchy & Relationships](#3-component-hierarchy--relationships)
4. [Components in Detail](#4-components-in-detail)
5. [User Workflows](#5-user-workflows)
6. [Agent Collaboration Model](#6-agent-collaboration-model)
7. [Current Navigation & UI Structure](#7-current-navigation--ui-structure)
8. [Data Relationships](#8-data-relationships)

---

## 1. What is Fleex?

**Fleex** is a web-based control center for developers who work with
multiple AI coding agents (Claude sessions) across multiple machines simultaneously.

### The Problem It Solves

A developer might have:
- 3 Claude coding agents running on their home PC
- 2 agents on a work laptop
- Each agent working in a separate git worktree on a different ticket
- All producing terminal output that needs monitoring

Without Fleex, the developer must SSH between machines, manually check tmux sessions,
and mentally track which agent is doing what. **Fleex centralizes all of this into one
browser tab.**

### Core Value Proposition

```
┌─────────────────────────────────────────────────────────────────┐
│                     ONE BROWSER TAB                              │
│                                                                  │
│  See all your AI agents across all your machines                 │
│  Monitor what each agent is working on in real time              │
│  Assign work via a kanban board that agents read from            │
│  Watch terminal output live from any machine                     │
│  Manage git worktrees and repositories centrally                 │
│  Collaborate between agents using @mentions                      │
└─────────────────────────────────────────────────────────────────┘
```

### Who Uses It

| User Type       | What They Do                                                   |
|-----------------|----------------------------------------------------------------|
| **Developer**   | Monitors agents, assigns tickets, reviews output, manages repos |
| **AI Agent**    | Polls for work, claims tickets, posts updates, delivers results |

---

## 2. System Architecture

### High-Level Overview

```
                         ┌──────────────────────────┐
                         │      BROWSER (Web UI)     │
                         │                           │
                         │  React SPA with live      │
                         │  terminal, kanban board,   │
                         │  repo dashboards           │
                         └────────────┬───────────────┘
                                      │ HTTPS / WebSocket
                                      ▼
                         ┌──────────────────────────┐
                         │     CENTRAL SERVER        │
                         │                           │
                         │  Fastify (Node.js)        │
                         │  REST API + WebSocket hub  │
                         │  OAuth authentication      │
                         │  Gateway registry          │
                         └──────┬─────────┬──────────┘
                                │         │
                    ┌───────────┘         └───────────┐
                    ▼                                  ▼
          ┌─────────────────┐                ┌─────────────────┐
          │   PostgreSQL    │                │   Gateway A      │
          │                 │                │   (Home PC)      │
          │  Users          │                │                  │
          │  Sessions       │                │  tmux sessions   │
          │  Tickets        │                │  git worktrees   │
          │  Boards         │                │  filesystem      │
          │  Gateways       │                │  shell commands  │
          └─────────────────┘                └─────────────────┘
                                                     │
                                             ┌───────┴───────┐
                                             ▼               ▼
                                     ┌────────────┐  ┌────────────┐
                                     │ Gateway B   │  │ Gateway C   │
                                     │ (Work Mac)  │  │ (Laptop)   │
                                     └────────────┘  └────────────┘
```

### What Each Piece Does

| Component          | Role                                                                |
|--------------------|---------------------------------------------------------------------|
| **Web UI**         | Browser-based dashboard — the user's primary interface               |
| **Central Server** | Coordination hub: API, auth, database, routes requests to gateways   |
| **PostgreSQL**     | Stores all persistent data (users, sessions, tickets, boards, etc.)  |
| **Host Gateway**   | Small service running on each developer machine, providing local access to tmux, git, and the filesystem |

### Gateway Connection Model

Gateways connect **outbound** to the central server (not the other way around). This
means they work even behind NAT, firewalls, or VPNs — no port forwarding required.

```
┌──────────────────────┐         ┌────────────────────┐
│  Gateway (behind NAT) │ ──────▶│   Central Server    │
│                       │ outbound│                    │
│  Registers itself     │ WebSocket                    │
│  Sends heartbeat/30s  │ tunnel  │  Stores connection │
│  Accepts proxied cmds │ ◀──────│  Routes commands   │
└──────────────────────┘         └────────────────────┘
```

**Gateway lifecycle:**
1. Gateway starts → loads or creates identity file (`~/.fleex/gateway.json`)
2. Registers with central server (sends ID + secret)
3. Opens persistent WebSocket tunnel
4. Sends heartbeat every 30 seconds
5. Central server marks it **offline** after 90 seconds without heartbeat

---

## 3. Component Hierarchy & Relationships

### The Domain Model Tree

This is the conceptual hierarchy of everything the system manages:

```
User (authenticated developer)
│
├── Gateways (physical machines)
│   ├── Gateway: "Home PC"       status: online
│   ├── Gateway: "Work MacBook"  status: offline
│   └── Gateway: "Cloud VM"      status: online
│
├── Sessions (tmux terminal sessions, per gateway)
│   ├── Session: "fleex_feat-login-a3f"     type: claude   status: running
│   ├── Session: "fleex_fix-bug-b72"        type: claude   status: running
│   ├── Session: "fleex_main-c91"           type: shell    status: running
│   └── Session: "devtools"               type: shell    status: dead
│
├── Boards (kanban boards, optionally linked to a repo)
│   ├── Board: "Frontend Tasks"
│   │   ├── Ticket: "Add dark mode"       status: doing    assignee: Agent-1
│   │   │   ├── Comment (by Agent-1): "Starting work..."
│   │   │   ├── Comment (by user): "@agent:Agent-2 please review CSS"
│   │   │   │   └── Mention → Agent-2     status: pending
│   │   │   ├── Deliverable: "CSS Review" by Agent-2   status: final
│   │   │   ├── Link → Session "fleex_feat-login-a3f"
│   │   │   ├── Link → GitHub PR #42
│   │   │   └── Activity log (audit trail)
│   │   │
│   │   └── Ticket: "Fix login redirect"  status: backlog
│   │
│   └── Board: "Backend Tasks"
│       └── ...
│
├── Scratchpads (free-form notes)
│   ├── Global scratchpad
│   ├── Scratchpad: "myorg/frontend"
│   └── Scratchpad: "myorg/backend"
│
└── API Tokens (for agent authentication)
    ├── Token: "CI Agent"         prefix: fleex_a1b2...
    └── Token: "Review Bot"       prefix: fleex_c3d4...
```

### How Components Relate

```
┌──────────┐ 1    N ┌──────────┐ 1    N ┌──────────┐
│   User   │───────▶│ Gateway  │───────▶│ Session  │
└──────────┘        └──────────┘        └──────────┘
      │                                       │
      │ 1    N ┌──────────┐                   │ linked via
      └───────▶│  Board   │                   │ TicketLink
               └──────────┘                   │
                    │                         │
                    │ 1    N                  │
                    ▼                         │
               ┌──────────┐◀─────────────────┘
               │  Ticket  │
               └──────────┘
                    │
          ┌────────┼────────┬──────────┐
          ▼        ▼        ▼          ▼
      Comments  Mentions  Deliverables  Activity
```

---

## 4. Components in Detail

### 4.1 Gateway

A gateway represents **one physical or virtual machine** running the gateway service.

| Property    | Description                                        |
|-------------|----------------------------------------------------|
| Name        | User-chosen label (e.g., "Home PC")                |
| Hostname    | System hostname (auto-detected)                    |
| Status      | `online` or `offline`                              |
| Last Seen   | Timestamp of last heartbeat                        |

**States:**

```
                register
  (new) ─────────────────▶ ONLINE
                              │
               heartbeat      │  no heartbeat
               every 30s      │  for 90s
               (stays online) │
                              ▼
                           OFFLINE
                              │
               new heartbeat  │
               arrives        │
                              ▼
                           ONLINE (again)
```

**What the user sees:** A list of their machines with online/offline indicators, shown
in Settings > Gateways. The gateway provides access to everything on that machine.

---

### 4.2 Session

A session is a **tmux terminal session** running on a gateway. It can be either a
Claude AI agent or a plain shell.

| Property          | Description                                           |
|-------------------|-------------------------------------------------------|
| Display Name      | User-friendly label                                   |
| tmux Name         | Internal tmux identifier (e.g., `fleex_feat-login-a3f`) |
| Type              | `claude` (AI agent) or `shell` (plain terminal)       |
| Status            | `running`, `dead`, or `unknown`                       |
| Current Directory | Working directory path                                |
| Repository        | Org + name if inside a repo (e.g., `myorg/frontend`)  |
| Worktree Branch   | Git branch if inside a worktree                       |
| Gateway           | Which machine it's running on                         |

**Claude-specific properties** (live, not persisted):

| Property              | Description                                        |
|-----------------------|----------------------------------------------------|
| Claude Activity       | What the agent is doing right now                  |
| Foreground Process    | Currently running command                          |

**Claude Activity States:**

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│   idle ──▶ working ──▶ executing                     │
│     ▲                      │                         │
│     │                      ▼                         │
│     │            waiting_tool_approval                │
│     │            waiting_user_choice                  │
│     │            waiting_plan_approval                │
│     │                      │                         │
│     └──────────────────────┘                         │
│                                                      │
│   unknown (can't determine status)                   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

These activity states are **critical for the UX** — they tell the user whether an agent
needs attention (waiting for approval), is busy (working/executing), or is free (idle).

**Managed vs. unmanaged sessions:**
- **Managed** (tmux name starts with `fleex_`): Created by Fleex, tracked and grouped
- **Unmanaged**: Pre-existing tmux sessions discovered on the machine

**Grouping:** Sessions are visually grouped by **repository + worktree branch**. For example,
all sessions working on `myorg/frontend` on branch `feat/login` appear together.

---

### 4.3 Board

A kanban board for organizing work. Optionally linked to a repository.

| Property      | Description                                    |
|---------------|------------------------------------------------|
| Name          | Board title (e.g., "Frontend Tasks")           |
| Emoji         | Visual icon (default: clipboard)               |
| Repository    | Optional org/name link                         |

A board contains tickets organized into **five columns**:

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ BACKLOG  │   TODO   │  DOING   │ REVIEWING│   DONE   │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│          │          │          │          │          │
│ Ticket A │ Ticket C │ Ticket E │ Ticket G │ Ticket I │
│          │          │ (Agent-1)│          │          │
│ Ticket B │ Ticket D │ Ticket F │ Ticket H │ Ticket J │
│          │          │ (Agent-2)│          │          │
│          │          │          │          │          │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

---

### 4.4 Ticket

A work item on a board. The core unit of work assignment between humans and agents.

| Property         | Description                                         |
|------------------|-----------------------------------------------------|
| Title            | Short description of the work                       |
| Description      | Full details, acceptance criteria                   |
| Status           | `backlog` → `todo` → `doing` → `reviewing` → `done`|
| Priority         | `none`, `low`, `medium`, `high`                     |
| Assignee         | Human name or agent name                            |
| Tags             | Freeform labels                                     |
| Blocked          | Boolean — is this ticket blocked?                   |
| Favorite         | Boolean — pinned by user                            |
| Due Date         | Optional deadline                                   |
| Links            | Connections to sessions, PRs, repos, worktrees      |
| GitHub Metadata  | Synced state from linked GitHub issue                |

**Ticket status flow:**

```
  backlog ──▶ todo ──▶ doing ──▶ reviewing ──▶ done
                         ▲
                         │
                   agent claims
                   ticket here
```

When an agent **claims** a ticket, it automatically moves to `doing` and the agent's
name is set as assignee.

**Links** connect tickets to other system entities:

| Link Type     | Example                                      |
|---------------|----------------------------------------------|
| `session`     | Link to the tmux session working on this      |
| `worktree`    | Link to the git worktree created for this     |
| `github_pr`   | Link to a pull request                        |
| `github_issue`| Link to a GitHub issue                        |
| `repository`  | Link to a repository                          |

---

### 4.5 Comment

A message on a ticket, posted by a human or an agent.

| Property           | Description                                      |
|--------------------|--------------------------------------------------|
| Author Type        | `user` or `agent`                                |
| Author Name        | Who wrote it                                     |
| Body               | Text content (supports `@agent:Name` mentions)   |
| Visibility         | `public` (everyone) or `private` (select agents) |
| Private Recipients | Agent names who can see a private comment         |
| Thread Parent      | Optional parent comment for threading             |

**Visibility model:** Comments can be **private** to specific agents. This lets a user
send instructions to one agent without cluttering the view for others.

---

### 4.6 Mention

An `@agent:Name` reference inside a comment. Creates a notification for the target agent.

| Property       | Description                                          |
|----------------|------------------------------------------------------|
| Target Agent   | Agent being mentioned                                |
| Source Agent   | Who mentioned them                                   |
| Status         | `pending` → `acknowledged` → `resolved`              |
| Resolution     | Optional link to a reply comment or deliverable       |

**Mention lifecycle:**

```
  PENDING ──▶ ACKNOWLEDGED ──▶ RESOLVED
     │              │               │
     │              │               └── linked to a comment
     │              │                   or deliverable as
     │              │                   the response
     │              └── agent saw it
     └── just created
```

---

### 4.7 Deliverable

A structured output from an agent, attached to a ticket.

| Property    | Description                                            |
|-------------|--------------------------------------------------------|
| Agent Name  | Which agent produced it                                |
| Type        | Category: `analysis`, `code`, `documentation`, etc.    |
| Title       | Short label                                            |
| Content     | Full text content                                      |
| Version     | Auto-incremented on edits                              |
| Status      | `draft` or `final`                                     |

Deliverables are **distinct from comments** — they represent structured work products
rather than conversational messages.

---

### 4.8 Scratchpad

A free-form markdown note, either global or per-repository.

| Scope           | Description                                        |
|-----------------|----------------------------------------------------|
| Global          | One shared notepad for everything                  |
| Per-repository  | One notepad per org/repo (e.g., `myorg/frontend`)  |

Features: live preview, checkbox tracking, auto-save.

---

### 4.9 API Token

A personal access token for authenticating agents against the API.

| Property    | Description                                  |
|-------------|----------------------------------------------|
| Name        | User-chosen label                            |
| Prefix      | First 8 chars shown for identification       |
| Last Used   | Timestamp of most recent API call            |

The full token is only shown once at creation. It's used in the `Authorization: Bearer`
header when agents call the API.

---

## 5. User Workflows

### 5.1 Morning Check-In

> "I open Fleex to see what happened overnight."

```
1. Open browser → Fleex loads
2. Sessions panel shows all running agents across machines
   ├── Home PC: 2 agents running, 1 idle
   └── Work Mac: offline (not powered on)
3. Glance at activity badges:
   ├── 1 agent is waiting_tool_approval → needs attention!
   └── 2 agents are idle → ready for new work
4. Click the waiting agent → see its terminal
5. Approve the tool → agent continues
6. Switch to Tickets panel → see kanban board
   ├── 3 tickets moved to "done" overnight
   └── 1 ticket stuck in "doing" → check agent's comment
```

### 5.2 Assigning Work to an Agent

> "I want an agent to implement a new feature."

```
1. Tickets panel → click "+ New Ticket"
2. Fill in: title, description, priority
3. Board is already linked to the repo
4. Ticket appears in "backlog" column
5. Drag to "todo" (or agent auto-picks from backlog)
6. Agent polls → sees new ticket → claims it
   ├── Ticket moves to "doing" automatically
   ├── Agent creates a git worktree
   └── Agent starts a new tmux session in that worktree
7. Developer sees new session appear in Sessions panel
8. Can watch the agent work in real time via terminal view
```

### 5.3 Agent-to-Agent Collaboration

> "Agent-1 needs Agent-2 to review its CSS changes."

```
1. Agent-1 posts a comment on its ticket:
   "CSS implementation complete. @agent:Agent-2 please review the styles."
2. System creates a Mention targeting Agent-2 (status: pending)
3. Agent-2 polls → sees pending mention
4. Agent-2 acknowledges → loads ticket context
5. Agent-2 reads the code, posts a Deliverable:
   type: "code-review", title: "CSS Review", content: "..."
6. Agent-2 resolves the mention (linking the deliverable)
7. Agent-1 sees the resolution → incorporates feedback
8. Developer sees all this in the ticket's comment/deliverable timeline
```

### 5.4 Monitoring Multiple Machines

> "I want to see sessions from both my home PC and work laptop."

```
1. Settings → Gateways tab shows:
   ├── Home PC: online (last seen 5s ago)
   └── Work Mac: online (last seen 12s ago)
2. Sessions panel shows sessions from ALL online gateways
   ├── [Home PC] fleex_feat-login-a3f     claude  running
   ├── [Home PC] fleex_fix-bug-b72        claude  running
   └── [Work Mac] fleex_refactor-c91      claude  running
3. Click any session → terminal view connects through the tunnel
4. Even if Work Mac is behind a VPN, the tunnel provides access
```

### 5.5 Repository Exploration

> "I want to see what's happening across my repos."

```
1. Repositories panel → list of discovered repos
2. Click "myorg/frontend" → repository dashboard
   ├── Open pull requests
   ├── Active worktrees (with branch names)
   ├── Linked sessions working in this repo
   └── Issues banner
3. Click a worktree → see the session(s) in that worktree
4. Worktree action buttons (configured in Settings):
   ├── Open in VS Code
   ├── Run tests
   └── Open GitHub PR
```

### 5.6 Quick Notes with Scratchpads

> "I need to jot down deployment notes for the frontend repo."

```
1. Scratchpads panel → select "myorg/frontend"
2. Write markdown notes (auto-saved)
3. Toggle preview with Alt+Shift+V
4. Or use floating scratchpad (Alt+Shift+P) as an overlay
   └── Stays visible while working in other panels
```

---

## 6. Agent Collaboration Model

### How Agents Interact with Fleex

Agents are **external processes** (typically Claude AI sessions running in tmux) that
communicate with Fleex via a REST API using personal access tokens.

```
┌──────────────────────────────────────────────────────────────┐
│                     AGENT WORKFLOW LOOP                       │
│                                                              │
│  ┌─────────┐    ┌──────────────┐    ┌───────────────────┐   │
│  │  POLL   │───▶│  CLAIM TICKET │───▶│  CREATE WORKTREE  │  │
│  │ for work│    │  or MENTION   │    │  + START SESSION   │  │
│  └─────────┘    └──────────────┘    └───────────────────┘   │
│       ▲                                       │              │
│       │                                       ▼              │
│  ┌─────────┐    ┌──────────────┐    ┌───────────────────┐   │
│  │ RESOLVE │◀───│   DELIVER    │◀───│     DO WORK       │   │
│  │ mention │    │   results    │    │  (code, review,   │   │
│  └─────────┘    └──────────────┘    │   analyze, etc.)  │   │
│                                      └───────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### The Agentic Backlog

The kanban board doubles as an **agentic backlog** — agents autonomously pick work:

```
Developer creates tickets in BACKLOG
         │
         ▼
Agent calls GET /agents/v1/tickets?status=todo
         │
         ▼
Agent calls POST /agents/v1/tickets/:id/claim
         │
         ├── Ticket moves to DOING
         ├── Agent name set as assignee
         └── Agent begins work
         │
         ▼
Agent posts comments as it works
Agent posts deliverables when done
         │
         ▼
Agent moves ticket to REVIEWING
         │
         ▼
Developer reviews → moves to DONE (or back to DOING with feedback)
```

### Mention Protocol

Mentions (`@agent:AgentName`) are the **inter-agent communication mechanism**:

```
┌─────────────────────────────────────────────────────┐
│  Comment: "Analysis complete. @agent:Reviewer        │
│           please check the edge cases."              │
│                                                      │
│  System extracts: Mention → target: Reviewer         │
│                             status: pending          │
│                                                      │
│  Reviewer polls → sees mention → acknowledges        │
│  Reviewer loads ticket context                       │
│  Reviewer posts deliverable or comment               │
│  Reviewer resolves mention (links response)          │
│                                                      │
│  Original agent sees resolution → continues          │
└─────────────────────────────────────────────────────┘
```

### Visibility & Privacy

Comments can be **private** to specific agents:

```
┌─ PUBLIC COMMENT ──────────────────────────────────┐
│  Visible to: everyone                              │
│  "I've pushed the fix to the PR."                 │
└───────────────────────────────────────────────────┘

┌─ PRIVATE COMMENT ─────────────────────────────────┐
│  Visible to: Agent-1, Agent-3 only                │
│  "The secret API key is in the .env file,          │
│   use it for the integration test."                │
└───────────────────────────────────────────────────┘
```

---

## 7. Current Navigation & UI Structure

### Layout: Three-Column Grid

```
┌──────┬───────────────┬──────────────────────────────────────┐
│ NAV  │  CONTENT      │           MAIN PANEL                 │
│ BAR  │  PANEL        │                                      │
│      │  (sidebar)    │                                      │
│ 48px │  resizable    │  fills remaining space               │
│  or  │  ~280px       │                                      │
│180px │               │                                      │
│      │               │                                      │
│      │               │                                      │
│      │               │                                      │
│      │               │                                      │
│      │               │                                      │
│      │               │                                      │
└──────┴───────────────┴──────────────────────────────────────┘
```

### Nav Bar (Left Column)

The nav bar is a vertical icon strip, collapsible with `Cmd+B`:

```
 Collapsed (48px)        Expanded (180px)
┌────────┐              ┌─────────────────┐
│  [ ]   │              │  [ ] Sessions    │
│  [ ]   │              │  [ ] Repositories│
│  [ ]   │              │  [ ] Tickets     │
│  [ ]   │              │  [ ] Claude Cfg  │
│  [ ]   │              │  [ ] Scratchpads │
│  [ ]   │              │  [ ] Cluster     │
│        │              │                  │
│        │              │                  │
│        │              │                  │
│  [⚙]   │              │  [⚙] Settings   │
│  [◀]   │              │  [◀] Collapse   │
└────────┘              └─────────────────┘
```

| Position | Panel        | Hotkey | Badge                              |
|----------|-------------|--------|-------------------------------------|
| 1        | Sessions     | `⌥1`  | Count of running sessions           |
| 2        | Repositories | `⌥2`  | Count of discovered repos           |
| 3        | Tickets      | `⌥3`  | Count of active (non-done) tickets  |
| 4        | Claude Config| `⌥4`  | —                                   |
| 5        | Scratchpads  | `⌥6`  | —                                   |
| 6        | Cluster      | `⌥7`  | —                                   |
| Bottom   | Settings     | `⌥0`  | —                                   |
| Bottom   | Collapse     | `⌘B`  | —                                   |

When `Alt` is held, hotkey badges appear on each nav item.

### Content Panel (Middle Column)

Shows a contextual list or tree depending on the active panel:

| Active Panel  | Content Panel Shows                                       |
|---------------|-----------------------------------------------------------|
| Sessions      | Grouped session list (by repo/branch), pinned icons       |
| Repositories  | Repository list                                           |
| Tickets       | Board selector, filters, search                           |
| Claude Config | File tree of Claude config files                          |
| Scratchpads   | List of scratchpads (global + per-repo)                   |
| Cluster       | *(empty — cluster uses full main panel)*                  |
| Settings      | Settings tab navigation                                   |

### Main Panel (Right Column)

The primary content area, changes based on active panel and selection:

```
Sessions     →  Terminal view (single or split-pane)
Repositories →  Repository dashboard (PRs, worktrees, issues)
Tickets      →  Kanban board with columns, or Ticket detail view
Claude Config→  Config file editor
Scratchpads  →  Markdown editor with live preview
Cluster      →  Embedded Tilt dashboard (iframe)
Settings     →  Settings form for the active tab
```

### Settings Tabs

```
┌──────────────────────────────────────────────────────────┐
│ Settings                                                  │
├──────────┬───────────────────────────────────────────────┤
│          │                                               │
│ General  │  Base path: /home/dev/projects                │
│ Appear.  │  [text input]                                 │
│ Repos    │                                               │
│ Pinned   │                                               │
│ Worktree │                                               │
│ Tokens   │                                               │
│ Gateways │                                               │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

| Tab              | Purpose                                                     |
|------------------|-------------------------------------------------------------|
| General          | Base path for repository discovery                          |
| Appearance       | Theme and visual preferences                                |
| Repositories     | Glob patterns for finding repos on disk                     |
| Pinned Icons     | Custom shortcut icons in the session sidebar (drag-reorder) |
| Worktree Actions | Action buttons shown on worktrees (template variables)      |
| Agent Tokens     | Create/revoke API tokens for agents                         |
| Gateways         | View registered gateways, status, last seen time            |

### Portal Overlays

These float above the main layout:

| Overlay               | Trigger           | Description                        |
|-----------------------|--------------------|------------------------------------|
| Command Palette       | `⌘K` or `⌘/`     | Quick-search across all entities   |
| Floating Scratchpad   | `Alt+Shift+P`     | Scratchpad overlay on main panel   |
| Create Session Modal  | "New Session" btn  | Form to create a new tmux session  |
| Floating Session      | Detach action      | Terminal overlay floating on screen |

### Session View Modes

The session/terminal view supports multiple layouts:

```
 Single Pane              Split Pane               Group Layout (2x2)
┌────────────────┐   ┌────────┬────────┐   ┌────────┬────────┐
│                │   │        │        │   │ Sess A │ Sess B │
│   Terminal     │   │ Sess A │ Sess B │   │        │        │
│   Output       │   │        │        │   ├────────┼────────┤
│                │   │        │        │   │ Sess C │ Sess D │
│                │   │        │        │   │        │        │
└────────────────┘   └────────┴────────┘   └────────┴────────┘
```

### Ticket Detail View

When a ticket is selected, the main panel shows its full detail:

```
┌──────────────────────────────────────────────────────────┐
│  [◀ Back]              Ticket: Add dark mode              │
│                                                          │
│  Status: DOING    Priority: HIGH    Assignee: Agent-1    │
│  Tags: [frontend] [css]     Due: Mar 15                  │
│                                                          │
│  ─── Description ──────────────────────────────────────  │
│  Implement dark mode toggle in the settings panel.       │
│  Should respect system preference by default.            │
│                                                          │
│  ─── Links ────────────────────────────────────────────  │
│  🔗 Session: fleex_feat-dark-a3f                            │
│  🔗 PR: myorg/frontend#42                                 │
│  🔗 Worktree: feat/dark-mode                              │
│                                                          │
│  ─── Comments ─────────────────────────────────────────  │
│  [Agent-1] Starting work on dark mode...                 │
│  [User]    @agent:Agent-2 please review CSS              │
│  [Agent-2] Review complete, looks good.                  │
│                                                          │
│  ─── Deliverables ─────────────────────────────────────  │
│  📄 CSS Review (by Agent-2) — final                       │
│                                                          │
│  ─── Activity ─────────────────────────────────────────  │
│  • Status changed: backlog → todo (by user)              │
│  • Claimed by Agent-1 (status → doing)                   │
│  • Comment posted by Agent-1                             │
│  • Mention created → Agent-2                             │
│  • Deliverable posted by Agent-2                         │
│  • Mention resolved by Agent-2                           │
└──────────────────────────────────────────────────────────┘
```

### Kanban Board Interactions

| Interaction        | Action                                                  |
|--------------------|---------------------------------------------------------|
| Drag ticket        | Move between columns (changes status)                   |
| Click ticket       | Open ticket detail in main panel                        |
| Quick create       | Add ticket from title or GitHub issue URL               |
| Filter by repo     | Show only tickets linked to a specific repo             |
| Filter by priority | Show only tickets with selected priority                |
| Filter by session  | Show tickets that have/don't have a linked session      |
| Filter by tag      | Show tickets with specific tags                         |
| Filter favorites   | Show only favorited tickets                             |
| Search             | Full-text search across ticket titles/descriptions      |
| Board selector     | Switch between boards or view "All boards"              |

---

## 8. Data Relationships

### Complete Entity-Relationship Diagram

```
┌──────────────┐
│     USER     │
│──────────────│
│ id (UUID)    │
│ email        │
│ name         │
│ avatar_url   │
│ provider     │──── github | google | local
│ preferences  │
└──────┬───────┘
       │
       │ owns (1 : N)
       │
       ├────────────────────────────────────────────────┐
       │                    │              │             │
       ▼                    ▼              ▼             ▼
┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐
│   GATEWAY    │  │    BOARD     │  │ API TOKEN│  │ SCRATCH  │
│──────────────│  │──────────────│  │──────────│  │  PAD     │
│ id           │  │ id           │  │ id       │  │──────────│
│ name         │  │ name         │  │ name     │  │ key      │
│ hostname     │  │ emoji        │  │ prefix   │  │ content  │
│ status       │  │ repository   │  │ hash     │  └──────────┘
│ last_seen_at │  └──────┬───────┘  │ last_used│
└──────┬───────┘         │          └──────────┘
       │                 │
       │ hosts (1:N)     │ contains (1:N)
       │                 │
       ▼                 ▼
┌──────────────┐  ┌───────────────┐
│   SESSION    │  │    TICKET     │
│──────────────│  │───────────────│
│ id           │  │ id            │
│ type         │  │ title         │
│ status       │  │ description   │
│ tmuxName     │  │ status        │──── backlog|todo|doing|reviewing|done
│ cwd          │  │ priority      │──── none|low|medium|high
│ repository   │  │ assignee      │
│ worktree     │  │ tags[]        │
│ claudePrompt │  │ links[]       │──── → session, worktree, PR, issue, repo
│ gateway_id   │──┤ blocked       │
└──────────────┘  │ favorite      │
     ▲            │ dueDate       │
     │            │ githubMetadata│
     │ linked via └───────┬───────┘
     │ TicketLink         │
     │                    │ has (1:N)
     └────────────────────┤
                          │
            ┌─────────────┼──────────────┬──────────────┐
            │             │              │              │
            ▼             ▼              ▼              ▼
     ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌──────────┐
     │ COMMENT  │  │ MENTION  │  │DELIVERABLE │  │ ACTIVITY │
     │──────────│  │──────────│  │────────────│  │──────────│
     │ id       │  │ id       │  │ id         │  │ id       │
     │ authorTy │  │ target   │  │ agentName  │  │ action   │
     │ authorNm │  │ source   │  │ type       │  │ changes  │
     │ body     │  │ status   │  │ title      │  │ actorTy  │
     │ visibil. │  │ resolved │  │ content    │  │ actorNm  │
     │ private  │  │  At      │  │ version    │  │ source   │
     │ Recipnts │  └──────────┘  │ status     │  └──────────┘
     │ parentId │       │        └────────────┘   (immutable
     └──────────┘       │              │           audit log)
          │             │              │
          │  creates    │   resolves   │
          └─────────────┘──────────────┘
              (mention in comment body
               can be resolved by a
               deliverable or reply)
```

### Key Relationships Summary

| From           | To           | Cardinality | Notes                                     |
|----------------|-------------|-------------|-------------------------------------------|
| User           | Gateway     | 1 : N       | One user can have multiple machines        |
| User           | Board       | 1 : N       | Each user has their own boards             |
| User           | API Token   | 1 : N       | Multiple tokens for different agents       |
| User           | Scratchpad  | 1 : N       | Global + per-repo notes                    |
| Gateway        | Session     | 1 : N       | Sessions run on a specific machine         |
| Board          | Ticket      | 1 : N       | Tickets belong to one board                |
| Ticket         | Comment     | 1 : N       | Conversation thread on a ticket            |
| Ticket         | Mention     | 1 : N       | Agent mentions extracted from comments     |
| Ticket         | Deliverable | 1 : N       | Structured outputs from agents             |
| Ticket         | Activity    | 1 : N       | Immutable audit trail                      |
| Comment        | Mention     | 1 : N       | One comment can mention multiple agents    |
| Comment        | Comment     | 1 : N       | Threaded replies (parent_id)               |
| Mention        | Deliverable | 1 : 1       | Resolution link (optional)                 |
| Mention        | Comment     | 1 : 1       | Resolution link (optional)                 |
| Ticket         | Session     | N : N       | Via TicketLink (soft reference)            |
| Board          | Repository  | 1 : 1       | Optional association                       |

### State Machines Summary

```
GATEWAY STATUS:      online ◄──► offline

SESSION STATUS:      running ──► dead
                     unknown (fallback)

TICKET STATUS:       backlog ──► todo ──► doing ──► reviewing ──► done

MENTION STATUS:      pending ──► acknowledged ──► resolved

DELIVERABLE STATUS:  draft ──► final

COMMENT VISIBILITY:  public | private

CLAUDE ACTIVITY:     idle ──► working ──► executing
                                    └──► waiting_tool_approval
                                    └──► waiting_user_choice
                                    └──► waiting_plan_approval
```

---

## Appendix: Keyboard Shortcuts

| Shortcut        | Action                              |
|-----------------|-------------------------------------|
| `⌥1`           | Switch to Sessions panel             |
| `⌥2`           | Switch to Repositories panel         |
| `⌥3`           | Switch to Tickets panel              |
| `⌥4`           | Switch to Claude Config panel        |
| `⌥6`           | Switch to Scratchpads panel          |
| `⌥7`           | Switch to Cluster panel              |
| `⌥0`           | Switch to Settings panel             |
| `⌘B`           | Toggle nav bar collapse/expand       |
| `⌘K` / `⌘/`   | Open command palette                 |
| `Alt+Shift+P`  | Toggle floating scratchpad           |
| `Alt+Shift+V`  | Toggle scratchpad preview            |

---

*This document reflects the system as of its current implementation. It is intended
to give a UX designer complete understanding of the domain, components, and workflows
without needing to read source code.*
