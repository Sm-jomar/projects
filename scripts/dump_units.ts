// Prints the merged catalog's units and upgrades as JSON, for
// scripts/import_legion_helper_minis.py:
//   npx esbuild scripts/dump_units.ts --bundle --platform=node | node > /tmp/catalog.json
import { CATALOG } from "../src/data/catalog";

console.log(JSON.stringify({ units: CATALOG.units, upgrades: CATALOG.upgrades }));
