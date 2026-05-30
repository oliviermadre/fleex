# Shared base image for the Fleex test-stack services (gateway, server, web).
#
# All three run under Bun in --watch mode. The repository is bind-mounted at
# runtime (see docker-compose.test.yml) so source edits are picked up live,
# while node_modules lives in a named volume so the container's installed
# dependencies never clash with (or leak into) the host tree.
FROM oven/bun:1.3.11

# The `desktop` workspace depends on Electron. The test stack never runs it,
# so skip the ~200MB binary download — the plist postinstall hook no-ops when
# the bundle is absent.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

WORKDIR /app

# Copy only the manifests first so `bun install` is cached across source edits.
COPY package.json bun.lock ./
COPY packages/shared/package.json   packages/shared/package.json
COPY packages/server/package.json   packages/server/package.json
COPY packages/web/package.json      packages/web/package.json
COPY packages/cli/package.json      packages/cli/package.json
COPY packages/desktop/package.json  packages/desktop/package.json
# Needed by the desktop postinstall hook during install.
COPY packages/desktop/scripts       packages/desktop/scripts

RUN bun install

# gateway / server / web
EXPOSE 3000 3001 5173
