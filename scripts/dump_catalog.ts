// Prints our catalog *before* the Tabletop Admiral layer as JSON, for
// scripts/import_tabletop_admiral.py:
//   npx esbuild scripts/dump_catalog.ts --bundle --platform=node | node > /tmp/ours.json
import base from "../src/data/catalog.base.json";
import { SEED_UNITS } from "../src/data/catalog.seed";

console.log(JSON.stringify({ units: SEED_UNITS, upgrades: base.upgrades }));
