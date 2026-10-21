#!/usr/bin/env bash
#
# Stop the CRA dev server(s).
#
#   bash scripts/dev-stop.sh              # stop 3000, 3001, 3002
#   bash scripts/dev-stop.sh 3001 3002    # stop only these ports
#   bash scripts/dev-stop.sh --all        # stop every react-scripts process
#
# "Something is already running on port 3001" → run this, then start again.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RED='\033[31m'
GREEN='\033[32m'
YELLOW='\033[33m'
DIM='\033[2m'
RESET='\033[0m'

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  RED="$(tput setaf 1)"; GREEN="$(tput setaf 2)"; YELLOW="$(tput setaf 3)"
  DIM="$(tput dim)"; RESET="$(tput sgr0)"
else
  # Not a terminal (piped into npm) — no colours, no escape codes.
  RED=''; GREEN=''; YELLOW=''; DIM=''; RESET=''
fi

stop_pid() {
  local pid="$1" label="$2"
  if kill "$pid" 2>/dev/null; then
    printf '  %s✓%s stopped %s (pid %s)\n' "$GREEN" "$RESET" "$label" "$pid"
  else
    printf '  %s!%s could not stop %s (pid %s)\n' "$YELLOW" "$RESET" "$label" "$pid"
  fi
}

# --- mode: every react-scripts process -------------------------------------
if [[ "${1:-}" == "--all" ]]; then
  pids="$(pgrep -f 'react-scripts/scripts/start.js' 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    printf '\n  %sno dev server is running%s\n\n' "$DIM" "$RESET"
    exit 0
  fi
  printf '\n  Stopping every dev server\n'
  for pid in $pids; do stop_pid "$pid" "dev server"; done
  printf '\n'
  exit 0
fi

# --- mode: specific ports --------------------------------------------------
if [[ $# -gt 0 ]]; then
  ports=("$@")
else
  ports=(3000 3001 3002)
fi

printf '\n  Stopping dev servers on ports: %s\n' "${ports[*]}"

found=0
for port in "${ports[@]}"; do
  pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    printf '  %s·%s nothing listening on %s\n' "$DIM" "$RESET" "$port"
    continue
  fi
  found=1
  for pid in $pids; do stop_pid "$pid" "port $port"; done
done

if [[ "$found" == "0" ]]; then
  printf '\n  %snothing was running%s\n\n' "$DIM" "$RESET"
else
  # Give the OS a moment to release the port before the next `npm start`.
  sleep 1
  printf '\n  %sports are free — you can start the dev server again%s\n\n' "$GREEN" "$RESET"
fi
