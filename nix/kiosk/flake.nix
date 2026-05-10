{
  description = "Partikelflux kiosk laptops";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
  let
    system = "x86_64-linux";
  in {
    # Single image for all laptops.
    # Device ID is read from /etc/device-id at boot.
    nixosConfigurations.partikel = nixpkgs.lib.nixosSystem {
      inherit system;
      modules = [ ./kiosk.nix ];
    };
  };
}
