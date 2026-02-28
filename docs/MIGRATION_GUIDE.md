# Migration & Setup Guide — Distributed ASM

This guide covers the full setup of the distributed Agent Session Manager:
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
12. [Production deployment (Kubernetes)](#12-production-deployment-kubernetes)
13. [Local development with Tilt / Kind](#13-local-development-with-tilt--kind)
14. [Troubleshooting](#14-troubleshooting)

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

**Central server**: stateless (can run in a K8s pod), stores everything in
PostgreSQL. Serves the React frontend as static files.

**Host gateway**: runs on each developer machine. Provides exec, filesystem,
and PTY access over HTTP + WebSocket. Persists its identity in
`~/.asm/gateway.json`.

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
createdb asm

# Or via SQL:
psql -U postgres -c "CREATE DATABASE asm;"
```

The connection URL format:

```
postgresql://user:password@host:5432/asm
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
| `ASM_CENTRAL_URL` | For registration | — | Central server URL (e.g. `https://asm.example.com`) |
| `GATEWAY_NAME` | No | hostname | Human-readable name for this gateway |
| `GATEWAY_TUNNEL` | No | `true` | Set to `false` to disable the reverse WebSocket tunnel |

---

## 5. Migrating from local JSON storage

If you were running ASM in local-only mode (no PostgreSQL), your data lives
in JSON files on the host filesystem (under `~/.asm/`). To migrate:

1. **Set up PostgreSQL** (section 3 above).
2. **Start the server** with `DATABASE_URL` set — migrations run
   automatically, creating all tables.
3. **Export existing JSON data** (optional — if you want to preserve tickets,
   scratchpads, etc.):

```bash
# Example: read existing tickets JSON
cat ~/.asm/tickets.json | jq .

# Insert into PostgreSQL (you'd write a small script, or re-create
# tickets through the UI).
```

There is no automatic JSON → PostgreSQL migrator at this time. For most
teams, starting fresh is simpler. The host gateway still stores its identity
in `~/.asm/gateway.json` — this is intentional and separate from the
application data.

4. **Remove the local JSON files** once you've verified everything works:

```bash
rm -f ~/.asm/sessions.json ~/.asm/tickets.json ~/.asm/tokens.json
# Keep ~/.asm/gateway.json — it's the gateway identity!
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

Set `ASM_CENTRAL_URL` to have the gateway auto-register:

```bash
ASM_CENTRAL_URL=https://asm.example.com bun run src/main.ts
```

The gateway will:
1. Load (or generate) its identity from `~/.asm/gateway.json`
2. POST to `/internal/gateways/register` on the central server
3. Start a 30-second heartbeat loop
4. Open a reverse WebSocket tunnel (unless `GATEWAY_TUNNEL=false`)

### Identity persistence

The file `~/.asm/gateway.json` contains:

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
DATABASE_URL=postgresql://user:pass@localhost:5432/asm bun run dev:server
```

### Full production example

```bash
export PORT=3000
export DATABASE_URL=postgresql://asm:secret@db.internal:5432/asm
export HOST_GATEWAY_URL=http://gateway-a:3001
export AUTH_CALLBACK_BASE_URL=https://asm.example.com
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
   - **Application name**: `ASM` (or whatever you prefer)
   - **Homepage URL**: `https://asm.example.com`
   - **Authorization callback URL**: `https://asm.example.com/auth/github/callback`
3. Click **Register application**.
4. Copy the **Client ID**.
5. Click **Generate a new client secret** and copy it immediately.

### Step 2: Set environment variables

```bash
export GITHUB_CLIENT_ID=Iv1.abc123def456
export GITHUB_CLIENT_SECRET=your_secret_here
export AUTH_CALLBACK_BASE_URL=https://asm.example.com
export DATABASE_URL=postgresql://...
```

### Step 3: Verify

1. Start the server.
2. Visit `https://asm.example.com/auth/status` — should show:
   ```json
   { "enabled": true, "providers": ["github"] }
   ```
3. Navigate to `https://asm.example.com/auth/github` — you should be
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
   - **Name**: `ASM`
   - **Authorized JavaScript origins**: `https://asm.example.com`
   - **Authorized redirect URIs**: `https://asm.example.com/auth/google/callback`
5. Click **Create** and copy the **Client ID** and **Client Secret**.

> **Note**: You may need to configure the OAuth consent screen first
> (APIs & Services → OAuth consent screen). For internal use, select
> "Internal" user type (Google Workspace only). For external, you'll need
> to submit for verification or stay in testing mode (100 user limit).

### Step 2: Set environment variables

```bash
export GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
export GOOGLE_CLIENT_SECRET=GOCSPX-xxx
export AUTH_CALLBACK_BASE_URL=https://asm.example.com
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
2. Set `ASM_CENTRAL_URL` on each gateway.
3. Each gateway auto-generates its own identity (`~/.asm/gateway.json`).
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
   `wss://asm.example.com/ws/gateway-tunnel?id=<gatewayId>&secret=<secret>`
2. The central server stores this WebSocket connection.
3. When the server needs to call the gateway (exec, fs, etc.), it sends
   the request through the tunnel instead of HTTP.
4. The gateway handles the request locally and sends back the response.

### Configuration

The tunnel is **enabled by default** when `ASM_CENTRAL_URL` is set.
To disable:

```bash
GATEWAY_TUNNEL=false bun run src/main.ts
```

### Reconnection

If the connection drops, the gateway reconnects with exponential backoff:
2s → 4s → 8s → 16s → 32s → 60s (capped).

---

## 12. Production deployment (Kubernetes)

### Architecture

```
┌─────────────────────────────────────────┐
│  Kubernetes cluster                      │
│  ┌─────────────┐  ┌──────────────────┐  │
│  │ asm-server   │  │ PostgreSQL       │  │
│  │ (Deployment) │←→│ (StatefulSet or  │  │
│  │ stateless    │  │  managed RDS)    │  │
│  └──────┬──────┘  └──────────────────┘  │
│         │ Ingress (HTTPS)                │
└─────────┼───────────────────────────────┘
          │
    ┌─────▼─────┐
    │ Gateway   │  ← runs on dev machines, connects inbound
    │ (tunnel)  │     via WebSocket reverse tunnel
    └───────────┘
```

### Deployment manifest (example)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: asm-server
  namespace: asm
spec:
  replicas: 2
  selector:
    matchLabels:
      app: asm-server
  template:
    metadata:
      labels:
        app: asm-server
    spec:
      containers:
        - name: asm-server
          image: your-registry/asm-server:latest
          ports:
            - containerPort: 3000
          env:
            - name: PORT
              value: "3000"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: asm-secrets
                  key: database-url
            - name: GITHUB_CLIENT_ID
              valueFrom:
                secretKeyRef:
                  name: asm-secrets
                  key: github-client-id
            - name: GITHUB_CLIENT_SECRET
              valueFrom:
                secretKeyRef:
                  name: asm-secrets
                  key: github-client-secret
            - name: AUTH_CALLBACK_BASE_URL
              value: "https://asm.example.com"
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "1000m"
---
apiVersion: v1
kind: Service
metadata:
  name: asm-server
  namespace: asm
spec:
  selector:
    app: asm-server
  ports:
    - port: 3000
      targetPort: 3000
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: asm-server
  namespace: asm
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - asm.example.com
      secretName: asm-tls
  rules:
    - host: asm.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: asm-server
                port:
                  number: 3000
```

### PostgreSQL on Kubernetes

Use a managed service (AWS RDS, GCP Cloud SQL, etc.) or deploy via:
- [CloudNativePG operator](https://cloudnative-pg.io/)
- [Zalando Postgres Operator](https://github.com/zalando/postgres-operator)

### Production Dockerfile

```dockerfile
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
COPY tsconfig.base.json ./
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/server/tsconfig.json ./packages/server/
COPY packages/web/tsconfig.json ./packages/web/
RUN curl -fsSL https://bun.sh/install | bash && /root/.bun/bin/bun install
COPY . .
RUN /root/.bun/bin/bun run build

FROM node:20-bookworm-slim
WORKDIR /app
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/web/dist ./packages/web/dist
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/server/src/infrastructure/database ./packages/server/dist/infrastructure/database
RUN npm install --omit=dev --prefix packages/server
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "packages/server/dist/main.js"]
```

> **Important**: The migration SQL files must be included in the production
> image at the expected relative path from `db.ts`.

---

## 13. Local development with Tilt / Kind

The existing Tiltfile already supports live-reload in a Kind cluster.
Here's how to extend it for the distributed setup.

### Prerequisites

- **Kind**: `kind create cluster --name asm-dev`
- **Tilt**: `brew install tilt` (or from https://tilt.dev)
- **mkcert**: for local TLS (self-signed certs trusted by your OS)
- **cert-manager** + mkcert CA issuer in the cluster
- **nginx-ingress** controller

### Setup Kind cluster

```bash
kind create cluster --name asm-dev
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
```

### Install cert-manager + mkcert CA

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml

# Create CA from mkcert
mkcert -install  # trust the CA in your system
kubectl create secret tls mkcert-ca \
  --cert="$(mkcert -CAROOT)/rootCA.pem" \
  --key="$(mkcert -CAROOT)/rootCA-key.pem" \
  -n cert-manager

# Create ClusterIssuer
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: mkcert-ca
spec:
  ca:
    secretName: mkcert-ca
EOF
```

### PostgreSQL for local dev

The simplest approach — run Postgres on the host (outside the cluster):

```bash
# macOS:
brew install postgresql@15 && brew services start postgresql@15
createdb asm

# Or use Docker:
docker run -d --name asm-pg -p 5432:5432 \
  -e POSTGRES_DB=asm -e POSTGRES_PASSWORD=devpass \
  postgres:15
```

Then set `DATABASE_URL` in the Tiltfile's env section.

### SSO with self-signed certs (local dev)

**The challenge**: GitHub and Google OAuth callbacks require HTTPS. With
local self-signed certs, the OAuth flow works in the browser (mkcert CA is
trusted), but the server-side token exchange (server → GitHub/Google) may
fail if Node.js doesn't trust the local CA.

**Solutions**:

1. **Use nip.io domains** (already in the Tiltfile):
   The Tiltfile generates URLs like `https://asm-main.127.0.0.1.nip.io`.
   These resolve to `127.0.0.1` and work with cert-manager + mkcert.

2. **Register the callback URL** with GitHub/Google using the nip.io domain:
   - GitHub callback: `https://asm-main.127.0.0.1.nip.io/auth/github/callback`
   - Google callback: `https://asm-main.127.0.0.1.nip.io/auth/google/callback`

3. **Set AUTH_CALLBACK_BASE_URL** in the Tiltfile:
   ```python
   - name: AUTH_CALLBACK_BASE_URL
     value: "https://asm-main.127.0.0.1.nip.io"
   ```

4. **For the server-side token exchange** (server → GitHub API), Node.js
   doesn't need to trust your local CA — it calls `github.com` /
   `googleapis.com` directly over their real HTTPS certs. So **no
   NODE_EXTRA_CA_CERTS is needed** for the OAuth flow itself.

5. **Alternative: skip SSO in local dev**. If you don't set any
   `GITHUB_CLIENT_ID` / `GOOGLE_CLIENT_ID`, the auth middleware falls back
   to the default local user automatically. This is often the simplest
   approach during development.

### Updated Tiltfile env block (example)

```python
env:
  - name: PORT
    value: "3000"
  - name: HOST_GATEWAY_URL
    value: "http://{hostip}:3001"
  - name: HOST_HOMEDIR
    value: "{homedir}"
  - name: DATABASE_URL
    value: "postgresql://user:pass@{hostip}:5432/asm"
  - name: AUTH_CALLBACK_BASE_URL
    value: "https://{host}"
  # Optional — add these for SSO testing:
  # - name: GITHUB_CLIENT_ID
  #   value: "Iv1.xxx"
  # - name: GITHUB_CLIENT_SECRET
  #   value: "secret"
```

### Run with Tilt

```bash
# Start the host gateway on the developer machine
ASM_CENTRAL_URL=https://asm-main.127.0.0.1.nip.io bun run start:gateway

# Start Tilt (in another terminal)
tilt up
```

Tilt will:
1. Build the Docker image
2. Deploy to the Kind cluster
3. Live-sync source changes (no rebuild on code changes)
4. The gateway connects via tunnel to the in-cluster server

---

## 14. Troubleshooting

### "Authentication required" on every request

- Check `GET /auth/status`. If `enabled: true`, you need to log in.
- If you don't want SSO, remove `GITHUB_CLIENT_ID` and `GOOGLE_CLIENT_ID`
  from the environment.

### Gateway shows "offline"

- Verify the gateway process is running.
- Check that `ASM_CENTRAL_URL` is correct and reachable from the gateway.
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
