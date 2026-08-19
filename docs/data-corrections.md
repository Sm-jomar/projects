# Fixing Legion unit/upgrade data (points, cards, upgrades)

The catalog (units, upgrades, points, card images) is scraped/generated
data, so it has occasional errors — a wrong point value, a mispaired card
image, a wrong upgrade slot. This is the loop for reporting and fixing
those, end to end.

## 1. Flag it in the app

- **Units**: Army Builder → find the unit → **🚩 Flag as wrong**, with a
  short reason ("wrong points", "wrong faction", "missing card image", …).
- **Upgrades**: open the Upgrade Picker on any unit → select the upgrade →
  **🚩 Flag as wrong** in the preview pane.

Flags are stored locally and auto-exported (posted to the Worker, which
commits them to the repo) every 30 minutes, or immediately via the flag
counter's export action. Each export lands as a new file:

```
flags/incoming/flags-<timestamp>.json
```

## 2. Apply the correction

Read the incoming flag file(s) and figure out which layer the fix
belongs in — usually it's one of:

| What's wrong | Fix it in |
|---|---|
| Wrong **printed** points, faction, type, or other base field | `src/data/catalog-overrides.json` — add `{"units": {"<unitId>": {"points": 65}}}` or under `"upgrades"` for an upgrade. Only list the field(s) that are actually wrong; it's shallow-merged onto the generated catalog entry in `src/data/catalog.ts`. |
| Wrong **tournament (v2.6)** points specifically | `src/data/points-adjustments.json` — this is the deliberate errata table for the alternate points mode, separate from the printed value. |
| Wrong or missing **card image** | `src/lib/cardLookup.ts`'s `UNIT_CARD_OVERRIDES` map (units) for a hand-paired `catalog id -> card file path`. Upgrade card matching is fuzzy-only today (`cardForUpgrade`); if it's mismatching, check `src/data/card-manifest.json` has the right entry first. |
| Unit is missing entirely, or has structurally wrong data (wrong weapons, wrong keywords) | `src/data/catalog.seed.ts` (units) or `src/data/catalog.base.json` (upgrades/command cards) — the underlying generated data itself. |

Unit and upgrade ids are the catalog's `id` field — visible in the flag
JSON, or by hovering the flagged entry in the app.

## 3. Clear the flag file and deploy

Once a flag's fix is applied, delete its `flags/incoming/*.json` file (or
leave it as a record and just make sure it doesn't get re-processed) and
push to `main` — the Worker redeploys automatically.

## Why a separate overrides file (not hand-editing the generated data)?

`catalog.seed.ts` is regenerated wholesale from a wiki scrape, so a
manual edit to a single field there is easy to silently lose on the next
regeneration. `catalog-overrides.json` is small, hand-maintained, and
survives regeneration — it's the first place to reach for a routine
points/faction/type correction; drop to editing the generated data only
when the overrides shape can't express the fix (e.g. an entirely missing
unit, or a structural field like weapons/keywords).
