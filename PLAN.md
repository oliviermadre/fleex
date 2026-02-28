# Secure Gateway Isolation — Single WSS Channel

## Goal

Replace the 3 disconnected communication channels (HTTP direct, WS tunnel, HTTP registration/heartbeat)
with a **single authenticated WebSocket connection** initiated by the gateway toward the server.
This works identically in mono-gateway and multi-gateway setups.

## Current state (what we're replacing)

| Channel | Direction | Transport | Auth | Used for |
|---------|-----------|-----------|------|----------|
| `remote.ts` + `RemoteHostFs` | Server → Gateway | HTTP POST | None (broken) | exec, fs |
| `RemotePtyAdapter` | Server → Gateway | WS `/pty` | None (broken) | PTY streaming |
| `gateway-tunnel-ws.ts` | Gateway → Server | WS `/ws/gateway-tunnel` | `?secret=` in URL | exec, fs (but never wired) |
| `gateway.routes.ts` registration | Gateway → Server | HTTP POST | `x-gateway-registration-token` header | Registration |
| `gateway.routes.ts` heartbeat | Gateway → Server | HTTP POST | `secret` in body | Heartbeat |

## Target state

```
Gateway ──── WSS ────► Server /ws/gateway-tunnel
              │
              ├─ Auth: first message after open = { type: "auth", id, secret }
              ├─ Registration: implicit on successful auth (upsert gateway)
              ├─ Heartbeat: native WS ping/pong
              ├─ exec/fs: JSON request/response with requestId correlation
              └─ PTY: multiplexed binary frames with channelId
```

Single connection. Single auth. Gateway initiates. Server routes through the tunnel registry.

---

## Implementation plan

### Phase 1: Tunnel protocol upgrade (multiplexed PTY)

The existing tunnel only handles JSON request/response. We need binary PTY support.

#### 1.1 Define the wire protocol in `packages/shared`

Create `packages/shared/src/types/tunnel-protocol.ts`:

```
Frame format (all frames):
  [1 byte: frameType] [payload...]

FrameType values:
  0x01 = JSON request/response (existing behavior, just prefixed)
  0x02 = PTY data (binary terminal I/O)
  0x03 = PTY control (JSON: open, resize, exit, error)

JSON request/response (0x01):
  [0x01] [JSON utf-8 bytes]
  The JSON shape is the existing { id, method, path, body } / { id, status, body }

PTY data (0x02):
  [0x02] [4 bytes: channelId uint32BE] [binary payload]

PTY control (0x03):
  [0x03] [JSON utf-8 bytes]
  Shapes:
    Server → Gateway: { channelId, action: "open", tmuxSessionName, cols, rows }
    Server → Gateway: { channelId, action: "resize", cols, rows }
    Gateway → Server: { channelId, action: "opened" }
    Gateway → Server: { channelId, action: "exit", exitCode }
    Gateway → Server: { channelId, action: "error", message }
    Either side:      { channelId, action: "close" }
```

Add shared constants:
- `TUNNEL_FRAME_JSON = 0x01`
- `TUNNEL_FRAME_PTY_DATA = 0x02`
- `TUNNEL_FRAME_PTY_CTRL = 0x03`

#### 1.2 Update `packages/host-gateway/src/tunnel.ts`

Current: receives JSON messages, calls `handleExec`/`handleFs`, sends JSON responses.

Change to:
- Parse the frame type byte from each incoming message.
- `0x01`: existing JSON request/response handling (exec, fs, health).
- `0x02`: route binary PTY data to the correct `Bun.spawn` terminal by channelId.
- `0x03`: handle PTY control messages:
  - `open`: spawn `tmux attach` (reuse logic from `pty.ts`), store handle keyed by channelId.
  - `resize`: call `terminal.resize()` on the matching channelId.
  - `close`: kill the PTY process for that channelId.
- Send outbound PTY data back as `0x02` frames with the channelId.
- Send PTY lifecycle events (opened, exit, error) as `0x03` frames.

#### 1.3 Update `packages/server/src/infrastructure/ws/gateway-tunnel-ws.ts`

Current: `GatewayTunnel` class with `send()` for JSON request/response.

Add to `GatewayTunnel`:
- `openPty(tmuxSessionName, dims)` → returns a `PtyHandle`-compatible object.
  - Allocates a channelId (incrementing uint32).
  - Sends a `0x03` frame `{ channelId, action: "open", tmuxSessionName, cols, rows }`.
  - Waits for `{ channelId, action: "opened" }` confirmation.
  - Returns an object implementing `PtyHandle`:
    - `write(data)` → sends `0x02` frame with channelId + data.
    - `resize(dims)` → sends `0x03` frame `{ channelId, action: "resize", cols, rows }`.
    - `kill()` → sends `0x03` frame `{ channelId, action: "close" }`.
    - `onData(cb)` → registers callback for incoming `0x02` frames with this channelId.
    - `onExit(cb)` → registers callback for incoming `0x03` exit events.

