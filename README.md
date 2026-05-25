# Legion Army Builder

A web-based army list builder for **Star Wars: Legion**. Pick a faction, add
units, see live points/composition validation, and save lists in your browser.

Built with Vite + React + TypeScript. Local saves use `localStorage`.

## Run it

```bash
npm install
npm run dev     # http://127.0.0.1:5173
npm run build   # production bundle in dist/
```

## Features (v1)

- **4 factions**: Rebel Alliance, Galactic Empire, Galactic Republic, Separatist Alliance.
- **Faction lock**: once a faction is chosen, only its units appear and can be added.
- **Core validation** (standard 800-pt list):
  - Points cap (configurable per list)
  - 1–2 Commander, 0–2 Operative, 3–6 Corps, 0–3 Special Forces, 0–3 Support, 0–2 Heavy
  - Uniques can only be taken once
- **Local saves**: name a list, hit Save; load/delete from the "Saved lists" modal.

## Data sources & caveats

The original request was to scrape <https://www.atomicmassgames.com/swlegiondocs/>
and <https://tabletopadmiral.com/>. Both hosts are blocked by this build
environment's network policy (`host_not_allowed`), so direct scraping wasn't
possible.

The bundled dataset combines:

- **`src/data/catalog.base.json`** — from
  [matanlurey/swlegion](https://github.com/matanlurey/swlegion-archived/blob/master/lib/catalog.json)
  (MIT-licensed). Covers Rebel Alliance and Galactic Empire as of ~2020.
  17 Empire units + 17 Rebels.
- **`src/data/catalog.seed.ts`** — hand-coded seed for Republic and Separatist
  (10 units each), reflecting iconic SWL units with best-effort points/stats.
  Not authoritative — verify against current cards before tournament play.

### Adding or correcting units

Edit `src/data/catalog.seed.ts` (TypeScript) for new units, or replace
`catalog.base.json` with a newer dump. All units follow the schema in
`src/lib/types.ts` (`Unit`). The merger in `src/data/catalog.ts` builds the
final catalog the app sees.

## Project layout

```
src/
  components/
    FactionPicker.tsx        — landing view
    UnitBrowser.tsx          — left panel, filterable unit list
    ArmyRoster.tsx           — right panel, current list + validation
    SavedListsPanel.tsx      — load/delete modal
  data/
    catalog.base.json        — bundled base data
    catalog.seed.ts          — Republic/Separatist seed
    catalog.ts               — merger + lookup helpers
  lib/
    types.ts                 — Unit, Catalog, SavedArmy, FactionId, ...
    factions.ts              — faction info, rank order, rank limits
    validation.ts            — validateArmy(), canAdd()
    storage.ts               — localStorage CRUD for saved lists
  App.tsx                    — top-level state & layout
  App.css                    — theme
```

## What's not in v1 (intentionally)

- Upgrade slot validation / upgrade selection UI
- Battle Forces (Imperial Discipline, 501st, etc.) and their composition rules
- Mercenary / Allied unit rules
- Command card management
- Skirmish / 500-pt formats
- Export to text or share-by-URL
- Unit card details view (the data is in the catalog but not surfaced in the UI yet)
