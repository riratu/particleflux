# ──────────────────────────────────────────────────────────────
# Netboot installer image for partikelflux kiosk laptops.
# Boots from RAM via PXE, auto-detects hardware, partitions,
# installs NixOS with kiosk config, and stays running.
#
# Kernel cmdline param: pxe_server=http://<ip>:<port>
# ──────────────────────────────────────────────────────────────
{ config, lib, pkgs, modulesPath, ... }:

{
  imports = [
    "${modulesPath}/installer/netboot/netboot-minimal.nix"
  ];

  # ── Firmware (WiFi, GPU drivers in the live environment) ────
  hardware.enableAllFirmware = true;
  nixpkgs.config.allowUnfree = true;

  # ── Packages available in the live environment ──────────────
  environment.systemPackages = with pkgs; [
    curl
    parted
    util-linux
    dosfstools   # mkfs.fat for EFI partition
    e2fsprogs    # mkfs.ext4
    nixos-install-tools
    gptfdisk     # sgdisk
  ];

  # ── Auto-install service ────────────────────────────────────
  systemd.services.auto-install = {
    description = "Unattended NixOS kiosk installation";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];

    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      StandardOutput = "journal+console";
      StandardError = "journal+console";
    };

    path = with pkgs; [
      curl parted util-linux dosfstools e2fsprogs
      nixos-install-tools gptfdisk coreutils
      bash gnugrep gawk systemd nix
    ];

    script = ''
      set -euo pipefail

      echo "===== partikelflux auto-install starting ====="

      # ── Read PXE server URL from kernel cmdline ────────────
      PXE_SERVER=""
      for param in $(cat /proc/cmdline); do
        case "$param" in
          pxe_server=*) PXE_SERVER="''${param#pxe_server=}" ;;
        esac
      done

      if [[ -z "$PXE_SERVER" ]]; then
        echo "ERROR: pxe_server= not found in kernel cmdline"
        exit 1
      fi
      echo "PXE server: $PXE_SERVER"

      # ── Detect target disk ─────────────────────────────────
      # First non-removable, non-USB block device
      TARGET_DISK=""
      for disk in $(lsblk -dnpo NAME -I 8,259,254); do
        REMOVABLE=$(cat "/sys/block/$(basename "$disk")/removable" 2>/dev/null || echo "1")
        # Skip USB-connected disks
        TRANSPORT=$(lsblk -dnpo TRAN "$disk" 2>/dev/null || echo "")
        if [[ "$REMOVABLE" == "0" && "$TRANSPORT" != "usb" ]]; then
          TARGET_DISK="$disk"
          break
        fi
      done

      if [[ -z "$TARGET_DISK" ]]; then
        echo "ERROR: No suitable target disk found"
        lsblk
        exit 1
      fi
      echo "Target disk: $TARGET_DISK"

      # ── Skip if already installed ──────────────────────────
      if lsblk -npo LABEL "$TARGET_DISK" 2>/dev/null | grep -q "nixos"; then
        echo "Disk already has a 'nixos' partition — skipping install"
        echo "To re-install, wipe the disk first: wipefs -a $TARGET_DISK"
        exit 0
      fi

      # ── Detect boot mode (BIOS vs EFI) ─────────────────────
      if [ -d /sys/firmware/efi ]; then
        BOOT_MODE="efi"
      else
        BOOT_MODE="bios"
      fi
      echo "Boot mode: $BOOT_MODE"

      # ── Partition ──────────────────────────────────────────
      echo ">> Partitioning $TARGET_DISK ($BOOT_MODE) ..."
      wipefs -af "$TARGET_DISK"

      if [[ "$BOOT_MODE" == "bios" ]]; then
        parted "$TARGET_DISK" -- mklabel msdos
        parted "$TARGET_DISK" -- mkpart primary ext4 1MiB 100%
        parted "$TARGET_DISK" -- set 1 boot on
        sleep 1

        ROOT_PART="''${TARGET_DISK}1"
        echo ">> Formatting root: $ROOT_PART"
        mkfs.ext4 -F -L nixos "$ROOT_PART"
        mount "$ROOT_PART" /mnt
      else
        parted "$TARGET_DISK" -- mklabel gpt
        parted "$TARGET_DISK" -- mkpart ESP fat32 1MiB 513MiB
        parted "$TARGET_DISK" -- set 1 esp on
        parted "$TARGET_DISK" -- mkpart primary ext4 513MiB 100%
        sleep 1

        ESP_PART="''${TARGET_DISK}1"
        ROOT_PART="''${TARGET_DISK}2"

        # Handle NVMe naming (e.g. /dev/nvme0n1p1)
        if [[ "$TARGET_DISK" == *nvme* || "$TARGET_DISK" == *mmcblk* ]]; then
          ESP_PART="''${TARGET_DISK}p1"
          ROOT_PART="''${TARGET_DISK}p2"
        fi

        echo ">> Formatting ESP: $ESP_PART"
        mkfs.fat -F 32 -n boot "$ESP_PART"
        echo ">> Formatting root: $ROOT_PART"
        mkfs.ext4 -F -L nixos "$ROOT_PART"

        mount "$ROOT_PART" /mnt
        mkdir -p /mnt/boot
        mount "$ESP_PART" /mnt/boot
      fi

      # ── Generate hardware config ───────────────────────────
      echo ">> Generating hardware configuration ..."
      nixos-generate-config --root /mnt

      # ── Generate boot-configuration.nix ────────────────────
      echo ">> Generating boot configuration ($BOOT_MODE) ..."
      if [[ "$BOOT_MODE" == "bios" ]]; then
        cat > /mnt/etc/nixos/boot-configuration.nix <<BOOTEOF
{ ... }:
{
  boot.loader.grub.enable = true;
  boot.loader.grub.device = "$TARGET_DISK";
  boot.loader.grub.useOSProber = false;
}
BOOTEOF
      else
        cat > /mnt/etc/nixos/boot-configuration.nix <<BOOTEOF
{ ... }:
{
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
}
BOOTEOF
      fi

      # ── Fetch configs from PXE server ──────────────────────
      echo ">> Fetching kiosk.nix ..."
      curl -f -o /mnt/etc/nixos/configuration.nix "$PXE_SERVER/configs/kiosk.nix"

      echo ">> Fetching flake.nix ..."
      curl -f -o /mnt/etc/nixos/flake.nix "$PXE_SERVER/configs/flake.nix"

      echo ">> Fetching authorized-keys ..."
      curl -f -o /mnt/etc/nixos/authorized-keys "$PXE_SERVER/configs/authorized-keys"

      echo ">> Fetching secrets ..."
      curl -f -o /mnt/etc/nixos/wifi.env "$PXE_SERVER/secrets/wifi.env"
      chmod 600 /mnt/etc/nixos/wifi.env

      curl -f -o /mnt/etc/nixos/eiie-password "$PXE_SERVER/secrets/eiie-password"
      chmod 600 /mnt/etc/nixos/eiie-password

      # ── Install NixOS ──────────────────────────────────────
      echo ">> Installing NixOS (this will take a while) ..."
      nixos-install --no-root-passwd --root /mnt

      # ── Generate device ID from MAC address ─────────────────
      # Use the MAC of the first non-lo network interface
      IFACE=$(ip -o link show | awk -F': ' '!/lo/{print $2; exit}')
      MAC=$(cat "/sys/class/net/$IFACE/address" 2>/dev/null || echo "00:00:00:00:00:00")
      DEVICE_ID="''${MAC//:/}"
      DEVICE_ID="''${DEVICE_ID: -4}"
      echo "$DEVICE_ID" > /mnt/etc/device-id
      echo "Device ID: $DEVICE_ID (from MAC $MAC on $IFACE)"

      echo ""
      echo "===== INSTALL COMPLETE ====="
      echo "Hostname will be: partikel-$DEVICE_ID"
      echo "Reboot to start the installed system."
      echo ""
    '';
  };
}
