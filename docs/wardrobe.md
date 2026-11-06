# TurtleClient wardrobe

The existing Outfits, Skins, Capes, Head, Body, Back, Pets and Emotes tabs and
their type chips remain available, including empty sections for future items.
Only the duplicate Shop tab is removed. All/My filters distinguish free or
unlocked cosmetics from items requiring an entitlement.

Click an unlocked item to equip it; click its selected tile to unequip it.
The authenticated service derives the Minecraft UUID from its session rather
than accepting an arbitrary player ID. The launcher reads Ocean's equipped slots
and cape, polls every 15 seconds, and refreshes immediately after a change.
The lobby and wardrobe character show model transforms, animations, original
textures/capes and the equipped name tag effect above the verified player name.

## Server configuration

Edit `/var/lib/turtleclient/friends/wardrobe-categories.json` using
[`wardrobe-categories.example.json`](../services/friends/wardrobe-categories.example.json).
Changes are read on the next request; no service restart is needed.

- `categories`: stable IDs, translated `label` values and physical `slots`.
- `assignments`: item ID to category ID overrides the physical slot grouping.
- `items`: per-item `type` (such as `HAT` or `EARS`), `access` (`free` or `paid`),
  optional integer `price_minor` and ISO currency `currency` (such as `EUR`).

Keep the standard category IDs to use the original tabs. Additional category IDs
become extra tabs. Placement slots and UI types are independent: an `EARS` item
can attach to the physical `head` slot. Empty Pets/Emotes tabs are retained;
declaring a type does not implement a new game attachment or animation system.

Example paid metadata inside `items`:

```json
{"premium_hat":{"type":"HAT","access":"paid","price_minor":999,"currency":"EUR"}}
```

Paid items require an explicit entitlement in the adjacent private
`wardrobe-entitlements.json` file:

```json
{"players":{"00000000-0000-0000-0000-000000000001":["premium_hat"]}}
```

Use canonical hyphenated Minecraft UUIDs and real catalog IDs. Restrict files to
the service administrator and `turtleclient` user. No client endpoint grants
entitlements. Missing item access metadata preserves the existing free catalog.

**Before selling cosmetics:** this provides price display and authenticated
launcher entitlement checks, not a payment integration. Ocean's older beta
cosmetic write routes remain public and must also enforce ownership before paid
items are sold. A launcher-only lock cannot secure those existing routes.

## Verification

`cargo test --manifest-path services/friends/Cargo.toml --locked` exercises real
isolated HTTP requests, own-account writes, caller UUID rejection, hot category
reload and denied/allowed paid equip. Frontend tests cover category/type
separation, entitlement filtering, prices, model UV geometry and tag animation.
