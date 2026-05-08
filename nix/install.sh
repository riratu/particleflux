#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# NixOS install for partikelflux kiosk laptops
# BIOS/Legacy boot, single ext4 partition on /dev/sda
#
# Run from the NixOS installer ISO:
#   ./install.sh 3       # laptop with device ID 3
#   ./install.sh          # prompts for device ID
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DISK="/dev/sda"

# ── Device ID ─────────────────────────────────────────────────
DEVICE_ID="${1:-}"
if [[ -z "$DEVICE_ID" ]]; then
  read -rp "Device ID for this laptop: " DEVICE_ID
fi

echo "Installing partikel-${DEVICE_ID} on ${DISK}"
echo "This will ERASE ${DISK}. Press Ctrl+C to abort."
read -rp "Continue? [y/N] " confirm
[[ "$confirm" =~ ^[yY]$ ]] || exit 1

# ── Partition (MBR, single ext4) ──────────────────────────────
echo ">> Partitioning ${DISK} ..."
sudo parted "$DISK" -- mklabel msdos
sudo parted "$DISK" -- mkpart primary ext4 1MiB 100%
sudo parted "$DISK" -- set 1 boot on

# ── Format and mount ─────────────────────────────────────────
echo ">> Formatting ..."
sudo mkfs.ext4 -L nixos "${DISK}1"
sudo mount /dev/disk/by-label/nixos /mnt

# ── Generate hardware config, then overlay our kiosk config ──
echo ">> Generating hardware configuration ..."
sudo nixos-generate-config --root /mnt

echo ">> Copying kiosk configuration ..."
sudo cp "${SCRIPT_DIR}/kiosk.nix"  /mnt/etc/nixos/configuration.nix
sudo cp "${SCRIPT_DIR}/flake.nix"  /mnt/etc/nixos/

# ── Write device ID ──────────────────────────────────────────
echo "$DEVICE_ID" | sudo tee /mnt/etc/device-id > /dev/null

# ── WiFi credentials (not stored in the nix config) ──────────
# Set these in your environment before running, e.g.:
#   export WIFI_PSK_EIIENET="your-wifi-password"
#   export EIIE_HASHED_PW="$(mkpasswd -m sha-512 'your-password')"
for var in WIFI_PSK_EIIENET EIIE_HASHED_PW; do
  if [[ -z "${!var:-}" ]]; then
    echo "Error: ${var} is not set. Export it before running."
    exit 1
  fi
done
echo "WIFI_PSK_EIIENET=${WIFI_PSK_EIIENET}" | sudo tee /mnt/etc/nixos/wifi.env > /dev/null
sudo chmod 600 /mnt/etc/nixos/wifi.env
echo "${EIIE_HASHED_PW}" | sudo tee /mnt/etc/nixos/eiie-password > /dev/null
sudo chmod 600 /mnt/etc/nixos/eiie-password

# ── Install (prompts for root password) ──────────────────────
echo ">> Installing NixOS ..."
sudo nixos-install

echo ""
echo "Done: partikel-${DEVICE_ID}"
echo ""
echo "After reboot:"
echo "  1. Log in as 'eiie' with your password"
echo "  2. Connect to Wi-Fi: nmtui"
echo "  3. Kiosk starts automatically on tty1"
echo "  4. For updates: sudo nixos-rebuild switch"
