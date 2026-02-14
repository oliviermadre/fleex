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
# Access URL: https://<worktree-name>.127.0.0.1.nip.io
#

# ---------------------------------------------------------------------------
# Shared helpers (loaded from localenv-saas via ~/.localenv-saas/lib symlink)
# ---------------------------------------------------------------------------
_helpers_path = os.path.join(os.getenv('HOME'), '.localenv-saas/lib/tilt_helpers.star')
if not os.path.exists(_helpers_path):
    fail('localenv-saas helpers not found at %s. Run: ln -s /path/to/localenv-saas/lib ~/.localenv-saas/lib' % _helpers_path)

_helpers = load_dynamic(_helpers_path)
sanitize_k8s_name = _helpers['sanitize_k8s_name']
basename = _helpers['basename']
get_worktree_context = _helpers['get_worktree_context']
create_namespace = _helpers['create_namespace']
get_host_ip = _helpers['get_host_ip']

# ---------------------------------------------------------------------------
# Context detection
# ---------------------------------------------------------------------------
_ctx = get_worktree_context()
_self_dir = _ctx.self_dir
_worktree_name = _ctx.worktree_name

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
NAMESPACE    = 'asm-dev'
APP_NAME     = sanitize_k8s_name('asm-' + basename(_self_dir))
HOSTNAME     = _worktree_name + '.127.0.0.1.nip.io'
HOST_HOMEDIR = str(local('echo $HOME', quiet=True)).strip()
HOST_IP      = get_host_ip()

# ---------------------------------------------------------------------------
# Namespace (idempotent — safe to call from multiple Tiltfiles)
# ---------------------------------------------------------------------------
create_namespace(NAMESPACE)

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
        './packages/web/public',
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
        sync(_self_dir + '/packages/web/public', '/app/packages/web/public'),
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
            - name: HOST_GATEWAY_URL
              value: "http://{hostip}:3001"
            - name: HOST_HOMEDIR
              value: "{homedir}"
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
    cert-manager.io/cluster-issuer: "mkcert-ca"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - {host}
      secretName: {app}-tls
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
""".format(app=APP_NAME, ns=NAMESPACE, host=HOSTNAME, homedir=HOST_HOMEDIR, hostip=HOST_IP)))

k8s_resource(
    APP_NAME,
    port_forwards=[],
    labels=['asm'],
    links=[
       link('https://' + HOSTNAME, 'Open'),
    ]
)

print('  ASM: ' + _worktree_name + '  ->  https://' + HOSTNAME)
