# Native client and TurtleClient services

The original launcher layout is retained. With no Java build explicitly selected,
the existing lobby Play button starts the native TurtleClient. Picking a Java build
in the catalog continues to use the original Java launch path.

The native client is now installed and updated automatically on launcher start;
see [native-client-updates.md](native-client-updates.md). In Settings → Game,
select the prepared Minecraft 26.3 resources and a game directory.
Use **Select in lobby** there to return to TurtleClient after selecting a Java build.
The launcher detects already prepared resources from installed Horizon
versions. It never redistributes Mojang assets. Paths are stored in
`turtleclient.json` under the launcher data directory. `TURTLE_CLIENT` and
`TURTLE_RESOURCES` provide initial path overrides.

Microsoft accounts are refreshed through the configured provider, then their
profile is verified against Minecraft Services. A private stdin pipe hands the
session to the game using `--session-stdin`; tokens never enter the command line,
webview, logs or a temporary session file. Offline accounts explicitly launch
with `--name`. Native launch never silently downgrades an online account to offline.
The game runs in its configured directory; logs are in `.turtleclient/launcher-game.log`.
An already running native client cannot be launched twice.

## Friends

The launcher automatically connects its active Microsoft Minecraft account to
TurtleClient's friends service on startup and keeps it alive across screen changes.
Connecting sends its
Minecraft access token over HTTPS to the TurtleClient service once, where
`GET https://api.minecraftservices.com/minecraft/profile` verifies ownership.
The service neither logs nor persists that token. It returns an opaque one-hour
session, kept only in the launcher's Rust process. UUIDs or nicknames supplied by
the webview cannot authenticate an account. Session identifiers are also absent
from frontend storage and responses.

Both players must start the launcher once before a request can be addressed by Minecraft
name. Requests, acceptance, rejection, cancellation and removal persist across
service restarts. Acceptance must come from the recipient. Online means the
launcher has polled within the last 75 seconds. A central heartbeat runs every
20 seconds, renews expired sessions and reconnects after network failures/server
restarts. Switching accounts clears the previous view and stops its heartbeat;
logging out or selecting an offline account stops polling. This release does not promise
in-game presence, direct messages, calls or server invitations.

The independent Rust service lives in `services/friends`, listens only on
`127.0.0.1:3001`, and uses `/var/lib/turtleclient/friends/friends.json` on the VPS.
Public routes are under `https://45.133.9.162/turtleclient/social/`:

| Route | Authentication | Operation |
| --- | --- | --- |
| `POST session` | Minecraft bearer token | Verify account and issue service session |
| `GET friends` | Service bearer | Own friends and requests; presence heartbeat |
| `POST friends/request` | Service bearer | `{name}` |
| `POST friends/decision` | Service bearer | `{uuid, accept}` |
| `DELETE friends/<uuid>` | Service bearer | Remove friendship or own pending request |
| `GET healthz` | None | Health check |

Requests are capped at 1 KiB. Names, UUIDs, session expiry and collection sizes
are checked. nginx limits login and API requests. Sessions and online presence
expire in memory; the database contains only Minecraft IDs/names, friendships
and pending requests. Back up the friends directory with the Ocean data.

Run `cargo test --manifest-path services/friends/Cargo.toml --locked` for state
and HTTP integration tests using isolated identities. `deploy.py` takes a prebuilt
Linux binary plus its expected SHA-256, backs up its configuration, validates nginx
and installs only `turtleclient-friends.service`. Ocean and other services are not
restarted. Its nginx configuration is in separate `turtleclient-friends.conf` files.

Deployment on 2026-11-06: Linux binary SHA-256
`fa57632ce5f448c368f320dd5486e78c780966570782145a378221f177fc52d5`;
configuration backup `/var/backups/turtleclient/friends-20261106T175116Z`.
Public health/catalog checks returned 200 and unauthenticated friend/session
requests returned 401. No real account sign-in or friendship was used for these checks.

## Cosmetics and shop

The launcher reads Ocean's live catalog and authenticated wardrobe state. Equipped
models, original capes and animated name tags appear on the lobby and wardrobe
character. Existing wardrobe tabs and type chips remain; only its duplicate Shop
tab is removed. The separate shop remains available.

See [wardrobe.md](wardrobe.md) for server categories, item types, prices and
entitlements. Prices describe catalog entries; no payment checkout is implemented.
The existing Ocean beta write routes remain public. Those legacy routes must be
secured before selling paid cosmetics; the new launcher API alone does not protect
them.
