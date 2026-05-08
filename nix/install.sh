#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# NixOS install for partikelflux kiosk laptops
# Auto-detects disk, BIOS/EFI, generates boot config.
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

# ── Detect boot mode ─────────────────────────────────────────
if [ -d /sys/firmware/efi ]; then
  BOOT_MODE="efi"
else
  BOOT_MODE="bios"
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
echo "Boot mode:    $BOOT_MODE"
echo "Device ID:    $DEVICE_ID"
echo ""
echo "This will ERASE ${TARGET_DISK}. Press Ctrl+C to abort."
read -rp "Continue? [y/N] " confirm
[[ "$confirm" =~ ^[yY]$ ]] || exit 1

# ── Partition ─────────────────────────────────────────────────
echo ">> Partitioning ${TARGET_DISK} ($BOOT_MODE) ..."
sudo wipefs -af "$TARGET_DISK"

if [[ "$BOOT_MODE" == "bios" ]]; then
  sudo parted "$TARGET_DISK" -- mklabel msdos
  sudo parted "$TARGET_DISK" -- mkpart primary ext4 1MiB 100%
  sudo parted "$TARGET_DISK" -- set 1 boot on

  ROOT_PART="${TARGET_DISK}1"

  echo ">> Formatting root: $ROOT_PART"
  sudo mkfs.ext4 -F -L nixos "$ROOT_PART"
  sudo mount "$ROOT_PART" /mnt
else
  sudo parted "$TARGET_DISK" -- mklabel gpt
  sudo parted "$TARGET_DISK" -- mkpart ESP fat32 1MiB 513MiB
  sudo parted "$TARGET_DISK" -- set 1 esp on
  sudo parted "$TARGET_DISK" -- mkpart primary ext4 513MiB 100%

  ESP_PART="${TARGET_DISK}1"
  ROOT_PART="${TARGET_DISK}2"

  # Handle NVMe / eMMC naming (e.g. /dev/nvme0n1p1)
  if [[ "$TARGET_DISK" == *nvme* || "$TARGET_DISK" == *mmcblk* ]]; then
    ESP_PART="${TARGET_DISK}p1"
    ROOT_PART="${TARGET_DISK}p2"
  fi

  echo ">> Formatting ESP: $ESP_PART"
  sudo mkfs.fat -F 32 -n boot "$ESP_PART"
  echo ">> Formatting root: $ROOT_PART"
  sudo mkfs.ext4 -F -L nixos "$ROOT_PART"

  sudo mount "$ROOT_PART" /mnt
  sudo mkdir -p /mnt/boot
  sudo mount "$ESP_PART" /mnt/boot
fi

# ── Generate hardware config, then overlay our kiosk config ──
echo ">> Generating hardware configuration ..."
sudo nixos-generate-config --root /mnt

# ── Generate boot-configuration.nix ──────────────────────────
echo ">> Generating boot configuration ($BOOT_MODE) ..."
if [[ "$BOOT_MODE" == "bios" ]]; then
  sudo tee /mnt/etc/nixos/boot-configuration.nix > /dev/null <<BOOTEOF
{ ... }:
{
  boot.loader.grub.enable = true;
  boot.loader.grub.device = "$TARGET_DISK";
  boot.loader.grub.useOSProber = false;
}
BOOTEOF
else
  sudo tee /mnt/etc/nixos/boot-configuration.nix > /dev/null <<BOOTEOF
{ ... }:
{
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
}
BOOTEOF
fi

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
