#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# NixOS install for partikelflux kiosk laptops
# Auto-detects disk, partitions with GRUB (BIOS).
#
# Run from the NixOS installer ISO:
#   WIFI_PSK_EIIENET="..." EIIE_HASHED_PW="..." ./install.sh
#   DEVICE_ID=a3f1 ./install.sh    # override auto-detected ID
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Detect target disk ────────────────────────────────────────
# First non-removable, non-USB block device
TARGET_DISK=""
for disk in $(lsblk -dnpo NAME -I 8,259,254); do
  REMOVABLE=$(cat "/sys/block/$(basename "$disk")/removable" 2>/dev/null || echo "1")
  TRANSPORT=$(lsblk -dnpo TRAN "$disk" 2>/dev/null || echo "")
  if [[ "$REMOVABLE" == "0" && "$TRANSPORT" != "usb" ]]; then
    TARGET_DISK="$disk"
    break
  fi
done

if [[ -z "$TARGET_DISK" ]]; then
  echo "ERROR: No suitable target disk found. Available disks:"
  lsblk
  exit 1
fi

# ── Device ID (from env, arg, or MAC) ────────────────────────
if [[ -z "${DEVICE_ID:-}" ]]; then
  DEVICE_ID="${1:-}"
fi
if [[ -z "$DEVICE_ID" ]]; then
  IFACE=$(ip -o link show | awk -F': ' '!/lo/{print $2; exit}')
  MAC=$(cat "/sys/class/net/$IFACE/address" 2>/dev/null || echo "00:00:00:00:00:00")
  DEVICE_ID="${MAC//:/}"
  DEVICE_ID="${DEVICE_ID: -4}"
  echo "Auto-detected device ID: $DEVICE_ID (from MAC $MAC on $IFACE)"
fi

echo ""
echo "Target disk:  $TARGET_DISK"
echo "Device ID:    $DEVICE_ID"
echo ""
echo "This will ERASE ${TARGET_DISK}. Press Ctrl+C to abort."
read -rp "Continue? [y/N] " confirm
[[ "$confirm" =~ ^[yY]$ ]] || exit 1

# ── Partition (BIOS / GRUB) ───────────────────────────────────
echo ">> Partitioning ${TARGET_DISK} ..."
sudo wipefs -af "$TARGET_DISK"
sudo parted "$TARGET_DISK" -- mklabel msdos
sudo parted "$TARGET_DISK" -- mkpart primary ext4 1MiB 100%
sudo parted "$TARGET_DISK" -- set 1 boot on

ROOT_PART="${TARGET_DISK}1"

echo ">> Formatting root: $ROOT_PART"
sudo mkfs.ext4 -F -L nixos "$ROOT_PART"
sudo mount "$ROOT_PART" /mnt

# ── Generate hardware config, then overlay our kiosk config ──
echo ">> Generating hardware configuration ..."
sudo nixos-generate-config --root /mnt

echo ">> Copying kiosk configuration ..."
sudo cp "${SCRIPT_DIR}/kiosk.nix"  /mnt/etc/nixos/configuration.nix
sudo cp "${SCRIPT_DIR}/flake.nix"  /mnt/etc/nixos/
sudo cp "${SCRIPT_DIR}/authorized-keys" /mnt/etc/nixos/

# ── Write device ID + hostname config ─────────────────────────
echo "$DEVICE_ID" | sudo tee /mnt/etc/device-id > /dev/null
echo "{ networking.hostName = \"partikel-${DEVICE_ID}\"; }" | sudo tee /mnt/etc/nixos/hostname.nix > /dev/null

# ── WiFi credentials ─────────────────────────────────────────
# Expected next to this script (scp them before running):
#   scp wifi.env eiie-password <installer-ip>:/tmp/partikelflux/nix/
for secret in wifi.env eiie-password; do
  if [[ ! -f "${SCRIPT_DIR}/$secret" ]]; then
    echo "Error: ${SCRIPT_DIR}/$secret not found."
    echo "Copy secrets first: scp wifi.env eiie-password <installer-ip>:${SCRIPT_DIR}/"
    exit 1
  fi
done
sudo cp "${SCRIPT_DIR}/wifi.env" /mnt/etc/nixos/wifi.env
sudo chmod 600 /mnt/etc/nixos/wifi.env
sudo cp "${SCRIPT_DIR}/eiie-password" /mnt/etc/nixos/eiie-password
sudo chmod 600 /mnt/etc/nixos/eiie-password

# ── Copy repo to target disk (survives reboot) ──────────────
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
echo ">> Copying repo to /mnt/home/eiie/partikelflux ..."
sudo mkdir -p /mnt/home/eiie
sudo cp -a "$REPO_DIR" /mnt/home/eiie/partikelflux

# ── Install ───────────────────────────────────────────────────
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
