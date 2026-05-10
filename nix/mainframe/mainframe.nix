# ──────────────────────────────────────────────────────────────
# NixOS config for the mainframe — the machine that:
#   - Runs the Vite dev server (npm run dev, port 5555)
#   - Serves PXE boot for kiosk laptop installs
#   - Is reachable as mainframe.local via mDNS
#
# Install:
#   1. Boot NixOS installer on the machine
#   2. nixos-generate-config --root /mnt
#   3. Copy this as /mnt/etc/nixos/configuration.nix
#   4. nixos-install
# ──────────────────────────────────────────────────────────────
{ config, lib, pkgs, netbootSystem, ... }:

let
  cfg = import ./config.nix;
  inherit (cfg) serverIp httpPort;

  netbootBuild = netbootSystem.config.system.build;
in {
  imports = [
    ./hardware-configuration.nix
  ];

  # ── Bootloader (GRUB, BIOS) ─────────────────────────────────
  boot.loader.grub.enable = true;
  boot.loader.grub.device = "/dev/sda";

  # ── Hostname ────────────────────────────────────────────────
  networking.hostName = "mainframe";

  # ── Network ─────────────────────────────────────────────────
  networking.networkmanager.enable = true;

  services.avahi = {
    enable = true;
    nssmdns4 = true;
    publish = {
      enable = true;
      addresses = true;
      domain = true;
    };
  };

  # ── Locale / time / keyboard ────────────────────────────────
  time.timeZone = "Europe/Zurich";
  i18n.defaultLocale = "de_CH.UTF-8";
  console.keyMap = "sg";
  services.xserver.xkb = {
    layout = "ch";
    variant = "de";
  };

  # ── Users ───────────────────────────────────────────────────
  users.users.eiie = {
    isNormalUser = true;
    extraGroups = [ "wheel" "networkmanager" ];
    # Set a password on first login: passwd eiie
  };

  # ── Packages ────────────────────────────────────────────────
  environment.systemPackages = with pkgs; [
    vim
    git
    htop
    nodejs_22
    # mkpasswd for generating hashed passwords
    mkpasswd
  ];

  # ── SSH ─────────────────────────────────────────────────────
  services.openssh.enable = true;

  # ── Desktop (optional — remove if headless) ─────────────────
  services.xserver.enable = true;
  services.xserver.displayManager.gdm.enable = true;
  services.desktopManager.gnome.enable = true;
  services.xserver.desktopManager.gnome.extraGSettingsOverrides = ''
    [org.gnome.desktop.input-sources]
    sources=[('xkb', 'ch+de')]
  '';

  # ── Audio ───────────────────────────────────────────────────
  services.pipewire = {
    enable = true;
    alsa.enable = true;
    pulse.enable = true;
  };
  security.rtkit.enable = true;

  # ── Firmware ────────────────────────────────────────────────
  hardware.enableAllFirmware = true;
  hardware.graphics.enable = true;
  nixpkgs.config.allowUnfree = true;

  # ── PXE server: pixiecore ──────────────────────────────────
  services.pixiecore = {
    enable = true;
    mode = "boot";
    kernel = "${netbootBuild.kernel}/bzImage";
    initrd = "${netbootBuild.netbootRamdisk}/initrd";
    cmdLine = "init=${netbootBuild.toplevel}/init loglevel=4 pxe_server=http://${serverIp}:${toString httpPort}";
    dhcpNoBind = true;
    openFirewall = true;
  };

  # ── PXE server: nginx for configs + secrets ─────────────────
  services.nginx = {
    enable = true;
    virtualHosts."pxe-files" = {
      listen = [{ addr = "0.0.0.0"; port = httpPort; }];
      locations."/configs/" = {
        alias = "/srv/partikelflux/configs/";
        extraConfig = "autoindex off;";
      };
      locations."/secrets/" = {
        alias = "/srv/partikelflux/secrets/";
        extraConfig = "autoindex off;";
      };
    };
  };

  # ── Firewall ────────────────────────────────────────────────
  networking.firewall.allowedTCPPorts = [
    5555     # Vite dev server
    httpPort # nginx (PXE config files)
  ];

  system.stateVersion = "24.11";
}