Update the message handler:
- Parse frame type byte.
- `0x01`: existing response routing (match by request id).
- `0x02`: dispatch binary data to the correct PTY channel's `onData` callbacks.
- `0x03`: dispatch control events (opened, exit, error) to the correct channel.

---

### Phase 2: Auth on the tunnel (move secret out of URL)

#### 2.1 Change auth flow in `gateway-tunnel-ws.ts` (server side)

Current: `?id=X&secret=Y` in the URL, validated on upgrade.

Change to:
- Accept connection with only `?id=X` in the URL (no secret).
- On connection, start a 5-second auth timeout.
- Expect the **first message** to be: `{ type: "auth", secret: "<hex>" }`.
- Validate `SHA256(secret)` against `gatewayStore.verifySecret(gatewayId, hash)`.
- If valid: register the tunnel, send back `{ type: "auth_ok" }`.
- If invalid or timeout: `socket.close(4003, "Authentication failed")`.

#### 2.2 Change auth flow in `tunnel.ts` (gateway side)

Current: secret in URL query string.

Change to:
- Connect with only `?id=gatewayId` in the URL.
- On `open`, send `JSON.stringify({ type: "auth", secret: identity.secret })`.
- Wait for `{ type: "auth_ok" }` before processing any tunnel requests.

#### 2.3 Make registration implicit

Current: separate `POST /internal/gateways/register` call on startup.

Change to:
- When the server receives a successful auth on the tunnel:
  - Call `gatewayStore.register(gatewayId, name, hostname, secretHash)` automatically.
  - The gateway sends its `name` and `hostname` in the auth message:
    `{ type: "auth", secret, name, hostname }`.
- Remove `registerWithCentral()` from `gateway/main.ts`.
- Remove `POST /internal/gateways/register` from `gateway.routes.ts`.

#### 2.4 Replace HTTP heartbeat with WS ping/pong

Current: `setInterval(sendHeartbeat, 30_000)` doing HTTP POST.

Change to:
- Server side: the existing `setInterval` in `gateway-tunnel-ws.ts` already sends `socket.ping()` + `gatewayStore.heartbeat()`. Keep it.
- Gateway side: Bun's WebSocket client responds to pings automatically.
- Remove `sendHeartbeat()` from `gateway/main.ts`.
- Remove `POST /internal/gateways/heartbeat` from `gateway.routes.ts`.

---

### Phase 3: Route everything through the tunnel

#### 3.1 Create `TunnelExecAdapter` and `TunnelHostFs` (server side)

New file: `packages/server/src/infrastructure/host/tunnel-adapters.ts`

```typescript
// Implements ExecFn, ShellExecFn, HostFs by routing through a GatewayTunnel.

export function tunnelExec(getTunnel: () => GatewayTunnel | null): ExecFn {
  return async (command, args, options) => {
    const tunnel = getTunnel();
    if (!tunnel) throw new Error('Gateway not connected');
    const res = await tunnel.send('POST', '/exec', { command, args, ...options });
    if (res.error) throw new Error(res.error);
    const body = res.body as { stdout: string; stderr: string; exitCode: number };
    if (body.exitCode !== 0) {
      const err = new Error(body.stderr || `Command failed`) as any;
      err.stdout = body.stdout;
      err.stderr = body.stderr;
      err.code = body.exitCode;
      throw err;
    }
    return { stdout: body.stdout, stderr: body.stderr };
  };
}

// Similar for tunnelShellExec and TunnelHostFs
```

#### 3.2 Create `TunnelPtyAdapter` (server side)

New file: `packages/server/src/infrastructure/host/tunnel-pty.adapter.ts`

Implements `PtyPort` by calling `tunnel.openPty()` (from phase 1.3).

```typescript
export class TunnelPtyAdapter implements PtyPort {
  constructor(private getTunnel: () => GatewayTunnel | null) {}

  spawnAttach(tmuxSessionName: string, dims: TerminalDimensions): PtyHandle {
    const tunnel = this.getTunnel();
    if (!tunnel) throw new Error('Gateway not connected');
    return tunnel.openPty(tmuxSessionName, dims);
  }
}
```

#### 3.3 Rewire `container.ts`

Current:
```typescript
const execFn = remoteExec(gatewayUrl);
const shellExecFn = remoteShellExec(gatewayUrl);
const hostFs = new RemoteHostFs(gatewayUrl);
const ptyAdapter = new RemotePtyAdapter(gatewayUrl, logger);
```

Change to:
```typescript
// Tunnel-based adapters — the getTunnel function is wired after tunnel WS plugin starts.
let activeTunnel: GatewayTunnel | null = null;
const getTunnel = () => activeTunnel;

const execFn = tunnelExec(getTunnel);
const shellExecFn = tunnelShellExec(getTunnel);
const hostFs = new TunnelHostFs(getTunnel);
const ptyAdapter = new TunnelPtyAdapter(getTunnel);
```

