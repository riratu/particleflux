#!/usr/bin/env bash
# Setup a new kiosk laptop from PXE boot.
#
# Run from the repo root or the nix/kiosk/ directory.
#
# Prerequisites:
#   - Laptop booted via PXE (NixOS installer)
#   - Laptop connected to LAN
#   - Password set on installer: passwd
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSH_USER="nixos"
SSH_OPTS=(-o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=5)

echo "── Kiosk laptop setup ──────────────────────────"
echo ""
echo "On the laptop:"
echo "  1. PXE boot into NixOS installer"
echo "  2. Connect to LAN"
echo "  3. Run: ip a        (note the IP)"
echo "  4. Run: passwd      (set a temporary password)"
echo ""

IP="${1:-}"
if [[ -z "$IP" ]]; then
  read -rp "Laptop IP: " IP
  [[ -z "$IP" ]] && { echo "No IP given."; exit 1; }
fi

echo ""
echo "  Copying kiosk files to ${SSH_USER}@${IP}..."
scp "${SSH_OPTS[@]}" -r "${SCRIPT_DIR}" "${SSH_USER}@${IP}:~/kiosk"

echo "  Running install.sh on ${IP}..."
ssh "${SSH_OPTS[@]}" -t "${SSH_USER}@${IP}" "cd ~/kiosk && sudo ./install.sh"

echo ""
echo "Done. Reboot the laptop."
