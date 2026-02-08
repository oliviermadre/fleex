# -*- mode: Python -*-
#
# Tiltfile — deploy the current worktree into a local Kind cluster
# with live-reload (no image rebuild on source changes).
#
# Usage:
#   tilt up          # start watching + deploy
#   tilt down        # tear down resources
#
# Each worktree gets its own Deployment/Service/Ingress, accessible at:
#   http://<worktree-name>.127.0.0.1.nip.io
#

# ---------------------------------------------------------------------------
# Worktree detection (pure Starlark — no import os/re)
# ---------------------------------------------------------------------------
# config.main_dir is a Tilt built-in: absolute path of the Tiltfile directory
_parts = str(config.main_dir).split('/')
_raw   = _parts[-1] if _parts[-1] != '' else _parts[-2]

def _sanitize_k8s_name(s):
    """Lowercase, replace non-[a-z0-9-] with '-', trim leading/trailing '-'."""
    allowed = 'abcdefghijklmnopqrstuvwxyz0123456789-'
    out = []
    for i in range(len(s)):
        c = s[i]
        # manual lowercase
        if c >= 'A' and c <= 'Z':
            c = chr(ord(c) + 32)
        if c in allowed:
            out.append(c)
        else:
            out.append('-')
    name = ''.join(out)
    # strip leading/trailing dashes
    name = name.strip('-')
    if len(name) > 63:
        name = name[:63]
    return name

worktree_name = _sanitize_k8s_name(_raw)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
NAMESPACE  = 'asm-dev'
APP_NAME   = 'asm-' + worktree_name
HOSTNAME   = worktree_name + '.127.0.0.1.nip.io'

# ---------------------------------------------------------------------------
# Namespace (idempotent)
# ---------------------------------------------------------------------------
k8s_yaml(blob("""
apiVersion: v1
kind: Namespace
metadata:
  name: {ns}
""".format(ns=NAMESPACE)))

# ---------------------------------------------------------------------------
# Docker image + live_update
# ---------------------------------------------------------------------------
docker_build(
    APP_NAME,
    '.',
    dockerfile='Dockerfile.dev',
    # Only watch directories that matter — avoids spurious rebuilds
    only=[
        './packages/shared/src',
        './packages/server/src',
        './packages/web/src',
        './packages/web/index.html',
        './packages/web/vite.config.ts',
        './package.json',
        './bun.lock',
        './packages/shared/package.json',
        './packages/server/package.json',
        './packages/web/package.json',
        './tsconfig.base.json',
        './packages/shared/tsconfig.json',
        './packages/server/tsconfig.json',
        './packages/web/tsconfig.json',
        './Dockerfile.dev',
    ],
    live_update=[
        # Config changes require a full image rebuild (Vite must restart)
        fall_back_on([
            './packages/web/vite.config.ts',
            './tsconfig.base.json',
            './packages/shared/tsconfig.json',
            './packages/server/tsconfig.json',
            './packages/web/tsconfig.json',
        ]),
        # Sync source trees — tsx watch + Vite HMR pick changes up instantly
        sync('./packages/shared/src', '/app/packages/shared/src'),
        sync('./packages/server/src', '/app/packages/server/src'),
        sync('./packages/web/src',    '/app/packages/web/src'),
        sync('./packages/web/index.html', '/app/packages/web/index.html'),
        # Re-install deps only when manifests change
        run(
            'cd /app && bun install',
            trigger=[
                './package.json',
                './bun.lock',
                './packages/shared/package.json',
                './packages/server/package.json',
                './packages/web/package.json',
            ],
        ),
    ],
)

# ---------------------------------------------------------------------------
# Kubernetes resources
# ---------------------------------------------------------------------------
k8s_yaml(blob("""
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {app}
  namespace: {ns}
  labels:
    app: {app}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: {app}
  template:
    metadata:
      labels:
        app: {app}
    spec:
      containers:
        - name: app
          image: {app}
          ports:
            - containerPort: 5173
              name: web
            - containerPort: 3000
              name: api
          env:
            - name: PORT
              value: "3000"
          resources:
            requests:
              memory: "512Mi"
              cpu: "250m"
            limits:
              memory: "1Gi"
              cpu: "1000m"
---
apiVersion: v1
kind: Service
metadata:
  name: {app}
  namespace: {ns}
spec:
  selector:
    app: {app}
  ports:
    - name: web
      port: 80
      targetPort: 5173
    - name: api
      port: 3000
      targetPort: 3000
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {app}
  namespace: {ns}
  annotations:
    # Long timeouts for WebSocket connections (terminal + HMR)
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  ingressClassName: nginx
  rules:
    - host: {host}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {app}
                port:
                  number: 80
""".format(app=APP_NAME, ns=NAMESPACE, host=HOSTNAME)))

# ---------------------------------------------------------------------------
# Tilt resource configuration
# ---------------------------------------------------------------------------
k8s_resource(
    APP_NAME,
    port_forwards=[],      # No local port-forwards — use Ingress DNS instead
    labels=['asm'],
)

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
print('============================================================')
print('  Worktree : ' + worktree_name)
print('  URL      : http://' + HOSTNAME)
print('============================================================')
