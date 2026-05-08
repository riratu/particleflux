{
  description = "Partikelflux kiosk laptops + server";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
  };

  outputs = { self, nixpkgs }:
  let
    system = "x86_64-linux";

    # Build the netboot installer system (used by pxe-server for kernel/initrd)
    netbootSystem = nixpkgs.lib.nixosSystem {
      inherit system;
      modules = [ ./netboot-installer.nix ];
    };
  in {
    # Single image for all laptops.
    # Device ID is read from /etc/device-id at boot.
    nixosConfigurations.partikel = nixpkgs.lib.nixosSystem {
      inherit system;
      modules = [ ./kiosk.nix ];
    };

    # Netboot installer image (auto-install from PXE)
    nixosConfigurations.netboot-installer = netbootSystem;

    # Mainframe — the server that runs Vite dev server + PXE boot.
    nixosConfigurations.mainframe = nixpkgs.lib.nixosSystem {
      inherit system;
      specialArgs = { inherit netbootSystem; };
      modules = [ ./mainframe.nix ];
    };

    # Dev shell for the server (mainframe)
    devShells.${system}.default = let
      pkgs = nixpkgs.legacyPackages.${system};
    in pkgs.mkShell {
      packages = with pkgs; [ nodejs_22 ];
      shellHook = ''
        echo "Run: npm install && npm run dev"
        echo "Laptops connect to http://mainframe.local:5555/?deviceId=N"
      '';
    };
  };
}
