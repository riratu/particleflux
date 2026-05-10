#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Deploy updated NixOS config to all kiosk laptops via SSH.
# Discovers laptops via avahi (mDNS), or uses a manual list.
#
# Usage:
#   ./deploy.sh                    # discover + deploy to all
#   ./deploy.sh a3f1 b2c0          # deploy to specific laptops
#   ./deploy.sh --list             # just show discovered laptops
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SSH_USER="eiie"
FILES=(
  "${SCRIPT_DIR}/../kiosk/kiosk.nix"
  "${SCRIPT_DIR}/../kiosk/flake.nix"
  "${SCRIPT_DIR}/../kiosk/authorized-keys"
)

# ── Discover kiosk laptops via avahi ──────────────────────────
discover_hosts() {
  avahi-browse -trkp _workstation._tcp 2>/dev/null \
    | grep '^=' \
    | awk -F';' '{print $4}' \
    | grep '^partikel-' \
    | sort -u
}

# ── Parse args ────────────────────────────────────────────────
LIST_ONLY=false
TARGETS=()

for arg in "$@"; do
  case "$arg" in
    --list) LIST_ONLY=true ;;
    --help|-h)
      echo "Usage: $0 [--list] [device-id ...]"
      echo "  --list       Show discovered laptops, don't deploy"
      echo "  device-id    Deploy to specific laptops (e.g. a3f1 b2c0)"
      echo "  (no args)    Discover all laptops and deploy"
      exit 0
      ;;
    *) TARGETS+=("partikel-$arg") ;;
  esac
done

# ── Resolve target list ──────────────────────────────────────
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "Discovering kiosk laptops on the network..."
  mapfile -t TARGETS < <(discover_hosts)

  if [[ ${#TARGETS[@]} -eq 0 ]]; then
    echo "No laptops found. Are they on and connected to the same network?"
    exit 1
  fi
fi

echo "Found ${#TARGETS[@]} laptop(s): ${TARGETS[*]}"

if $LIST_ONLY; then
  printf '%s\n' "${TARGETS[@]}"
  exit 0
fi

# ── Verify config files exist ─────────────────────────────────
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: Missing $f"
    exit 1
  fi
done

# ── Deploy to each laptop ────────────────────────────────────
FAILED=()
SUCCEEDED=()

for host in "${TARGETS[@]}"; do
  echo ""
  echo "── ${host} ──────────────────────────────"

  if ! ping -c1 -W2 "${host}.local" &>/dev/null; then
    echo "  SKIP: ${host}.local not reachable"
    FAILED+=("$host")
    continue
  fi

  echo "  Copying configs..."
  if ! scp -o ConnectTimeout=5 "${FILES[@]}" "${SSH_USER}@${host}.local:/tmp/"; then
    echo "  FAIL: scp failed"
    FAILED+=("$host")
    continue
  fi

  echo "  Rebuilding..."
  if ssh -o ConnectTimeout=5 "${SSH_USER}@${host}.local" \
    "sudo cp /tmp/kiosk.nix /etc/nixos/configuration.nix && \
     sudo cp /tmp/flake.nix /etc/nixos/flake.nix && \
     sudo cp /tmp/authorized-keys /etc/nixos/authorized-keys && \
     sudo nixos-rebuild switch --flake /etc/nixos#partikel" 2>&1; then
    echo "  OK"
    SUCCEEDED+=("$host")
  else
    echo "  FAIL: rebuild failed"
    FAILED+=("$host")
  fi
done

# ── Summary ───────────────────────────────────────────────────
echo ""
echo "===== Deploy summary ====="
echo "  OK:     ${#SUCCEEDED[@]}  ${SUCCEEDED[*]:-}"
echo "  FAILED: ${#FAILED[@]}  ${FAILED[*]:-}"
