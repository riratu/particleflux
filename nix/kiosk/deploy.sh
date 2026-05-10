#!/usr/bin/env bash
# Deploy kiosk config to a laptop via SSH.
#
# Usage:
#   ./deploy.sh 192.168.1.230
#   ./deploy.sh 192.168.1.230 192.168.1.231
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSH_USER="eiie"
SSH_OPTS=(-o ConnectTimeout=5)

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <ip> [ip ...]"
  exit 1
fi

for ip in "$@"; do
  echo ""
  echo "── ${ip} ──────────────────────────────"

  echo "  Copying configs..."
  scp "${SSH_OPTS[@]}" -r "${SCRIPT_DIR}"/* "${SSH_USER}@${ip}:/tmp/kiosk/"

  echo "  Rebuilding..."
  ssh "${SSH_OPTS[@]}" -t "${SSH_USER}@${ip}" \
    "sudo cp /tmp/kiosk/* /etc/nixos/ && \
     sudo rm -f /etc/nixos/flake.lock && \
     sudo nixos-rebuild switch --flake /etc/nixos#partikel"

  echo "  OK: ${ip}"
done