The `activeTunnel` reference is set by the tunnel WS plugin when a gateway connects
(and cleared when it disconnects).

In mono-gateway mode, there's exactly one tunnel. In multi-gateway mode, the container
would need a tunnel registry lookup by gatewayId — but that's a follow-up concern.

#### 3.4 Remove `HOST_GATEWAY_URL` dependency

- Delete `remote.ts` (the HTTP direct adapters).
- Delete `remote-pty.adapter.ts` (the direct WS PTY adapter).
- Remove `DEFAULT_GATEWAY_URL` and `gatewayUrl` from `container.ts`.
- Remove `HOST_GATEWAY_URL` from env documentation.

---

### Phase 4: Clean up the gateway's local HTTP server

#### 4.1 Reduce gateway's Bun.serve scope

The gateway still needs a local HTTP server for:
- `GET /health` — local healthcheck (monitoring, readiness probes).
- Nothing else. All exec/fs/pty traffic goes through the tunnel.

Remove from `gateway/main.ts`:
- `POST /exec` handler.
- `POST /fs` handler.
- `WS /pty` handler.
- `verifyLocalAuth()` (no longer needed — no sensitive local endpoints).
- `GATEWAY_REQUIRE_AUTH` env var.

Keep:
- `GET /health` (unauthenticated, non-sensitive).
- The `Bun.serve` binding on `127.0.0.1` for the healthcheck.

#### 4.2 Remove stale server-side routes

In `gateway.routes.ts`:
- Remove `POST /internal/gateways/register`.
- Remove `POST /internal/gateways/heartbeat`.
- Keep `GET /api/gateways` (frontend reads gateway list).
- Keep `DELETE /api/gateways/:id` (frontend removes gateways).
- Keep the stale gateway check interval.

---

### Phase 5: Enforce TLS

#### 5.1 Gateway side

In `tunnel.ts`, when constructing the WebSocket URL:
- If `ASM_CENTRAL_URL` starts with `http://localhost` or `http://127.0.0.1`: allow `ws://` (dev).
- Otherwise: require `wss://`. If the URL is `http://`, convert to `wss://` and log a warning.

Remove `GATEWAY_TLS_VERIFY=false` → `NODE_TLS_REJECT_UNAUTHORIZED=0` escape hatch from
`gateway/main.ts`. If users need custom CAs, they should use `NODE_EXTRA_CA_CERTS` instead.

---

## Files changed (summary)

### New files
- `packages/shared/src/types/tunnel-protocol.ts` — wire protocol constants and types
- `packages/server/src/infrastructure/host/tunnel-adapters.ts` — ExecFn, ShellExecFn, HostFs over tunnel
- `packages/server/src/infrastructure/host/tunnel-pty.adapter.ts` — PtyPort over tunnel

### Modified files
- `packages/host-gateway/src/tunnel.ts` — multiplexed binary protocol, auth handshake, implicit registration
- `packages/host-gateway/src/main.ts` — remove local exec/fs/pty HTTP, remove registration/heartbeat HTTP
- `packages/server/src/infrastructure/ws/gateway-tunnel-ws.ts` — auth handshake, PTY channel multiplexing
- `packages/server/src/infrastructure/container.ts` — wire tunnel-based adapters instead of HTTP direct
- `packages/server/src/infrastructure/http/gateway.routes.ts` — remove register/heartbeat endpoints
- `packages/server/src/main.ts` — remove `HOST_GATEWAY_URL` reference if any
- `packages/shared/src/index.ts` — export new tunnel protocol types

### Deleted files
- `packages/server/src/infrastructure/host/remote.ts` — replaced by tunnel-adapters.ts
- `packages/server/src/infrastructure/host/remote-pty.adapter.ts` — replaced by tunnel-pty.adapter.ts

### Not touched (still works as-is)
- `packages/host-gateway/src/exec.ts` — still handles exec, called by tunnel instead of HTTP
- `packages/host-gateway/src/fs.ts` — still handles fs, called by tunnel instead of HTTP
- `packages/host-gateway/src/pty.ts` — PTY spawn logic reused, called from tunnel message handler
- `packages/host-gateway/src/security-policy.ts` — still enforces policy on exec/fs
- `packages/host-gateway/src/audit-log.ts` — still logs exec/fs events
- `packages/server/src/infrastructure/host/types.ts` — ExecFn, ShellExecFn, HostFs interfaces unchanged

## Implementation order

Phase 1 → 2 → 3 → 4 → 5 (sequential, each phase builds on the previous).

Within Phase 1, steps 1.1 → 1.2 + 1.3 (1.2 and 1.3 can be done in parallel once 1.1 is done).
Phase 2 can be done independently of Phase 1's PTY work (it only touches the auth flow),
but it's cleaner to do Phase 1 first so the frame-type prefix is already in place.
