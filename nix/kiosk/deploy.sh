#!/usr/bin/env bash
# Deploy kiosk config to a laptop via SSH.
#
# Usage:
#   ./deploy.sh                          # auto-discover all kiosks
#   ./deploy.sh 192.168.1.230
#   ./deploy.sh partikel-46d1.local partikel-a3f1.local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSH_USER="eiie"
SSH_OPTS=(-o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)

if [[ $# -eq 0 ]]; then
  echo "Discovering kiosks via avahi..."
  mapfile -t HOSTS < <(avahi-browse -tpr _partikel._tcp | awk -F';' '/^=/{print $7}' | sort -u)
  if [[ ${#HOSTS[@]} -eq 0 ]]; then
    echo "No kiosks found."
    exit 1
  fi
  echo "Found: ${HOSTS[*]}"
  read -rp "Deploy to all? [Y/n] " confirm
  [[ "$confirm" =~ ^[nN]$ ]] && exit 0
  set -- "${HOSTS[@]}"
fi

echo ""
echo "Rebuild after copying?"
echo "  1) Yes, rebuild remotely (default)"
echo "  2) No, copy only (rebuild later on client with 'rebuild')"
read -rp "Choice [1]: " choice
choice="${choice:-1}"

for ip in "$@"; do
  echo ""
  echo "── ${ip} ──────────────────────────────"

  echo "  Copying configs..."
  scp "${SSH_OPTS[@]}" -r "${SCRIPT_DIR}"/* "${SSH_USER}@${ip}:/tmp/kiosk/"

  echo "  Generating hostname.nix..."
  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${ip}" \
    'ID=$(cat /etc/device-id 2>/dev/null || echo 0); \
     echo "{ networking.hostName = \"partikel-$ID\"; }" | sudo tee /etc/nixos/hostname.nix > /dev/null'

  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${ip}" \
    "sudo cp /tmp/kiosk/* /etc/nixos/"

  if [[ "$choice" == "1" ]]; then
    echo "  Rebuilding..."
    ssh "${SSH_OPTS[@]}" -t "${SSH_USER}@${ip}" \
      "sudo nixos-rebuild switch --flake /etc/nixos#partikel"
  else
    echo "  Configs copied. Run 'rebuild' on the client to apply."
  fi

  echo "  OK: ${ip}"
done
