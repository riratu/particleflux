# Partikelflux

An interactive WebGL particle simulation with a live audio engine, designed as a performative installation. Thousands of particles (three types: RED, GREEN, BLUE) interact physically on the GPU while their velocities drive sound parameters in real-time. The simulation is controlled live via keyboard or a Launchpad MIDI controller.

**Tech stack:** Three.js (WebGL + post-processing), GPUComputationRenderer (GLSL particle physics), Tone.js (audio engine), Vite, Web MIDI API.

```
Keyboard / Launchpad / WebSocket
        │
        ▼
  MomentaryController
   - additive offsets per key
   - lerp interpolation per frame
        │
   ┌────┴─────┬──────────┐
   ▼          ▼          ▼
GPU Shaders  Three.js   Audio Engine
(velocity +  (Bloom,    (Tone.js noise +
 position)   Vignette)   music mixer)
```

Multiple devices can control the simulation simultaneously via WebSocket sync.

## Development

```bash
npm install
npm run dev      # Vite dev server on port 5555
npm run build    # Production build to dist/
```

---

## Kiosk Deployment

### Overview

PXE-based unattended install for 20+ kiosk laptops. One mainframe machine runs the Vite dev server and PXE boot server. Kiosk laptops network-boot, auto-install NixOS, and connect to the mainframe.

```
mainframe (NixOS)
  ├── Vite dev server        :5555
  ├── pixiecore PXE server   (DHCP proxy + TFTP + HTTP)
  └── nginx config server    :8123
        ├── /configs/        kiosk.nix, flake.nix, authorized-keys
        └── /secrets/        wifi.env, eiie-password

kiosk laptops
  └── PXE boot → auto-install → reboot → Firefox kiosk → mainframe.local:5555
```

### Secrets (not committed to git)

Create these files on your dev laptop and put them in the `nix/kiosk/` folder:

- `wifi.env` — contains `WIFI_PSK_EIIENET=your-wifi-password`, used by NetworkManager on kiosks
- `eiie-password` — hashed password (`mkpasswd -m sha-512 'pw'`), used for the eiie user login
- `~/.ssh/eiieinstallations` + `eiieinstallations.pub` — SSH keypair for deploy.sh (mainframe bire-dings-bumsonly)

On the installed machines these end up at `/etc/nixos/wifi.env` and `/etc/nixos/eiie-password`.

## 1. Install NixOS on the Mainframe

Boot the NixOS installer ISO on the mainframe laptop, then:

```bash
# On the mainframe (NixOS installer), get the IP
ip a

# From your dev laptop, copy the repo and secrets into nix/
tar cf - -C /path/to/parent partikelflux | ssh nixos@<installer-ip> 'tar xf - -C /tmp/'

# On the mainframe, partition + install
cd /tmp/partikelflux/nix/kiosk
./install.sh    # auto-detects disk, partitions with GRUB, copies secrets to /mnt/etc/nixos/
```

After reboot the repo is at `/home/eiie/partikelflux` (copied by install.sh). Switch to the mainframe config:

```bash
passwd eiie
nixos-generate-config --show-hardware-config > /home/eiie/partikelflux/nix/mainframe/hardware-configuration.nix
nixos-rebuild switch --flake /home/eiie/partikelflux/nix/mainframe#mainframe
```

## 2. Configure the Mainframe

```bash
# Find LAN IP
ip addr

# Edit the mainframe config — set serverIp to your LAN IP
vim /path/to/partikelflux/nix/mainframe/config.nix
```

Copy the SSH deploy key and config from your dev laptop:

```bash
scp ~/.ssh/eiieinstallations ~/.ssh/eiieinstallations.pub eiie@mainframe.local:~/.ssh/
ssh eiie@mainframe.local 'cat >> ~/.ssh/config' <<'EOF'
Host partikel-*
  User eiie
  IdentityFile ~/.ssh/eiieinstallations
EOF
```

Rebuild the mainframe:

```bash
sudo nixos-rebuild switch --flake /path/to/partikelflux/nix/mainframe#mainframe
```

## 3. Prepare PXE Files

```bash
# Create directories
sudo mkdir -p /srv/partikelflux/{configs,secrets}

# Copy configs from repo
sudo cp ./nix/kiosk/kiosk.nix /srv/partikelflux/configs/
sudo cp ./nix/kiosk/flake.nix /srv/partikelflux/configs/
sudo cp ./nix/kiosk/authorized-keys /srv/partikelflux/configs/

# Copy secrets from dev laptop
scp wifi.env eiie-password eiie@mainframe.local:/tmp/
sudo mv /tmp/wifi.env /tmp/eiie-password /srv/partikelflux/secrets/
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

## 6. Update Kiosk Laptops

Deploy config changes to all running laptops from the mainframe:

```bash
# Discover all laptops on the network and deploy
./nix/mainframe/deploy.sh

# Deploy to specific laptops only
./nix/mainframe/deploy.sh a3f1 b2c0

# Just list discovered laptops
./nix/mainframe/deploy.sh --list
```

After updating `kiosk.nix`, also copy it to the PXE server so new installs get the change:

```bash
sudo cp nix/kiosk/kiosk.nix /srv/partikelflux/configs/
```

## Manual USB Install (Alternative)

For one-off installs without PXE, boot the NixOS installer ISO from USB:

```bash
# 1. Get the installer's IP
ip a

# 2. From dev laptop, copy repo and secrets into nix/
tar cf - partikelflux | ssh nixos@<installer-ip> 'tar xf - -C /tmp/'
scp wifi.env eiie-password nixos@<installer-ip>:/tmp/partikelflux/nix/kiosk/

# 3. On the installer
cd /tmp/partikelflux/nix/kiosk
./install.sh                  # auto-detects disk + device ID
DEVICE_ID=a3f1 ./install.sh   # or override device ID
```

## Notes

- pixiecore uses proxy DHCP — works alongside your router's DHCP, no network reconfiguration needed
- Device IDs derived from MAC are stable and unique per machine
- The netboot installer skips disks that already have a `nixos` partition (prevents accidental re-install)
- For faster parallel installs, consider adding `nix-serve` as a local binary cache on the mainframe
- Secrets (`wifi.env`, `eiie-password`) are never committed to git
- Password SSH still works alongside key auth — the key just lets `deploy.sh` run without prompts
