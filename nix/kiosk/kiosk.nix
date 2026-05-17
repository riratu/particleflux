{ config, lib, pkgs, ... }:

let
  serverUrl = "http://mainframe.local:5555";
  kioskResetMinutes = 15;

  kioskLauncher = pkgs.writeShellScript "kiosk-launcher" ''
    DEVICE_ID=$(cat /etc/device-id 2>/dev/null || echo 0)
    exec ${pkgs.coreutils}/bin/timeout ${toString (kioskResetMinutes * 60)} \
      ${pkgs.firefox}/bin/firefox --kiosk "${serverUrl}/?deviceId=$DEVICE_ID"
  '';

in {
  imports = [
    ./hardware-configuration.nix
    ./hostname.nix
  ];

  # ── Bootloader (GRUB, BIOS) ─────────────────────────────────
  boot.loader.grub.enable = true;
  boot.loader.grub.device = "/dev/sda";

  # ── Network ────────────────────────────────────────────────
  networking.networkmanager.enable = true;
  networking.networkmanager.ensureProfiles.environmentFiles = [
    "/etc/nixos/wifi.env"
  ];
  networking.networkmanager.ensureProfiles.profiles.eiienet = {
    connection = {
      id = "eiienet";
      type = "wifi";
      autoconnect = "true";
    };
    wifi = {
      ssid = "eiienet";
      mode = "infrastructure";
    };
    wifi-security = {
      key-mgmt = "wpa-psk";
      psk = "$WIFI_PSK_EIIENET";
    };
  };

  services.avahi = {
    enable = true;
    nssmdns4 = true;
    publish = {
      enable = true;
      addresses = true;
      domain = true;
    };
    extraServiceFiles.partikel = ''
      <?xml version="1.0" standalone='no'?>
      <!DOCTYPE service-group SYSTEM "avahi-service.dtd">
      <service-group>
        <name replace-wildcards="yes">%h</name>
        <service>
          <type>_partikel._tcp</type>
          <port>0</port>
        </service>
      </service-group>
    '';
  };

  # ── Firmware ───────────────────────────────────────────────
  hardware.enableAllFirmware = true;
  nixpkgs.config.allowUnfree = true;

  # ── Locale / time / keyboard ───────────────────────────────
  time.timeZone = "Europe/Zurich";
  i18n.defaultLocale = "de_CH.UTF-8";
  console.keyMap = "sg";
  services.xserver.xkb = {
    layout = "ch";
    variant = "de";
  };

  # ── Users ──────────────────────────────────────────────────
  users.users.eiie = {
    isNormalUser = true;
    extraGroups = [ "wheel" "networkmanager" ];
    hashedPasswordFile = "/etc/nixos/eiie-password";
    openssh.authorizedKeys.keys =
      let
        content = builtins.readFile ./authorized-keys;
        lines = lib.splitString "\n" content;
      in builtins.filter (line: line != "" && builtins.substring 0 1 line != "#") lines;
  };

  users.users.kiosk = {
    isNormalUser = true;
    extraGroups = [ "video" "audio" "networkmanager" ];
    hashedPassword = "!";
  };

  security.sudo.wheelNeedsPassword = false;

  # ── System packages ───────────────────────────────────────
  environment.systemPackages = with pkgs; [
    vim
    git
    htop
  ];

  environment.shellAliases.rebuild = "sudo nixos-rebuild switch --flake /etc/nixos#partikel";

  # ── SSH ────────────────────────────────────────────────────
  services.openssh.enable = true;

  # ── Desktop (GNOME for testing / diagnostics) ───────────────
  # To switch back to kiosk: replace this block with services.cage
#  services.xserver.enable = true;
#  services.xserver.displayManager.gdm.enable = true;
#  services.desktopManager.gnome.enable = true;
#  services.xserver.desktopManager.gnome.extraGSettingsOverrides = ''
#    [org.gnome.desktop.input-sources]
#    sources=[('xkb', 'ch+de')]
#  '';

  # ── Cage (Wayland kiosk compositor) — disabled for testing ─
   services.cage = {
     enable = true;
     user = "kiosk";
     program = "${kioskLauncher}";
     extraArguments = [ "-s" ];
     environment = {
       MOZ_ENABLE_WAYLAND = "1";
       MOZ_WEBRENDER = "1";
     };
   };

  # ── Firefox policies ──────────────────────────────────────
  programs.firefox = {
    enable = true;
    policies = {
      DisableProfileImportingOnFirstRun = true;
      DontCheckDefaultBrowser = true;
#      DisableDeveloperTools = true;
      DisableFirefoxUpdates = true;
      DisableFormHistory = true;
      DisablePocket = true;
      DisableTelemetry = true;
      BlockAboutConfig = true;
      BlockAboutProfiles = true;
      BlockAboutSupport = true;
      OverrideFirstRunPage = "";
      OverridePostUpdatePage = "";
      Preferences = {
        "browser.shell.checkDefaultBrowser" = false;
        "browser.startup.homepage_override.mstone" = "ignore";
        "datareporting.policy.dataSubmissionEnabled" = false;
        "webgl.force-enabled" = true;
        "gfx.webrender.all" = true;
        "media.autoplay.default" = 0;
        "browser.sessionstore.resume_from_crash" = false;
        "extensions.pocket.enabled" = false;
        "reader.parse-on-load.enabled" = false;
      };
    };
  };

  # ── GPU / Graphics ────────────────────────────────────────
  hardware.graphics.enable = true;

  # ── Audio (PipeWire) ──────────────────────────────────────
  services.pipewire = {
    enable = true;
    alsa.enable = true;
    pulse.enable = true;
  };
  security.rtkit.enable = true;

  # ── Prevent sleep / suspend ───────────────────────────────
  services.logind = {
    #lidSwitch = "ignore";
    #lidSwitchDocked = "ignore";
    #lidSwitchExternalPower = "ignore";
    settings.Login = {
      IdleAction = "ignore";
      #HandlePowerKey = "ignore";
      HandleSuspendKey = "ignore";
    };
  };
  systemd.targets.sleep.enable = false;
  systemd.targets.suspend.enable = false;
  systemd.targets.hibernate.enable = false;
  systemd.targets.hybrid-sleep.enable = false;

#  ── Watchdog: restart cage if it crashes (disabled with GNOME) ─
   systemd.services.cage-tty1.serviceConfig = {
     Restart = "always";
     RestartSec = 3;
   };

  system.stateVersion = "24.11";
}
