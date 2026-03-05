# Migration & Setup Guide — Distributed Fleex

This guide covers the full setup of the distributed Fleex:
central server (Fastify) + host gateway (Bun) + PostgreSQL, with optional
OAuth SSO (GitHub / Google) and WebSocket reverse tunnel for NAT traversal.

---

## Table of Contents

1. [Architecture overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [PostgreSQL setup](#3-postgresql-setup)
4. [Environment variables reference](#4-environment-variables-reference)
5. [Migrating from local JSON storage](#5-migrating-from-local-json-storage)
6. [Host gateway setup](#6-host-gateway-setup)
7. [Central server setup](#7-central-server-setup)
8. [OAuth SSO — GitHub](#8-oauth-sso--github)
9. [OAuth SSO — Google](#9-oauth-sso--google)
10. [Multi-gateway (multiple machines)](#10-multi-gateway-multiple-machines)
11. [Network tunnel (NAT traversal)](#11-network-tunnel-nat-traversal)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Architecture overview

```
┌──────────────────────────────────────────────────────────┐
│                     User browser                          │
│                  React SPA (Vite)                          │
└────────────────────────┬─────────────────────────────────┘
                         │ HTTPS
┌────────────────────────▼─────────────────────────────────┐
│              Central server (Fastify)                      │
│  • API + WebSocket hub                                     │
│  • OAuth SSO / session management                          │
│  • PostgreSQL storage (tickets, boards, sessions, KV)      │
│  • Gateway registry + tunnel hub                           │
└──────┬──────────────────────────────────┬────────────────┘
       │ HTTP or WebSocket tunnel          │ HTTP or tunnel
┌──────▼──────┐                    ┌───────▼─────┐
│ Gateway A   │                    │ Gateway B   │
│ (home PC)   │                    │ (work Mac)  │
│ Bun server  │                    │ Bun server  │
│ tmux/pty/fs │                    │ tmux/pty/fs │
└─────────────┘                    └─────────────┘
```

**Central server**: stateless, stores everything in
PostgreSQL. Serves the React frontend as static files.

**Host gateway**: runs on each developer machine. Provides exec, filesystem,
and PTY access over HTTP + WebSocket. Persists its identity in
`~/.fleex/gateway.json`.

---

## 2. Prerequisites

- **Bun** ≥ 1.1 (gateway + dev server)
- **Node.js** ≥ 20 (central server production build)
- **PostgreSQL** ≥ 15 (production storage)
- **Git** (for worktree features)
- **tmux** (on each gateway host)

```bash
# Install bun
curl -fsSL https://bun.sh/install | bash

# Verify
bun --version
```

---

## 3. PostgreSQL setup

### Create the database

```bash
# As postgres superuser:
createdb fleex

# Or via SQL:
psql -U postgres -c "CREATE DATABASE fleex;"
```

The connection URL format:

```
postgresql://user:password@host:5432/fleex
```

**Migrations are automatic**: the server runs all pending SQL migrations from
`packages/server/src/infrastructure/database/migrations/` on startup. A
`_migrations` tracking table keeps state.

A default local user is seeded automatically:
`00000000-0000-0000-0000-000000000000` (used when no OAuth is configured).

### Schema overview

| Table | Purpose |
|-------|---------|
| `users` | OAuth user accounts |
| `gateways` | Registered host gateways per user |
| `boards` | Kanban boards (JSONB data) |
| `tickets` | Tickets with status + JSONB payload |
| `ticket_activity` | Activity log per ticket |
| `sessions` | tmux session records per user/gateway |
| `user_kv` | Key-value store (scratchpads, prefs) |
| `api_tokens` | Personal access tokens (hashed) |
| `user_sessions` | Server-side HTTP sessions (OAuth) |
| `_migrations` | Migration tracking |

---

## 4. Environment variables reference

### Central server (`packages/server`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP port for the Fastify server |
| `DATABASE_URL` | For Postgres | — | PostgreSQL connection URL. If omitted, JSON file storage is used |
| `HOST_GATEWAY_URL` | No | `http://localhost:3001` | URL of the default host gateway |
| `HOST_HOMEDIR` | No | OS homedir | Override the home directory path on the gateway host |
| `GITHUB_CLIENT_ID` | For GitHub SSO | — | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | For GitHub SSO | — | GitHub OAuth App client secret |
| `GOOGLE_CLIENT_ID` | For Google SSO | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For Google SSO | — | Google OAuth client secret |
| `AUTH_CALLBACK_BASE_URL` | For SSO | `http://localhost:3000` | Public URL of the server (used to build OAuth callback URLs) |

### Host gateway (`packages/host-gateway`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GATEWAY_PORT` | No | `3001` | HTTP port for the gateway |
| `FLEEX_CENTRAL_URL` | For registration | — | Central server URL (e.g. `https://fleex.example.com`) |
| `GATEWAY_NAME` | No | hostname | Human-readable name for this gateway |
| `GATEWAY_TUNNEL` | No | `true` | Set to `false` to disable the reverse WebSocket tunnel |

---

## 5. Migrating from local JSON storage

If you were running Fleex in local-only mode (no PostgreSQL), your data lives
in JSON files on the host filesystem (under `~/.fleex/`). To migrate:

1. **Set up PostgreSQL** (section 3 above).
2. **Start the server** with `DATABASE_URL` set — migrations run
   automatically, creating all tables.
3. **Export existing JSON data** (optional — if you want to preserve tickets,
   scratchpads, etc.):

```bash
# Example: read existing tickets JSON
cat ~/.fleex/tickets.json | jq .

# Insert into PostgreSQL (you'd write a small script, or re-create
# tickets through the UI).
```

There is no automatic JSON → PostgreSQL migrator at this time. For most
teams, starting fresh is simpler. The host gateway still stores its identity
in `~/.fleex/gateway.json` — this is intentional and separate from the
application data.

4. **Remove the local JSON files** once you've verified everything works:

```bash
rm -f ~/.fleex/sessions.json ~/.fleex/tickets.json ~/.fleex/tokens.json
# Keep ~/.fleex/gateway.json — it's the gateway identity!
```

---

## 6. Host gateway setup

The gateway runs on each developer's machine and provides host access
(tmux, shell, filesystem) to the central server.

### Install & run

```bash
cd packages/host-gateway
bun install
bun run src/main.ts
```

Output:
```
Host gateway listening on http://localhost:3001
Gateway ID: a1b2c3d4-...
Gateway name: my-macbook
```

### Register with central server

Set `FLEEX_CENTRAL_URL` to have the gateway auto-register:

```bash
FLEEX_CENTRAL_URL=https://fleex.example.com bun run src/main.ts
```

The gateway will:
1. Load (or generate) its identity from `~/.fleex/gateway.json`
2. POST to `/internal/gateways/register` on the central server
3. Start a 30-second heartbeat loop
4. Open a reverse WebSocket tunnel (unless `GATEWAY_TUNNEL=false`)

### Identity persistence

The file `~/.fleex/gateway.json` contains:

```json
{
  "id": "uuid-v4",
  "secret": "64-char-hex"
}
```

This survives restarts and ensures the gateway keeps the same identity.
Back it up if needed; deleting it forces a new registration.

---

## 7. Central server setup

### Development

```bash
# From the repo root — starts gateway + server + web (Vite)
bun run dev
```

Or individually:
```bash
bun run dev:gateway   # packages/host-gateway
bun run dev:server    # packages/server (Fastify)
bun run dev:web       # packages/web (Vite)
```

### Production build

```bash
bun run build   # builds shared → web → server
bun run start   # NODE_ENV=production node packages/server/dist/main.js
```

The production server serves the React frontend as static files from
`packages/web/dist/`.

### With PostgreSQL

```bash
DATABASE_URL=postgresql://user:pass@localhost:5432/fleex bun run dev:server
```

### Full production example

```bash
export PORT=3000
export DATABASE_URL=postgresql://fleex:secret@db.internal:5432/fleex
export HOST_GATEWAY_URL=http://gateway-a:3001
export AUTH_CALLBACK_BASE_URL=https://fleex.example.com
export GITHUB_CLIENT_ID=Iv1.abc123
export GITHUB_CLIENT_SECRET=ghsecret_xxx
node packages/server/dist/main.js
```

---

## 8. OAuth SSO — GitHub

### Step 1: Create a GitHub OAuth App

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
   (or your organization's settings for org-level apps).
2. Fill in:
   - **Application name**: `Fleex` (or whatever you prefer)
   - **Homepage URL**: `https://fleex.example.com`
   - **Authorization callback URL**: `https://fleex.example.com/auth/github/callback`
3. Click **Register application**.
4. Copy the **Client ID**.
5. Click **Generate a new client secret** and copy it immediately.

### Step 2: Set environment variables

```bash
export GITHUB_CLIENT_ID=Iv1.abc123def456
export GITHUB_CLIENT_SECRET=your_secret_here
export AUTH_CALLBACK_BASE_URL=https://fleex.example.com
export DATABASE_URL=postgresql://...
```

### Step 3: Verify

1. Start the server.
2. Visit `https://fleex.example.com/auth/status` — should show:
   ```json
   { "enabled": true, "providers": ["github"] }
   ```
3. Navigate to `https://fleex.example.com/auth/github` — you should be
   redirected to GitHub's authorization page.
4. After granting access, you'll be redirected back and logged in.

### Scopes requested

- `read:user` — read user profile
- `user:email` — access email addresses (to find the primary verified email)

---

## 9. OAuth SSO — Google

### Step 1: Create OAuth credentials in Google Cloud Console

1. Go to **Google Cloud Console → APIs & Services → Credentials**.
2. Click **Create Credentials → OAuth Client ID**.
3. Select **Web application**.
4. Set:
   - **Name**: `Fleex`
   - **Authorized JavaScript origins**: `https://fleex.example.com`
   - **Authorized redirect URIs**: `https://fleex.example.com/auth/google/callback`
5. Click **Create** and copy the **Client ID** and **Client Secret**.

> **Note**: You may need to configure the OAuth consent screen first
> (APIs & Services → OAuth consent screen). For internal use, select
> "Internal" user type (Google Workspace only). For external, you'll need
> to submit for verification or stay in testing mode (100 user limit).

### Step 2: Set environment variables

```bash
export GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET=GOCSPX-xxx
export AUTH_CALLBACK_BASE_URL=https://fleex.example.com
export DATABASE_URL=postgresql://...
```

### Step 3: Verify

Same flow as GitHub — visit `/auth/google` and verify the redirect.

### Scopes requested

- `openid` — OpenID Connect
- `email` — email address
- `profile` — name and avatar

---

## 10. Multi-gateway (multiple machines)

Each developer can register multiple gateways (e.g., home PC + work laptop).
The central server tracks them in the `gateways` table.

### How it works

1. Install the host gateway on each machine (section 6).
2. Set `FLEEX_CENTRAL_URL` on each gateway.
3. Each gateway auto-generates its own identity (`~/.fleex/gateway.json`).
4. The central server registers them under the current user.
5. In the UI, use `GET /api/gateways` to list gateways and switch between them.
6. Gateways show status: `online` (heartbeat < 90s) or `offline`.
7. `DELETE /api/gateways/:id` removes a gateway.

### Gateway switching

The frontend can present a gateway selector (similar to Arc Browser profiles).
When switching, update the `HOST_GATEWAY_URL` context for the user's session,
or use the tunnel to reach the selected gateway.

---

## 11. Network tunnel (NAT traversal)

When a gateway is behind NAT or a firewall (no inbound ports), it uses a
WebSocket reverse tunnel to let the central server reach it.

### How it works

1. The gateway connects **outbound** to the central server:
   `wss://fleex.example.com/ws/gateway-tunnel?id=<gatewayId>&secret=<secret>`
2. The central server stores this WebSocket connection.
3. When the server needs to call the gateway (exec, fs, etc.), it sends
   the request through the tunnel instead of HTTP.
4. The gateway handles the request locally and sends back the response.

### Configuration

The tunnel is **enabled by default** when `FLEEX_CENTRAL_URL` is set.
To disable:

```bash
GATEWAY_TUNNEL=false bun run src/main.ts
```

### Reconnection

If the connection drops, the gateway reconnects with exponential backoff:
2s → 4s → 8s → 16s → 32s → 60s (capped).

---

## 12. Troubleshooting

### "Authentication required" on every request

- Check `GET /auth/status`. If `enabled: true`, you need to log in.
- If you don't want SSO, remove `GITHUB_CLIENT_ID` and `GOOGLE_CLIENT_ID`
  from the environment.

### Gateway shows "offline"

- Verify the gateway process is running.
- Check that `FLEEX_CENTRAL_URL` is correct and reachable from the gateway.
- Look for heartbeat errors in the gateway logs.
- The stale threshold is 90 seconds (3 missed heartbeats).

### Tunnel not connecting

- Check `[tunnel] Connecting to ...` in gateway logs.
- Ensure the central server's WebSocket endpoint is accessible
  (no proxy stripping the `Upgrade` header).
- Nginx: set `proxy_read_timeout` and `proxy_send_timeout` to 3600+.
- Verify `GATEWAY_TUNNEL` is not set to `false`.

### OAuth callback errors

- **`state_mismatch`**: The CSRF state cookie wasn't sent back. Check
  `SameSite` cookie settings and that the callback URL domain matches.
- **`exchange_failed`**: The server couldn't exchange the code for a token.
  Check client ID/secret are correct. Check server logs.
- **`missing_params`**: The callback didn't receive `code` and `state`
  query parameters. The user may have denied access.

### Database connection errors

- Verify `DATABASE_URL` is correct.
- Check that PostgreSQL is running and accepting connections.
- Verify the database exists: `psql $DATABASE_URL -c "SELECT 1"`.
- Check connection pool limits (default: 10 max connections).

### Migration failures

- Migrations run in transactions — a failure rolls back cleanly.
- Check the `_migrations` table to see what has been applied.
- Manually fix the SQL issue and restart the server.
