# Microsoft and Minecraft sign-in

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
