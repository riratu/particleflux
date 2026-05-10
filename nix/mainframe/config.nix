# ── Shared config for partikelflux deployment ─────────────────
# Edit these values, then: sudo nixos-rebuild switch --flake .#mainframe
{
  serverIp = "192.168.1.100";
  httpPort = 8123;
}
