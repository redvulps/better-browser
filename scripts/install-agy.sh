#!/usr/bin/env bash
set -euo pipefail
project=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
config="${HOME}/.gemini/config"
test -f "$project/dist/mcp.js" || { echo 'Execute npm run build primeiro.' >&2; exit 1; }
link() {
  local src=$1 dst=$2
  if [[ -e "$dst" || -L "$dst" ]]; then
    [[ "$src" -ef "$dst" ]] || { echo "Já existe outra configuração em $dst" >&2; return 1; }
  else
    mkdir -p "$(dirname -- "$dst")"
    ln -s "$src" "$dst"
  fi
}
link "$project/.agents/skills/better-browser/SKILL.md" "$config/skills/better-browser/SKILL.md"
link "$project/.agents/rules/better-browser.md" "$config/rules/better-browser.md"
agy mcp add better-browser "$(node -p process.execPath)" "$project/dist/mcp.js"
