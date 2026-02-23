# -*- mode: Python -*-
#
# Tiltfile — deploy THIS worktree into a local Kind cluster
# with live-reload (no image rebuild on source changes).
#
# Designed to be include()'d by a central Tiltfile, but also works
# standalone: tilt up
#
# Access URL: https://<branch-name>.<repo-name>.127.0.0.1.nip.io
#

_INFRA_LOCAL = 'infrastructure/local'

# ---------------------------------------------------------------------------
# Shared helpers (loaded from ~/.localenv-saas/lib/tilt_helpers.star)
# ---------------------------------------------------------------------------
_helpers_path = os.path.join(os.getenv('HOME'), '.localenv-saas/lib/tilt_helpers.star')
if not os.path.exists(_helpers_path):
    fail('localenv-saas helpers not found at %s' % _helpers_path)

_helpers = load_dynamic(_helpers_path)
sanitize_k8s_name = _helpers['sanitize_k8s_name']
basename = _helpers['basename']
env_to_yaml = _helpers['env_to_yaml']
get_worktree_context = _helpers['get_worktree_context']
create_namespace = _helpers['create_namespace']
create_ingress = _helpers['create_ingress']
load_env_files = _helpers['load_env_files']
get_hostnames = _helpers['get_hostnames']
get_host_ip = _helpers['get_host_ip']

def _read_yaml(filename, **kwargs):
    """Read a YAML template from infrastructure/local/ and interpolate variables."""
    return str(read_file('./%s/%s' % (_INFRA_LOCAL, filename))).format(**kwargs)

# ---------------------------------------------------------------------------
# Context detection
# ---------------------------------------------------------------------------
_ctx = get_worktree_context()
_self_dir = _ctx.self_dir

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
NAMESPACE    = _ctx.repo_name
APP_NAME     = _ctx.branch_name
HOSTNAMES    = get_hostnames(_ctx)
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
    dockerfile=_self_dir + '/' + _INFRA_LOCAL + '/Dockerfile.dev',
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
        './' + _INFRA_LOCAL + '/Dockerfile.dev',
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
# Env vars from .env / .env.local
# ---------------------------------------------------------------------------
_dotenv = load_env_files(_self_dir)
_EXTRA_ENV = env_to_yaml(_dotenv)

# ---------------------------------------------------------------------------
# Kubernetes resources
# ---------------------------------------------------------------------------
k8s_yaml(blob(_read_yaml('resources.yaml',
    app=APP_NAME, ns=NAMESPACE, homedir=HOST_HOMEDIR, hostip=HOST_IP,
    extra_env=_EXTRA_ENV,
)))

# ---------------------------------------------------------------------------
# Ingress
# ---------------------------------------------------------------------------
k8s_yaml(blob(create_ingress(APP_NAME, HOSTNAMES, NAMESPACE, worktree_name=_ctx.worktree_name)))

k8s_resource(
    APP_NAME,
    port_forwards=[],
    labels=[_ctx.repo_name],
    links=[link('https://' + h, h) for h in HOSTNAMES],
)

print('  %s: %s  ->  %s' % (_ctx.repo_name.upper(), _ctx.branch_name, '  '.join(['https://' + h for h in HOSTNAMES])))
