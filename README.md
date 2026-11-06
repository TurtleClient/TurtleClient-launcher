# TurtleClient Launcher

Minecraft launcher for TurtleClient, based on [Millida Launcher](https://github.com/millida/launcher).
This is an independent fork and is not affiliated with or endorsed by Millida, Mojang or Microsoft.

## Current state

Initial TurtleClient branding: app identity, window title, installer metadata, logos, icons and UI text.
The launcher opens the existing Microsoft/offline game-account flow without requiring a Millida account.
Millida online services and automatic updates are disabled. Development sign-in temporarily uses the
**installed Horizon Launcher as an external authentication backend**, through its public CLI and
read-once session handoff. The interface identifies this as sign-in via Horizon. The helper is not
bundled, and Horizon's OAuth application ID is not copied into TurtleClient.

Set the runtime environment variable `TURTLECLIENT_AUTH_PROVIDER=microsoft` to use TurtleClient's
own public Entra application ID `effe2670-984b-4dc6-89d9-73e11c733c40` directly. Fork builds can
override that ID at build time with `TURTLECLIENT_MS_CLIENT_ID`. Direct sign-in requires a correctly
configured registration and Minecraft API approval.
See [Microsoft/Minecraft sign-in](docs/microsoft-login.md) for the separate Minecraft API approval step
and the meaning of HTTP 403 after Microsoft sign-in.
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
