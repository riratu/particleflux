# Partikelflux — Kiosk Deployment

## Overview

PXE-based unattended install for 20+ kiosk laptops. One mainframe machine runs the Vite dev server and PXE boot server. Kiosk laptops network-boot, auto-install NixOS, and connect to the mainframe.

```
mainframe (NixOS)
  ├── Vite dev server        :5555
  ├── pixiecore PXE server   (DHCP proxy + TFTP + HTTP)
  └── nginx config server    :8123
        ├── /configs/        kiosk.nix, flake.nix
        └── /secrets/        wifi.env, eiie-password

kiosk laptops
  └── PXE boot → auto-install → reboot → Firefox kiosk → mainframe.local:5555
```

## 1. Install NixOS on the Mainframe

Boot the NixOS installer ISO on the mainframe laptop, then:

```bash
# Connect to the internet
sudo systemctl start wpa_supplicant
# or plug in ethernet

# Clone the repo
git clone <repo-url> /tmp/partikelflux
cd /tmp/partikelflux/nix

# Run the installer (auto-detects disk + BIOS/EFI)
export WIFI_PSK_EIIENET="your-wifi-password"
export EIIE_HASHED_PW="$(mkpasswd -m sha-512 'your-password')"
./install.sh
```

After install, replace the generated config with the mainframe config:

```bash
sudo cp /tmp/partikelflux/nix/mainframe.nix /mnt/etc/nixos/configuration.nix
sudo cp /tmp/partikelflux/nix/flake.nix /mnt/etc/nixos/
```

Reboot into the installed system.

## 2. Configure the Mainframe

```bash
# Find LAN IP
ip addr

# Edit the shared config — set serverIp to your LAN IP
vim /path/to/partikelflux/nix/config.nix

# Rebuild
sudo nixos-rebuild switch --flake /path/to/partikelflux/nix#mainframe
```

## 3. Prepare PXE Files

```bash
# Create directories
sudo mkdir -p /srv/partikelflux/{configs,secrets}

# Copy configs from repo
sudo cp /path/to/partikelflux/nix/kiosk.nix /srv/partikelflux/configs/
sudo cp /path/to/partikelflux/nix/flake.nix /srv/partikelflux/configs/

# Create secrets
echo "WIFI_PSK_EIIENET=your-wifi-password" | sudo tee /srv/partikelflux/secrets/wifi.env
mkpasswd -m sha-512 'your-password' | sudo tee /srv/partikelflux/secrets/eiie-password
sudo chmod 600 /srv/partikelflux/secrets/*
```

## 4. Start the Dev Server

```bash
cd /path/to/partikelflux
npm install
npm run dev
```

The dev server runs on port 5555, reachable as `http://mainframe.local:5555`.

## 5. PXE Boot Kiosk Laptops

1. Connect the kiosk laptop to the same network (ethernet recommended for PXE)
2. Enter BIOS boot menu (usually F12, F10, or Esc)
3. Select **Network Boot / PXE**
4. The laptop boots from the mainframe, auto-installs, and logs success
5. Reboot the laptop into the installed system

Each laptop gets a device ID from its MAC address (last 4 hex chars, e.g. `a3f1`).
After reboot: hostname `partikel-a3f1`, kiosk URL `mainframe.local:5555/?deviceId=a3f1`.

## 6. Set Up SSH for Deployment

Generate a dedicated key on the mainframe (no passphrase):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/partikelflux -N "" -C "eiie@mainframe"
cat ~/.ssh/partikelflux.pub
```

Add the public key to `nix/kiosk.nix` in the `eiie` user config:

```nix
openssh.authorizedKeys.keys = [
  "ssh-ed25519 AAAA... eiie@mainframe"
];
```

Add SSH config on the mainframe (`~/.ssh/config`):

```
Host partikel-*
  User eiie
  IdentityFile ~/.ssh/partikelflux
```

Then rebuild and re-deploy the PXE configs so new installs include the key:

```bash
sudo nixos-rebuild switch --flake /path/to/partikelflux/nix#mainframe
sudo cp nix/kiosk.nix /srv/partikelflux/configs/
```

## 7. Update Kiosk Laptops

Deploy config changes to all running laptops from the mainframe:

```bash
# Discover all laptops on the network and deploy
./nix/deploy.sh

# Deploy to specific laptops only
./nix/deploy.sh a3f1 b2c0

# Just list discovered laptops
./nix/deploy.sh --list
```

## Manual USB Install (Alternative)

For one-off installs without PXE, boot the NixOS installer ISO from USB:

```bash
export WIFI_PSK_EIIENET="your-wifi-password"
export EIIE_HASHED_PW="$(mkpasswd -m sha-512 'your-password')"

# Auto-detects disk, BIOS/EFI, generates device ID from MAC
./nix/install.sh

# Or override device ID:
DEVICE_ID=a3f1 ./nix/install.sh
```

## Notes

- pixiecore uses proxy DHCP — works alongside your router's DHCP, no network reconfiguration needed
- Device IDs derived from MAC are stable and unique per machine
- The netboot installer skips disks that already have a `nixos` partition (prevents accidental re-install)
- For faster parallel installs, consider adding `nix-serve` as a local binary cache on the mainframe
- Secrets (`wifi.env`, `eiie-password`) are never committed to git
