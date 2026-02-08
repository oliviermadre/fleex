# -*- mode: Python -*-
#
# Tiltfile — deploy THIS worktree into a local Kind cluster
# with live-reload (no image rebuild on source changes).
#
# Designed to be include()'d by a central Tiltfile, but also works
# standalone: tilt up
#
# The central Tiltfile sets `worktree_context` before include().
# In standalone mode, we fall back to config.main_dir.
#
# Access URL: http://<worktree-name>.127.0.0.1.nip.io
#

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _sanitize_k8s_name(s):
    allowed = 'abcdefghijklmnopqrstuvwxyz0123456789-'
    out = []
    for i in range(len(s)):
        c = s[i]
        if c >= 'A' and c <= 'Z':
            c = chr(ord(c) + 32)
        if c in allowed:
            out.append(c)
        else:
            out.append('-')
    name = ''.join(out).strip('-')
    if len(name) > 63:
        name = name[:63]
    return name

def _basename(path):
    parts = path.split('/')
    return parts[-1] if parts[-1] != '' else parts[-2]

# ---------------------------------------------------------------------------
# Context detection
# ---------------------------------------------------------------------------
# When include()'d from the central Tiltfile, `worktree_context` is set
# to the absolute path of this worktree BEFORE the include() call.
# When running standalone (tilt up), it won't exist — detect via main_dir.
_self_dir = str(config.main_dir)
_worktree_name = _sanitize_k8s_name(_basename(_self_dir))

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
NAMESPACE  = 'asm-dev'
APP_NAME   = 'asm-' + _worktree_name
HOSTNAME   = _worktree_name + '.127.0.0.1.nip.io'

# ---------------------------------------------------------------------------
# Namespace (idempotent — safe to call from multiple Tiltfiles)
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
    _self_dir,
    dockerfile=_self_dir + '/Dockerfile.dev',
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
        fall_back_on([
            _self_dir + '/packages/web/vite.config.ts',
            _self_dir + '/tsconfig.base.json',
            _self_dir + '/packages/shared/tsconfig.json',
            _self_dir + '/packages/server/tsconfig.json',
            _self_dir + '/packages/web/tsconfig.json',
        ]),
        sync(_self_dir + '/packages/shared/src', '/app/packages/shared/src'),
        sync(_self_dir + '/packages/server/src', '/app/packages/server/src'),
        sync(_self_dir + '/packages/web/src',    '/app/packages/web/src'),
        sync(_self_dir + '/packages/web/index.html', '/app/packages/web/index.html'),
        run(
            'cd /app && bun install',
            trigger=[
                _self_dir + '/package.json',
                _self_dir + '/bun.lock',
                _self_dir + '/packages/shared/package.json',
                _self_dir + '/packages/server/package.json',
                _self_dir + '/packages/web/package.json',
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

k8s_resource(
    APP_NAME,
    port_forwards=[],
    labels=['asm'],
)

print('  ASM: ' + _worktree_name + '  ->  http://' + HOSTNAME)
