#!/usr/bin/env bash
# Assembles docs/factory/prototype.html (one self-contained file) from src/.
set -euo pipefail
cd "$(dirname "$0")"
{
  echo '<title>Fleex Factory</title>'
  echo '<meta name="claude:viewport-fit-sides" content="cover">'
  echo '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&display=swap">'
  echo '<style>'; cat src/style.css; echo '</style>'
  cat src/body.html
  echo '<script>'; cat src/sim.js; echo '</script>'
  echo '<script>'; cat src/render.js; echo '</script>'
  echo '<script>'; cat src/ui.js; echo '</script>'
} > prototype.html
echo "prototype.html: $(wc -c < prototype.html) bytes"
