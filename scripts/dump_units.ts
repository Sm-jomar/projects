// Prints the merged unit catalog as JSON, for
// scripts/import_legion_helper_minis.py:
//   npx esbuild scripts/dump_units.ts --bundle --platform=node | node > /tmp/units.json
import { CATALOG } from "../src/data/catalog";

console.log(JSON.stringify(CATALOG.units));
