# -*- mode: Python -*-
#
# Tiltfile — auto-discovers ALL git worktrees and deploys each one
# into the local Kind cluster with live-reload.
#
# Usage:
#   tilt up      # from ANY worktree — deploys all of them
#   tilt down    # tear down everything
#
# Each worktree gets its own Deployment/Service/Ingress, accessible at:
#   http://<worktree-name>.127.0.0.1.nip.io
#
# To pick up a newly created worktree, restart Tilt (ctrl-c + tilt up).
#

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _sanitize_k8s_name(s):
    """Lowercase, replace non-[a-z0-9-] with '-', trim leading/trailing '-'."""
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
    name = ''.join(out)
    name = name.strip('-')
    if len(name) > 63:
        name = name[:63]
    return name

def _basename(path):
    parts = path.split('/')
    if parts[-1] != '':
        return parts[-1]
    return parts[-2]

# ---------------------------------------------------------------------------
# Discover all git worktrees
# ---------------------------------------------------------------------------
_wt_raw = str(local('git worktree list --porcelain', quiet=True))
_worktree_paths = []

for _line in _wt_raw.split('\n'):
    if _line.startswith('worktree '):
        _worktree_paths.append(_line[len('worktree '):])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
NAMESPACE = 'asm-dev'

k8s_yaml(blob("""
apiVersion: v1
kind: Namespace
metadata:
  name: {ns}
""".format(ns=NAMESPACE)))

# ---------------------------------------------------------------------------
# Deploy each worktree that has the infra files
# ---------------------------------------------------------------------------
_deployed = []

for _wt_path in _worktree_paths:
    # Skip worktrees that don't have the Dockerfile yet
    _check = str(local(
        'test -f "' + _wt_path + '/Dockerfile.dev" && echo yes || echo no',
        quiet=True,
    )).strip()
    if _check != 'yes':
        print('  SKIP ' + _basename(_wt_path) + ' (no Dockerfile.dev)')
        continue

    _wt_name = _sanitize_k8s_name(_basename(_wt_path))
    _app     = 'asm-' + _wt_name
    _host    = _wt_name + '.127.0.0.1.nip.io'

    # -- Docker image + live_update ----------------------------------------
    docker_build(
        _app,
        _wt_path,
        dockerfile=_wt_path + '/Dockerfile.dev',
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
                _wt_path + '/packages/web/vite.config.ts',
                _wt_path + '/tsconfig.base.json',
                _wt_path + '/packages/shared/tsconfig.json',
                _wt_path + '/packages/server/tsconfig.json',
                _wt_path + '/packages/web/tsconfig.json',
            ]),
            sync(_wt_path + '/packages/shared/src', '/app/packages/shared/src'),
            sync(_wt_path + '/packages/server/src', '/app/packages/server/src'),
            sync(_wt_path + '/packages/web/src',    '/app/packages/web/src'),
            sync(_wt_path + '/packages/web/index.html', '/app/packages/web/index.html'),
            run(
                'cd /app && bun install',
                trigger=[
                    _wt_path + '/package.json',
                    _wt_path + '/bun.lock',
                    _wt_path + '/packages/shared/package.json',
                    _wt_path + '/packages/server/package.json',
                    _wt_path + '/packages/web/package.json',
                ],
            ),
        ],
    )

    # -- K8s manifests -----------------------------------------------------
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
""".format(app=_app, ns=NAMESPACE, host=_host)))

    k8s_resource(
        _app,
        port_forwards=[],
        labels=['asm'],
    )

    _deployed.append((_wt_name, _host))

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
print('============================================================')
print('  Deployed worktrees:')
for _d in _deployed:
    print('    ' + _d[0] + '  ->  http://' + _d[1])
print('============================================================')
