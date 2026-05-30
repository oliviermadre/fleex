#!/usr/bin/env bash
# Take a screenshot of a running Fleex test stack.
#
#   ./test-stack/shot.sh [path-or-url] [output.png] [--full]
#
# Examples:
#   ./test-stack/shot.sh                 # home, auto-named file
#   ./test-stack/shot.sh /board board.png
#   ./test-stack/shot.sh / home.png --full
#
# Output lands in test-stack/screenshots/.
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose -f docker-compose.test.yml --profile tools run --rm --build screenshot "$@"

echo "→ test-stack/screenshots/"
