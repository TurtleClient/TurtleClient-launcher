# TurtleClient Launcher

Minecraft launcher for TurtleClient, based on [Millida Launcher](https://github.com/millida/launcher).
This is an independent fork and is not affiliated with or endorsed by Millida, Mojang or Microsoft.

## Current state

Initial TurtleClient branding: app identity, window title, installer metadata, logos, icons and UI text.
The launcher opens the existing Microsoft/offline game-account flow without requiring a Millida account.
Millida online services and automatic updates are disabled. Microsoft sign-in requires a TurtleClient-owned
Entra application ID at build time (`TURTLECLIENT_MS_CLIENT_ID`); no upstream ID is used.
The native TurtleClient (Rust) launch integration is a separate next step; this baseline still launches Java Minecraft.
This source baseline is not a published binary release.

## Development

```sh
bun install --frozen-lockfile
bun run dev
bun run typecheck
bun run build:web
bun run tauri dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) and [BUILDING.md](BUILDING.md) for prerequisites.
Upstream CI release/publishing workflows are disabled for this fork until its release infrastructure is configured.

## License and attribution

Code remains **GPL-3.0-only**. See [LICENSE](LICENSE), [NOTICE](NOTICE),
[THIRD-PARTY.md](THIRD-PARTY.md), and the upstream [trademark notice](TRADEMARK.md).
Changes and upstream commit are documented in [UPSTREAM.md](UPSTREAM.md).
The supplied TurtleClient wordmark belongs to TurtleClient; the new pixel turtle icon and background are original fork assets.
