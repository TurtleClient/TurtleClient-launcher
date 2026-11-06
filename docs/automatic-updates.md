# Launcher automatic updates

Windows x64 installers are built by `.github/workflows/release-windows.yml` after
launcher changes land on `main`, or through **Actions → TurtleClient Windows
release → Run workflow**. Releases use `2.3.<workflow run number>`: a rerun keeps
its version; a new run increases it. Keep the workflow filename/run sequence and
raise the source major/minor before that sequence ever reaches 65535.

The build creates an NSIS setup installer and its Tauri/minisign signature in a
draft GitHub Release. Only after the complete manifest passes validation is the
release published as latest. An incomplete/failed build never replaces the public
update channel. Installation artifacts are under:

https://github.com/TurtleClient/turtleclient-launcher/releases/latest

The update endpoint is the release's `latest.json`. It points only to signed
installers from this repository. Both the Tauri plugin and the native fallback
verify artifacts against the public key in `src-tauri/tauri.conf.json`. The
upstream Millida update channel/key is not used, and remote JavaScript/UI updates
remain disabled.

Releases carry `critical: true`, so the existing startup updater downloads and
installs a newer version before continuing, then opens the updated launcher.
There is still an escape from a stalled download, and an unavailable network does
not prevent launching the app. Development (`tauri dev`) does not self-update.
Ordinary checks also run while the installed launcher remains open.

## First installation

Install the setup EXE from the latest release once. Builds distributed before the
TurtleClient updater was enabled cannot discover this channel themselves. After
that bootstrap installation, subsequent published versions update automatically.
User accounts, settings and game folders retain the existing application ID/data
location. This updates the launcher, not the separate native game executable.

Only Windows x64 release artifacts are currently published. macOS/Linux builds
are not included in this initial release pipeline.

## Signing key

`TAURI_SIGNING_PRIVATE_KEY` is a GitHub Actions repository secret. The private
key is also backed up outside the repository in the maintainer's
`%LOCALAPPDATA%\TurtleClient\ReleaseKeys\launcher-updater\updater.key`, with
Windows access restricted to the owner and SYSTEM. Back up that directory to a
secure location. Do not commit or share the private key. The CI key has an empty
passphrase; its protection is the local ACL and GitHub's encrypted secret store.

Retain this key for future versions: simply replacing the public key prevents
existing installations from accepting updates. Updater signing authenticates the
update payload; it is separate from Windows Authenticode publisher signing.

Official reference: [Tauri updater](https://v2.tauri.app/plugin/updater/).
