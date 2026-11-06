# Microsoft and Minecraft sign-in

## Temporary development backend: Horizon

The current default delegates sign-in to the **installed Horizon Launcher**:

1. TurtleClient starts `horizon-launcher --json account sign-in` and shows its public Microsoft code.
2. The UI identifies the provider as Horizon; the Microsoft consent page belongs to Horizon.
3. After sign-in, `account session UUID` returns a fresh, read-once session file.
4. TurtleClient consumes and deletes that file and stores the Minecraft token in its existing encrypted vault.
5. Renewal calls Horizon again. Microsoft refresh tokens remain owned by Horizon and never enter the webview.

The bridge uses a launcher store under TurtleClient's data folder, `horizon-auth/launcher`, and a
session handoff folder at `horizon-auth/game/sessions`. It does not read Horizon's secrets files.
Cancelling the sign-in stops its child process; exiting the launcher stops pending sign-ins too.
The child runs without a console window or self-updates.

On Windows the helper is discovered beside the TurtleClient executable or at
`%LOCALAPPDATA%/Programs/Horizon Launcher/horizon-launcher.exe`. Override this with the runtime
variable `TURTLECLIENT_HORIZON_LAUNCHER` if needed. Other platforms can use the explicit path.

Set `TURTLECLIENT_AUTH_PROVIDER=microsoft` to select the direct flow described below;
unset it or set it to `horizon` to use this temporary backend. Export variables into the launcher
process; `.env.example` is documentation, not an automatically loaded Cargo environment file.

This uses Horizon's implemented authentication and session interface. It does not copy its OAuth
client ID, grant TurtleClient's app Minecraft API approval, or bypass Minecraft account ownership.

## Direct TurtleClient Microsoft application

TurtleClient Launcher uses its own public Microsoft application:

- Name: TurtleClient Launcher
- Application/client ID: `effe2670-984b-4dc6-89d9-73e11c733c40`
- Project: https://github.com/TurtleClient/turtleclient-launcher
- Client type: public desktop client, device-code flow
- Account audience: personal Microsoft accounts (`consumers` authority)
- Requested scopes: `XboxLive.signin offline_access`
- No client secret is required or embedded.

The registration must enable public client flows. The build-time environment
variable `TURTLECLIENT_MS_CLIENT_ID` overrides the built-in public application ID.
An `.env` file alone is not loaded by Cargo; export the variable into the build
process when building a different fork.

## Microsoft succeeds, Minecraft returns HTTP 403

Microsoft's successful browser confirmation covers the Microsoft OAuth step.
The launcher then exchanges the grant through Xbox Live and XSTS and finally
calls Minecraft Services `authentication/login_with_xbox`.

If that endpoint responds with **Invalid app registration**, the launcher shows
the application-registration diagnostic and the review link:
https://aka.ms/mce-reviewappid

The project owner must arrange Minecraft API approval for the application's
client ID. Repeated sign-ins, a new client secret, or changing redirect URIs do
not substitute for that approval. The launcher does not borrow another app's ID
or fall back to an unauthenticated account after a failed licensed login.

Suggested project description for an application review:

> TurtleClient Launcher is an independent, open-source desktop launcher for
> Minecraft: Java Edition, based on the GPL-3.0-only Millida Launcher project.
> It uses its own Microsoft public-client application and device-code flow to
> authenticate players through Microsoft, Xbox Live and Minecraft Services.
> Source: https://github.com/TurtleClient/turtleclient-launcher

A **generic HTTP 403** without the app-registration reason is kept separate:
it proves that Minecraft refused access but does not establish why. Profile
lookup and Xbox-account failures also have different remedies.

Only the public client ID belongs in review requests or bug reports. Do not
include access tokens, refresh tokens, device codes or the secrets store.

References: [Microsoft device-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code),
[Minecraft application review](https://aka.ms/mce-reviewappid).
